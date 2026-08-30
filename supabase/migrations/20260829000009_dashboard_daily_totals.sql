-- Adds a zero-filled daily expense series to the dashboard summary so the
-- chart can draw an honest time axis (days with no spending show as 0).

create or replace function public.dashboard_summary(p_from date, p_to date)
returns json
language sql
stable
set search_path = ''
as $$
  with agg as (
    select
      coalesce(sum(t.amount) filter (where t.type = 'income'), 0) as income,
      coalesce(sum(t.amount) filter (where t.type = 'expense'), 0) as expense
    from public.transactions t
    where t.user_id = (select auth.uid())
      and t.transaction_date between p_from and p_to
  ),
  cats as (
    select c.slug, c.icon, c.name_th, c.name_en, tx.type, sum(tx.amount) as total
    from public.transactions tx
    join public.categories c on c.id = tx.category_id
    where tx.user_id = (select auth.uid())
      and tx.type <> 'transfer'
      and tx.transaction_date between p_from and p_to
    group by c.slug, c.icon, c.name_th, c.name_en, tx.type
  ),
  daily as (
    select
      d::date as day,
      coalesce(sum(tx.amount) filter (where tx.type = 'expense'), 0) as expense
    from generate_series(p_from, p_to, interval '1 day') as d
    left join public.transactions tx
      on tx.transaction_date = d::date
      and tx.user_id = (select auth.uid())
    group by d::date
    order by d::date
  )
  select json_build_object(
    'totals', json_build_object(
      'income', (select income from agg),
      'expense', (select expense from agg),
      'net', (select income - expense from agg)
    ),
    'byCategory', coalesce((
      select json_agg(
        json_build_object(
          'slug', slug,
          'icon', icon,
          'name_th', name_th,
          'name_en', name_en,
          'type', type,
          'total', total
        ) order by total desc
      )
      from cats
    ), json_build_array()),
    'dailyTotals', coalesce((
      select json_agg(
        json_build_object('date', day, 'expense', expense)
        order by day
      )
      from daily
    ), json_build_array())
  )
$$;

revoke execute on function public.dashboard_summary(date, date) from public, anon;
