-- Phase 7.4: custom categories.
-- System categories (the original 14) keep user_id NULL and stay shared.
-- A user's custom categories carry their user_id. Transaction rows may
-- reference either; the trigger now enforces ownership too.
-- Rollback: drop the new indexes/constraint, restore unique(slug), drop
-- user_id + is_custom columns, restore the old trigger body.

alter table public.categories
  add column user_id uuid references auth.users(id) on delete cascade;

-- Slug uniqueness becomes per-tenant: unique per user, and unique among
-- system rows. (A plain unique(user_id, slug) would treat NULLs as
-- distinct and lose system uniqueness.)
alter table public.categories drop constraint categories_slug_key;
create unique index categories_system_slug_idx on public.categories (slug)
  where user_id is null;
create unique index categories_user_slug_idx on public.categories (user_id, slug)
  where user_id is not null;

alter table public.categories
  add column is_custom boolean not null default false;

-- RLS: everyone reads system rows; owners read/write their custom rows.
drop policy "categories_select_authenticated" on public.categories;
create policy "categories_select_authenticated" on public.categories
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy "categories_insert_own" on public.categories
  for insert to authenticated
  with check (user_id = (select auth.uid()) and is_custom = true);
create policy "categories_update_own" on public.categories
  for update to authenticated
  using (user_id = (select auth.uid()) and is_custom = true)
  with check (user_id = (select auth.uid()) and is_custom = true);
create policy "categories_delete_own" on public.categories
  for delete to authenticated
  using (user_id = (select auth.uid()) and is_custom = true);

-- Custom-category CRUD needs write grants (system rows stay read-only to
-- clients: every write policy requires is_custom + ownership).
grant insert, update, delete on public.categories to authenticated;

-- The type-consistency trigger also enforces category ownership: a
-- transaction may use a system category or one of its own — never another
-- user's.
create or replace function public.validate_transaction_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category_type text;
  v_owner uuid;
begin
  if new.type = 'transfer' then
    return new;
  end if;
  select type, user_id into v_category_type, v_owner
    from public.categories
    where id = new.category_id;
  if v_category_type is null or v_category_type <> new.type then
    raise exception 'category % does not match transaction type %', new.category_id, new.type;
  end if;
  if v_owner is not null and v_owner is distinct from new.user_id then
    raise exception 'category % does not belong to user', new.category_id;
  end if;
  return new;
end;
$$;

-- save_line_transaction resolves slugs per user: custom categories must
-- win over system rows for the same slug.
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
  insert into public.webhook_events (id)
  values (p_event_key)
  on conflict (id) do nothing;

  if not found then
    return 'duplicate';
  end if;

  select id, type into v_category_id, v_category_type
    from public.categories
    where slug = p_category_slug
      and (user_id is null or user_id = p_user_id)
    order by user_id nulls last
    limit 1;

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
