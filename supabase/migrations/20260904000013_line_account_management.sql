-- Phase 6: LINE account management — database-backed redemption rate
-- limiting (replaces the per-instance in-memory limiter, which cannot
-- protect a multi-instance deploy).

create table public.line_redeem_attempts (
  line_user_id text primary key,
  window_start timestamptz not null default now(),
  count int not null default 1
);

alter table public.line_redeem_attempts enable row level security;
-- No policies + revoked privileges: service-role only.

revoke all on public.line_redeem_attempts from anon, authenticated;

-- Atomic sliding-window limiter: 5 attempts per LINE user per hour.
-- Returns true when the attempt is allowed.
create or replace function public.register_redeem_attempt(p_line_user_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.line_redeem_attempts%rowtype;
begin
  insert into public.line_redeem_attempts (line_user_id)
  values (p_line_user_id)
  on conflict (line_user_id) do update
    set count = case
          when public.line_redeem_attempts.window_start < now() - interval '1 hour'
            then 1
          else public.line_redeem_attempts.count + 1
        end,
        window_start = case
          when public.line_redeem_attempts.window_start < now() - interval '1 hour'
            then now()
          else public.line_redeem_attempts.window_start
        end
  returning * into v_row;

  return v_row.count <= 5;
end;
$$;

revoke execute on function public.register_redeem_attempt(text) from public, anon, authenticated;
