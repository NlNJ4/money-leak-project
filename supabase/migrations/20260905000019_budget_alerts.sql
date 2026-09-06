-- Phase 7.2: budget warning notifications.
-- One push per (user, category, month, level): the guard row makes the
-- send idempotent even across concurrent saves or cron runs.
-- Rollback: drop table public.budget_alerts;

create table public.budget_alerts (
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  month date not null,
  level text not null check (level in ('80', '100')),
  sent_at timestamptz not null default now(),
  primary key (user_id, category_id, month, level)
);

alter table public.budget_alerts enable row level security;
revoke all on public.budget_alerts from anon, authenticated;
grant all on public.budget_alerts to service_role;
