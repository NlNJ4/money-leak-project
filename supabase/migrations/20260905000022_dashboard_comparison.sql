-- Phase 7.5: month-over-month comparison.
-- dashboard_summary gains a `previous` block: the same totals computed for
-- the immediately preceding period of equal length.
-- Rollback: re-apply migration 20260829000009's dashboard_summary body.

create or replace function public.dashboard_summary(p_from date, p_to date)
returns json
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      p_from as f,
      p_to as t,
      (p_to - p_from + 1) as days,
      date_trunc('month', p_from) = p_from AND
        (p_to - p_from + 1) = extract(day from (date_trunc('month', p_from) + interval '1 month - 1 day'))::int
        as is_calendar_month
  ),
  prev_bounds as (
    select
      case when (select is_calendar_month from bounds)
        then (date_trunc('month', (select f from bounds)) - interval '1 month')::date
        else (select f from bounds) - (select days from bounds)
      end as f,
      case when (select is_calendar_month from bounds)
        then (date_trunc('month', (select f from bounds)) - interval '1 day')::date
        else (select f from bounds) - 1
      end as t
  ),
  agg as (
    select
      coalesce(sum(amount) filter (where type = 'income'), 0) as income,
      coalesce(sum(amount) filter (where type = 'expense'), 0) as expense
    from public.transactions
    where user_id = (select auth.uid())
      and transaction_date between (select f from bounds) and (select t from bounds)
  ),
  prev_agg as (
    select
      coalesce(sum(amount) filter (where type = 'income'), 0) as income,
      coalesce(sum(amount) filter (where type = 'expense'), 0) as expense
    from public.transactions
    where user_id = (select auth.uid())
      and transaction_date between (select f from prev_bounds) and (select t from prev_bounds)
  ),
  by_cat as (
    select
      c.slug, c.icon, c.name_th, c.name_en, tx.type,
      sum(tx.amount) as total
    from public.transactions tx
    join public.categories c on c.id = tx.category_id
    where tx.user_id = (select auth.uid())
      and tx.transaction_date between (select f from bounds) and (select t from bounds)
    group by c.slug, c.icon, c.name_th, c.name_en, tx.type
  ),
  daily as (
    select
      to_char(d, 'YYYY-MM-DD') as date,
      coalesce(sum(tx.amount) filter (where tx.type = 'expense'), 0) as expense
    from generate_series(
      (select f from bounds)::timestamp,
      (select t from bounds)::timestamp,
      interval '1 day'
    ) d
    left join public.transactions tx
      on tx.user_id = (select auth.uid())
      and tx.transaction_date = d::date
    group by d
  )
  select json_build_object(
    'totals', json_build_object(
      'income', (select income from agg),
      'expense', (select expense from agg),
      'net', (select income - expense from agg)
    ),
    'previous', json_build_object(
      'income', (select income from prev_agg),
      'expense', (select expense from prev_agg),
      'net', (select income - expense from prev_agg)
    ),
    'byCategory', coalesce((
      select json_agg(
        json_build_object(
          'slug', slug, 'icon', icon, 'name_th', name_th,
          'name_en', name_en, 'type', type, 'total', total
        ) order by total desc
      )
      from by_cat
    ), json_build_array()),
    'dailyTotals', coalesce((
      select json_agg(json_build_object('date', date, 'expense', expense) order by date)
      from daily
    ), json_build_array())
  );
$$;
