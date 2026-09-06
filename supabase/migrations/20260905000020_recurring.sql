-- Phase 7.3: recurring income and expenses.
-- Rules are materialized once per month by the daily watchdog; the
-- webhook_events marker (recurring:{rule_id}:{month}) makes each
-- materialization idempotent. next_run tracking avoids re-scanning.
-- Rollback: drop table public.recurring_rules;

alter table public.transactions
  drop constraint transactions_source_check;
alter table public.transactions
  add constraint transactions_source_check
    check (source in ('line', 'web', 'receipt', 'recurring'));

create table public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id),
  description text not null default '',
  amount numeric(14,2) not null check (amount > 0),
  type text not null check (type in ('income', 'expense')),
  day_of_month int not null check (day_of_month between 1 and 28),
  active boolean not null default true,
  last_materialized_month date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.recurring_rules enable row level security;

create policy "recurring_select_own" on public.recurring_rules
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "recurring_insert_own" on public.recurring_rules
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "recurring_update_own" on public.recurring_rules
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "recurring_delete_own" on public.recurring_rules
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.recurring_rules to authenticated;
grant all on public.recurring_rules to service_role;
create index recurring_rules_due_idx on public.recurring_rules (active, day_of_month);

-- Materialize every due rule for the given month. SECURITY DEFINER so the
-- cron (service role) can act across all users; each transaction still
-- belongs to the rule's owner. Idempotency: the recurring marker in
-- webhook_events + last_materialized_month advance only on success.
create or replace function public.materialize_recurring(p_month date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule record;
  v_category record;
  v_month_start date := date_trunc('month', p_month);
  v_marker text;
  v_created int := 0;
begin
  for v_rule in
    select * from public.recurring_rules
    where active
      and day_of_month <= extract(day from p_month)::int
      and (last_materialized_month is null or last_materialized_month < v_month_start)
  loop
    select id, type into v_category
    from public.categories
    where id = v_rule.category_id;

    if v_category is null or v_category.type is distinct from v_rule.type then
      continue;
    end if;

    v_marker := 'recurring:' || v_rule.id || ':' || to_char(v_month_start, 'YYYY-MM');

    insert into public.webhook_events (id) values (v_marker)
    on conflict (id) do nothing;

    if not found then
      -- Already materialized this month (e.g. after a partial failure).
      update public.recurring_rules
      set last_materialized_month = v_month_start
      where id = v_rule.id;
      continue;
    end if;

    begin
      insert into public.transactions
        (user_id, type, amount, category_id, description, transaction_date, source)
      values
        (v_rule.user_id, v_rule.type, v_rule.amount, v_category.id,
         v_rule.description,
         least(v_month_start + (v_rule.day_of_month - 1), p_month)::date,
         'recurring');
      v_created := v_created + 1;

      update public.recurring_rules
      set last_materialized_month = v_month_start
      where id = v_rule.id;
    exception when others then
      -- Release the marker so a transient failure retries tomorrow.
      delete from public.webhook_events where id = v_marker;
      raise;
    end;
  end loop;

  return v_created;
end;
$$;

revoke execute on function public.materialize_recurring(date) from public, anon, authenticated;
grant execute on function public.materialize_recurring(date) to service_role;
