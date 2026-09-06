-- Review-fix batch: atomic confirm (F4), idempotent recurring creation (F5),
-- budget-alert delivery states (F6), category-id in summaries (F7).

-- ---- F6: alert rows carry delivery state ----
alter table public.budget_alerts
  add column if not exists status text not null default 'sent'
    check (status in ('pending', 'sent'));
-- Existing rows were actually pushed, so they backfill as sent.

-- ---- F7: summary keyed by category id (display names can collide) ----
create or replace function public.line_range_summary(
  p_user_id uuid,
  p_from date,
  p_to date
)
returns json
language sql
security definer
set search_path = ''
as $$
  select json_build_object(
    'income', coalesce((
      select sum(amount) from public.transactions
      where user_id = p_user_id and type = 'income'
        and transaction_date between p_from and p_to
    ), 0),
    'expense', coalesce((
      select sum(amount) from public.transactions
      where user_id = p_user_id and type = 'expense'
        and transaction_date between p_from and p_to
    ), 0),
    'categories', coalesce((
      select json_agg(
        json_build_object('type', t.type, 'category_id', t.category_id, 'icon', c.icon, 'name', c.name_th, 'total', t.total)
        order by t.total desc
      )
      from (
        select tx.type, tx.category_id, sum(tx.amount) as total
        from public.transactions tx
        where tx.user_id = p_user_id and tx.type <> 'transfer'
          and tx.transaction_date between p_from and p_to
        group by tx.type, tx.category_id
      ) t
      join public.categories c on c.id = t.category_id
    ), json_build_array())
  );
$$;

revoke execute on function public.line_range_summary(uuid, date, date) from public, anon, authenticated;
grant execute on function public.line_range_summary(uuid, date, date) to service_role;

-- ---- F4: atomic confirmation ----
-- Consumes the newest unexpired pending confirm AND saves the transaction
-- AND records the command result in ONE transaction: a crash between any
-- of them rolls the whole thing back, so ใช่ can be retried safely.

create or replace function public.confirm_pending_line_transaction(
  p_event_key text,
  p_user_id uuid
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending record;
  v_category record;
  v_result jsonb;
begin
  if p_event_key is not null and p_event_key <> '' then
    select r.result into v_result
    from public.line_command_results r
    where r.event_key = p_event_key;
    if v_result is not null then
      if v_result->>'status' = 'pending' then
        raise exception 'command in progress';
      end if;
      return v_result;
    end if;

    insert into public.line_command_results (event_key, result)
    values (p_event_key, jsonb_build_object('status', 'pending'))
    on conflict (event_key) do nothing;
    if not found then
      raise exception 'command in progress';
    end if;
  end if;

  delete from public.line_pending_confirms
  where event_key = (
    select event_key from public.line_pending_confirms
    where user_id = p_user_id and expires_at > now()
    order by created_at desc
    limit 1
    for update
  )
  returning * into v_pending;

  if not found then
    v_result := json_build_object('status', 'nothing_pending');
  else
    insert into public.webhook_events (id) values (v_pending.event_key)
    on conflict (id) do nothing;

    if not found then
      v_result := json_build_object('status', 'duplicate');
    else
      select id, icon, name_th, type into v_category
      from public.categories
      where slug = v_pending.payload->>'category'
        and (user_id is null or user_id = p_user_id)
      order by user_id nulls last
      limit 1;

      if v_category.id is null or v_category.type is distinct from v_pending.payload->>'type' then
        delete from public.webhook_events where id = v_pending.event_key;
        v_result := json_build_object('status', 'invalid_category');
      else
        insert into public.transactions
          (user_id, type, amount, category_id, description, transaction_date, source)
        values
          (p_user_id,
           v_pending.payload->>'type',
           (v_pending.payload->>'amount')::numeric,
           v_category.id,
           coalesce(v_pending.payload->>'description', ''),
           (v_pending.payload->>'date')::date,
           'line');

        v_result := json_build_object(
          'status', 'saved',
          'amount', (v_pending.payload->>'amount')::numeric,
          'description', v_pending.payload->>'description',
          'icon', v_category.icon,
          'name', v_category.name_th
        );
      end if;
    end if;
  end if;

  update public.line_command_results
  set result = v_result
  where event_key = p_event_key;

  return v_result;
end;
$$;

revoke execute on function public.confirm_pending_line_transaction(text, uuid) from public, anon, authenticated;
grant execute on function public.confirm_pending_line_transaction(text, uuid) to service_role;

-- ---- F5: idempotent recurring-rule creation ----

create or replace function public.create_recurring_rule(
  p_event_key text,
  p_user_id uuid,
  p_category_slug text,
  p_description text,
  p_amount numeric,
  p_type text,
  p_day_of_month int
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category record;
  v_rule_id uuid;
  v_result jsonb;
begin
  if p_event_key is not null and p_event_key <> '' then
    select r.result into v_result
    from public.line_command_results r
    where r.event_key = p_event_key;
    if v_result is not null then
      if v_result->>'status' = 'pending' then
        raise exception 'command in progress';
      end if;
      return v_result;
    end if;

    insert into public.line_command_results (event_key, result)
    values (p_event_key, jsonb_build_object('status', 'pending'))
    on conflict (event_key) do nothing;
    if not found then
      raise exception 'command in progress';
    end if;
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > 999999999
     or p_day_of_month < 1 or p_day_of_month > 28 then
    v_result := json_build_object('status', 'invalid_input');
  else
    select id, type, icon, name_th into v_category
    from public.categories
    where slug = p_category_slug
      and (user_id is null or user_id = p_user_id)
    order by user_id nulls last
    limit 1;

    if v_category.id is null or v_category.type is distinct from p_type then
      v_result := json_build_object('status', 'invalid_category');
    else
      insert into public.recurring_rules
        (user_id, category_id, description, amount, type, day_of_month)
      values
        (p_user_id, v_category.id, p_description, p_amount, p_type, p_day_of_month)
      returning id into v_rule_id;

      v_result := json_build_object(
        'status', 'created',
        'id', v_rule_id,
        'icon', v_category.icon,
        'name', v_category.name_th
      );
    end if;
  end if;

  update public.line_command_results
  set result = v_result
  where event_key = p_event_key;

  return v_result;
end;
$$;

revoke execute on function public.create_recurring_rule(text, uuid, text, text, numeric, text, int) from public, anon, authenticated;
grant execute on function public.create_recurring_rule(text, uuid, text, text, numeric, text, int) to service_role;
