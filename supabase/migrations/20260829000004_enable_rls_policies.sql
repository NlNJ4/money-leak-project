-- Tenant isolation: users only touch their own rows; categories are a
-- shared read-only reference. Writes to categories happen via service role.
alter table public.categories enable row level security;
alter table public.user_identities enable row level security;
alter table public.transactions enable row level security;

create policy "categories_select_authenticated"
  on public.categories for select
  to authenticated
  using (true);

create policy "user_identities_select_own"
  on public.user_identities for select
  to authenticated
  using (user_id = auth.uid());

create policy "user_identities_insert_own"
  on public.user_identities for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "user_identities_update_own"
  on public.user_identities for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "user_identities_delete_own"
  on public.user_identities for delete
  to authenticated
  using (user_id = auth.uid());

create policy "transactions_select_own"
  on public.transactions for select
  to authenticated
  using (user_id = auth.uid());

create policy "transactions_insert_own"
  on public.transactions for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "transactions_update_own"
  on public.transactions for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "transactions_delete_own"
  on public.transactions for delete
  to authenticated
  using (user_id = auth.uid());
