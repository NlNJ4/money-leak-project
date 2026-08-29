-- One-time codes for connecting a LINE identity to a web (Google) account.
-- The dashboard creates a code; the user sends it to the LINE bot (spec 14).
create table public.linking_codes (
  code text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index linking_codes_user_id_idx on public.linking_codes (user_id);

alter table public.linking_codes enable row level security;

create policy "linking_codes_select_own"
  on public.linking_codes for select
  to authenticated
  using (user_id = auth.uid());

create policy "linking_codes_insert_own"
  on public.linking_codes for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "linking_codes_delete_own"
  on public.linking_codes for delete
  to authenticated
  using (user_id = auth.uid());
