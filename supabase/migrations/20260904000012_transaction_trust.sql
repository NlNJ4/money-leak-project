-- Phase 4: transaction trust — restore window for LINE deletions and
-- latest-amount correction. delete_latest_line_transaction now snapshots
-- the row into deleted_transaction_staging instead of destroying it, so
-- "กู้คืน" can bring it back within a short window (the window replaces a
-- separate confirmation step: delete is instant, undo is time-boxed).

create table public.deleted_transaction_staging (
  id uuid primary key,             -- the original transaction id
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,          -- full row snapshot
  deleted_at timestamptz not null default now()
);

alter table public.deleted_transaction_staging enable row level security;
-- No policies + revoked privileges: service-role only.

revoke all on public.deleted_transaction_staging from anon, authenticated;

create index deleted_transaction_staging_user_idx
  on public.deleted_transaction_staging (user_id, deleted_at desc);

create or replace function public.delete_latest_line_transaction(p_line_user_id text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_row record;
  v_payload jsonb;
begin
  select user_id into v_user_id
  from public.user_identities
  where provider = 'line' and provider_user_id = p_line_user_id;

  if v_user_id is null then
    return json_build_object('status', 'not_linked');
  end if;

  select to_jsonb(t) into v_payload
  from public.transactions t
  where t.user_id = v_user_id
  order by t.created_at desc, t.id desc
  limit 1
  for update of t;

  if v_payload is null then
    return json_build_object('status', 'not_found');
  end if;

  insert into public.deleted_transaction_staging (id, user_id, payload)
  values ((v_payload->>'id')::uuid, v_user_id, v_payload)
  on conflict (id) do update set payload = excluded.payload, deleted_at = now();

  delete from public.transactions where id = (v_payload->>'id')::uuid;

  select c.icon, c.name_th into v_row
  from public.categories c
  where c.id = (v_payload->>'category_id')::uuid;

  return json_build_object(
    'status', 'deleted',
    'type', v_payload->>'type',
    'amount', (v_payload->>'amount')::numeric,
    'description', v_payload->>'description',
    'icon', coalesce(v_row.icon, '📦'),
    'name', coalesce(v_row.name_th, '')
  );
end;
$$;

revoke execute on function public.delete_latest_line_transaction(text) from public, anon, authenticated;

create or replace function public.restore_latest_line_transaction(p_line_user_id text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_staging record;
begin
  select user_id into v_user_id
  from public.user_identities
  where provider = 'line' and provider_user_id = p_line_user_id;

  if v_user_id is null then
    return json_build_object('status', 'not_linked');
  end if;

  select * into v_staging
  from public.deleted_transaction_staging
  where user_id = v_user_id
    and deleted_at > now() - interval '2 minutes'
  order by deleted_at desc
  limit 1
  for update;

  if not found then
    return json_build_object('status', 'nothing_to_restore');
  end if;

  insert into public.transactions
    (id, user_id, type, amount, category_id, description, transaction_date, source, currency, created_at)
  values
    ((v_staging.payload->>'id')::uuid,
     (v_staging.payload->>'user_id')::uuid,
     v_staging.payload->>'type',
     (v_staging.payload->>'amount')::numeric,
     (v_staging.payload->>'category_id')::uuid,
     v_staging.payload->>'description',
     (v_staging.payload->>'transaction_date')::date,
     v_staging.payload->>'source',
     v_staging.payload->>'currency',
     (v_staging.payload->>'created_at')::timestamptz);

  delete from public.deleted_transaction_staging where id = v_staging.id;

  return json_build_object(
    'status', 'restored',
    'type', v_staging.payload->>'type',
    'amount', (v_staging.payload->>'amount')::numeric,
    'description', v_staging.payload->>'description'
  );
end;
$$;

revoke execute on function public.restore_latest_line_transaction(text) from public, anon, authenticated;

create or replace function public.update_latest_line_transaction_amount(
  p_line_user_id text,
  p_amount numeric
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_row record;
  v_description text;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 999999999 then
    return json_build_object('status', 'invalid_amount');
  end if;

  select user_id into v_user_id
  from public.user_identities
  where provider = 'line' and provider_user_id = p_line_user_id;

  if v_user_id is null then
    return json_build_object('status', 'not_linked');
  end if;

  select t.id, c.icon, c.name_th into v_row
  from public.transactions t
  join public.categories c on c.id = t.category_id
  where t.user_id = v_user_id
  order by t.created_at desc, t.id desc
  limit 1
  for update of t;

  if not found then
    return json_build_object('status', 'not_found');
  end if;

  update public.transactions
  set amount = p_amount
  where id = v_row.id
  returning description into v_description;

  return json_build_object(
    'status', 'updated',
    'amount', p_amount,
    'description', v_description,
    'icon', v_row.icon,
    'name', v_row.name_th
  );
end;
$$;

revoke execute on function public.update_latest_line_transaction_amount(text, numeric) from public, anon, authenticated;
