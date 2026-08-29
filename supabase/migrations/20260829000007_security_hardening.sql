-- Security hardening (audit items 1, 2, 3, 4, 14, 16, 17).

-- ---- 16/17: RLS performance pattern + FK cascade index ----

drop policy if exists "categories_select_authenticated" on public.categories;
create policy "categories_select_authenticated"
  on public.categories for select
  to authenticated
  using (true);

drop policy if exists "user_identities_select_own" on public.user_identities;
create policy "user_identities_select_own"
  on public.user_identities for select
  to authenticated
  using (user_id = (select auth.uid()));

-- 3: identity writes must go through the privileged redeem RPC, not the
-- Data API — a client must never be able to claim an arbitrary LINE ID.
drop policy if exists "user_identities_insert_own" on public.user_identities;
drop policy if exists "user_identities_update_own" on public.user_identities;

drop policy if exists "user_identities_delete_own" on public.user_identities;
create policy "user_identities_delete_own"
  on public.user_identities for delete
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "transactions_select_own" on public.transactions;
create policy "transactions_select_own"
  on public.transactions for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "transactions_insert_own" on public.transactions;
create policy "transactions_insert_own"
  on public.transactions for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "transactions_update_own" on public.transactions;
create policy "transactions_update_own"
  on public.transactions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "transactions_delete_own" on public.transactions;
create policy "transactions_delete_own"
  on public.transactions for delete
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "linking_codes_select_own" on public.linking_codes;
create policy "linking_codes_select_own"
  on public.linking_codes for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "linking_codes_insert_own" on public.linking_codes;
create policy "linking_codes_insert_own"
  on public.linking_codes for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "linking_codes_delete_own" on public.linking_codes;
create policy "linking_codes_delete_own"
  on public.linking_codes for delete
  to authenticated
  using (user_id = (select auth.uid()));

create index if not exists transactions_category_id_idx
  on public.transactions (category_id);

-- ---- 4: webhook idempotency ----

create table public.webhook_events (
  id text primary key,
  received_at timestamptz not null default now()
);

alter table public.webhook_events enable row level security;
-- No policies: only the service role (LINE webhook) touches this table.

-- ---- 2: atomic code redemption ----

create or replace function public.redeem_linking_code(
  p_code text,
  p_provider text,
  p_provider_user_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code_user_id uuid;
  v_expires_at timestamptz;
  v_existing_user_id uuid;
begin
  select user_id, expires_at
    into v_code_user_id, v_expires_at
    from public.linking_codes
    where code = p_code
    for update;

  if not found then
    return 'not_found';
  end if;

  if v_expires_at < now() then
    delete from public.linking_codes where code = p_code;
    return 'expired';
  end if;

  select user_id into v_existing_user_id
    from public.user_identities
    where provider = p_provider
      and provider_user_id = p_provider_user_id;

  if v_existing_user_id is not null then
    if v_existing_user_id = v_code_user_id then
      delete from public.linking_codes where code = p_code;
      return 'already_linked_same';
    end if;
    -- Do not consume someone else's code; rate limiting handles abuse.
    return 'already_linked_other';
  end if;

  insert into public.user_identities (user_id, provider, provider_user_id)
  values (v_code_user_id, p_provider, p_provider_user_id);

  delete from public.linking_codes where code = p_code;
  return 'linked';
end;
$$;

revoke execute on function public.redeem_linking_code(text, text, text) from public, anon, authenticated;

-- ---- 4: atomic (idempotent) transaction save for the webhook ----

create or replace function public.save_line_transaction(
  p_event_key text,
  p_user_id uuid,
  p_type text,
  p_amount numeric,
  p_category_slug text,
  p_description text,
  p_transaction_date date
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category_id uuid;
  v_category_type text;
begin
  -- Opportunistic cleanup of old dedup markers.
  delete from public.webhook_events
  where received_at < now() - interval '7 days';

  insert into public.webhook_events (id)
  values (p_event_key)
  on conflict (id) do nothing;

  if not found then
    return 'duplicate';
  end if;

  select id, type into v_category_id, v_category_type
    from public.categories
    where slug = p_category_slug;

  if v_category_id is null or v_category_type is distinct from p_type then
    return 'invalid_category';
  end if;

  insert into public.transactions
    (user_id, type, amount, category_id, description, transaction_date, source)
  values
    (p_user_id, p_type, p_amount, v_category_id, p_description, p_transaction_date, 'line');

  return 'saved';
end;
$$;

revoke execute on function public.save_line_transaction(text, uuid, text, numeric, text, text, date) from public, anon, authenticated;

-- ---- 14: category/type consistency, enforced by the database ----

create or replace function public.validate_transaction_category()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_category_type text;
begin
  if new.type = 'transfer' then
    return new;
  end if;
  select type into v_category_type
    from public.categories
    where id = new.category_id;
  if v_category_type is null or v_category_type <> new.type then
    raise exception 'category % does not match transaction type %', new.category_id, new.type;
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_validate_category on public.transactions;
create trigger transactions_validate_category
  before insert or update of type, category_id on public.transactions
  for each row execute function public.validate_transaction_category();
