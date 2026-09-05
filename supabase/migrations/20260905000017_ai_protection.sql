-- Phase 5: free-tier AI protection.
-- - Daily Gemini request quota (atomic counter; default limit comes from
--   the application env, GEMINI_DAILY_LIMIT).
-- - Circuit breaker: 5 consecutive quota errors pause Gemini for 15 min.
-- - Pending confirmations: when the AI path is unavailable and the local
--   parser is only mid-confidence, the bot asks the user to confirm
--   instead of guessing.

create table if not exists public.ai_usage (
  day date primary key,
  requests int not null default 0
);

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
grant all on public.ai_usage to service_role;

create table if not exists public.ai_circuit (
  id int primary key default 1 check (id = 1),
  open_until timestamptz,
  consecutive_quota_errors int not null default 0
);

alter table public.ai_circuit enable row level security;
revoke all on public.ai_circuit from anon, authenticated;
grant all on public.ai_circuit to service_role;

create table if not exists public.line_pending_confirms (
  event_key text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 minutes'
);

alter table public.line_pending_confirms enable row level security;
revoke all on public.line_pending_confirms from anon, authenticated;
grant all on public.line_pending_confirms to service_role;

-- Atomically reserve one Gemini slot for today. Returns:
--   'ok'       - slot reserved (counter incremented)
--   'quota'    - daily limit reached
--   'circuit'  - breaker open after repeated quota errors
create or replace function public.try_acquire_ai_slot(p_limit int)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_circuit public.ai_circuit%rowtype;
begin
  select * into v_circuit from public.ai_circuit where id = 1 for update;

  if v_circuit.open_until is not null and v_circuit.open_until > now() then
    return 'circuit';
  end if;

  insert into public.ai_usage (day, requests) values (current_date, 1)
  on conflict (day) do update set requests = public.ai_usage.requests + 1;

  if (select requests from public.ai_usage where day = current_date) > greatest(p_limit, 0) then
    return 'quota';
  end if;

  return 'ok';
end;
$$;

revoke execute on function public.try_acquire_ai_slot(int) from public, anon, authenticated;
grant execute on function public.try_acquire_ai_slot(int) to service_role;

-- Records a Gemini outcome. Quota errors charge the breaker (5 in a row
-- opens it for 15 minutes); any other outcome resets the streak.
create or replace function public.note_ai_outcome(p_quota_err boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ai_circuit (id) values (1)
  on conflict (id) do nothing;

  if p_quota_err then
    update public.ai_circuit
    set consecutive_quota_errors = consecutive_quota_errors + 1
    where id = 1;

    update public.ai_circuit
    set open_until = now() + interval '15 minutes',
        consecutive_quota_errors = 0
    where id = 1 and consecutive_quota_errors >= 5;
  else
    update public.ai_circuit
    set consecutive_quota_errors = 0
    where id = 1;
  end if;
end;
$$;

revoke execute on function public.note_ai_outcome(boolean) from public, anon, authenticated;
grant execute on function public.note_ai_outcome(boolean) to service_role;

-- Atomically claim the user's newest unexpired pending confirmation.
-- Returns the payload json, or null when there is nothing to confirm.
create or replace function public.take_pending_confirm(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  delete from public.line_pending_confirms
  where event_key = (
    select event_key from public.line_pending_confirms
    where user_id = p_user_id and expires_at > now()
    order by created_at desc
    limit 1
    for update
  )
  returning event_key, payload into v_row;

  if not found then
    return null;
  end if;
  return json_build_object('event_key', v_row.event_key, 'payload', v_row.payload);
end;
$$;

revoke execute on function public.take_pending_confirm(uuid) from public, anon, authenticated;
grant execute on function public.take_pending_confirm(uuid) to service_role;
