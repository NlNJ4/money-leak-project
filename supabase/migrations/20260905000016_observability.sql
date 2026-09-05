-- Phase 4: worker observability. Daily metric counters (no message text,
-- no user ids — keys are enum-like strings only) and a worker heartbeat
-- so a stopped scheduler is detectable.

create table if not exists public.line_metrics (
  day date not null,
  key text not null,
  count bigint not null default 0,
  primary key (day, key)
);

alter table public.line_metrics enable row level security;
revoke all on public.line_metrics from anon, authenticated;
grant all on public.line_metrics to service_role;

create table if not exists public.worker_heartbeat (
  id int primary key default 1 check (id = 1),
  last_run_at timestamptz not null default now()
);

alter table public.worker_heartbeat enable row level security;
revoke all on public.worker_heartbeat from anon, authenticated;
grant all on public.worker_heartbeat to service_role;

-- Atomic upsert-increment for a batch of metric keys (today).
create or replace function public.bump_metrics(p_keys text[])
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.line_metrics (day, key, count)
  select current_date, k, 1
  from unnest(p_keys) as k
  on conflict (day, key) do update set count = public.line_metrics.count + 1;
$$;

revoke execute on function public.bump_metrics(text[]) from public, anon, authenticated;
grant execute on function public.bump_metrics(text[]) to service_role;

create or replace function public.touch_heartbeat()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.worker_heartbeat (id, last_run_at)
  values (1, now())
  on conflict (id) do update set last_run_at = now();
$$;

revoke execute on function public.touch_heartbeat() from public, anon, authenticated;
grant execute on function public.touch_heartbeat() to service_role;
