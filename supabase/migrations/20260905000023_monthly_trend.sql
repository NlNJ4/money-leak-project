-- Phase 7.6: spending trend.
-- monthly_trend(p_months) returns per-month income/expense/net for the
-- trailing p_months calendar months (including the current), zero-filled.
-- Rollback: drop function public.monthly_trend(int);

create or replace function public.monthly_trend(p_months int)
returns json
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      date_trunc('month', now() at time zone 'Asia/Bangkok')::date
        - ((g - 1) || ' month')::interval as month_start
    from generate_series(1, greatest(p_months, 1)) g
    order by month_start
  ),
  sums as (
    select
      date_trunc('month', tx.transaction_date)::date as month_start,
      coalesce(sum(tx.amount) filter (where tx.type = 'income'), 0) as income,
      coalesce(sum(tx.amount) filter (where tx.type = 'expense'), 0) as expense
    from public.transactions tx
    where tx.user_id = (select auth.uid())
      and tx.transaction_date >= (select min(month_start) from bounds)
    group by 1
  )
  select json_agg(
    json_build_object(
      'month', to_char(b.month_start, 'YYYY-MM'),
      'income', coalesce(s.income, 0),
      'expense', coalesce(s.expense, 0),
      'net', coalesce(s.income, 0) - coalesce(s.expense, 0)
    ) order by b.month_start
  )
  from bounds b
  left join sums s on s.month_start = b.month_start;
$$;

revoke execute on function public.monthly_trend(int) from public, anon;
grant execute on function public.monthly_trend(int) to authenticated, service_role;
