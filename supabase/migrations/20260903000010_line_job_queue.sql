-- Durable LINE webhook processing (roadmap Phase 2, first delivery package).
-- Jobs are persisted BEFORE the webhook acknowledges, so an accepted message
-- can never be lost to a function crash or a Gemini outage. Retries are
-- claimed atomically and dead-letter after repeated failure. This table is
-- separate from webhook_events, which stays the save-side dedup marker used
-- by save_line_transaction.

create table public.line_jobs (
  id text primary key,              -- LINE webhookEventId (event key)
  line_user_id text not null,
  reply_token text not null,
  text text not null,               -- minimum needed to defer processing
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry', 'completed', 'dead')),
  attempts int not null default 0,
  next_retry_at timestamptz not null default now(),
  claimed_at timestamptz,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.line_jobs enable row level security;
-- No policies: only the service role (webhook worker) touches this table.

create index line_jobs_due_idx on public.line_jobs (status, next_retry_at)
  where status in ('pending', 'retry');

create index line_jobs_stale_idx on public.line_jobs (claimed_at)
  where status = 'processing';

-- Atomically claim due jobs (pending/retry) and re-claim rows stuck in
-- 'processing' for over 10 minutes (worker died mid-flight). SKIP LOCKED
-- lets concurrent webhook invocations work side by side without
-- double-processing the same event.
create or replace function public.claim_due_line_jobs(p_limit int)
returns setof public.line_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    update public.line_jobs j
    set status = 'processing',
        attempts = j.attempts + 1,
        claimed_at = now()
    from (
      select id
      from public.line_jobs
      where (status in ('pending', 'retry') and next_retry_at <= now())
         or (status = 'processing' and claimed_at < now() - interval '10 minutes')
      order by next_retry_at
      limit greatest(p_limit, 1)
      for update skip locked
    ) claimed
    where j.id = claimed.id
    returning j.*;
end;
$$;

revoke execute on function public.claim_due_line_jobs(int) from public, anon, authenticated;

-- Undo latest: resolve the LINE identity, lock the newest transaction,
-- delete it. Atomic so two rapid "ลบล่าสุด" commands cannot delete two
-- rows (roadmap Phase 3, undo slice of the first delivery package).
create or replace function public.delete_latest_line_transaction(p_line_user_id text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_row record;
begin
  select user_id into v_user_id
  from public.user_identities
  where provider = 'line' and provider_user_id = p_line_user_id;

  if v_user_id is null then
    return json_build_object('status', 'not_linked');
  end if;

  select t.id, t.type, t.amount, t.description, c.icon, c.name_th
    into v_row
  from public.transactions t
  join public.categories c on c.id = t.category_id
  where t.user_id = v_user_id
  order by t.created_at desc, t.id desc
  limit 1
  for update of t;

  if not found then
    return json_build_object('status', 'not_found');
  end if;

  delete from public.transactions where id = v_row.id;

  return json_build_object(
    'status', 'deleted',
    'type', v_row.type,
    'amount', v_row.amount,
    'description', v_row.description,
    'icon', v_row.icon,
    'name', v_row.name_th
  );
end;
$$;

revoke execute on function public.delete_latest_line_transaction(text) from public, anon, authenticated;
