-- Phase 7.1: monthly category budgets.
-- Rollback: drop table public.budgets; drop function public.budget_progress(date);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id),
  month date not null,                    -- always the first day of the month
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category_id, month)
);

alter table public.budgets enable row level security;

create policy "budgets_select_own" on public.budgets
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "budgets_insert_own" on public.budgets
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "budgets_update_own" on public.budgets
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "budgets_delete_own" on public.budgets
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.budgets to authenticated;
grant all on public.budgets to service_role;
create index budgets_user_month_idx on public.budgets (user_id, month);

-- Budget progress for a month: budget amount vs month-to-date expense per
-- category (RLS applies — SECURITY INVOKER over the caller's own rows).
create or replace function public.budget_progress(p_month date)
returns json
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(json_agg(progress order by progress.pct desc), json_build_array())
  from (
    select
      c.slug,
      c.icon,
      c.name_th,
      c.name_en,
      b.amount as budget,
      coalesce(spent.total, 0) as spent,
      case when b.amount > 0
        then round((coalesce(spent.total, 0) / b.amount) * 100, 1)
        else 0
      end as pct
    from public.budgets b
    join public.categories c on c.id = b.category_id
    left join (
      select tx.category_id, sum(tx.amount) as total
      from public.transactions tx
      where tx.user_id = (select auth.uid())
        and tx.type = 'expense'
        and tx.transaction_date >= date_trunc('month', p_month)
        and tx.transaction_date < date_trunc('month', p_month) + interval '1 month'
      group by tx.category_id
    ) spent on spent.category_id = b.category_id
    where b.user_id = (select auth.uid())
      and b.month = date_trunc('month', p_month)
  ) progress;
$$;

revoke execute on function public.budget_progress(date) from public, anon;
grant execute on function public.budget_progress(date) to authenticated, service_role;
