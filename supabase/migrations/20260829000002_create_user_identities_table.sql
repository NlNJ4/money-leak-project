-- A user can hold several identities (Google for web, LINE for the bot)
-- that all map to one auth.users row (spec section 8).
create table public.user_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google', 'line')),
  provider_user_id text not null,
  created_at timestamptz not null default now(),
  unique (provider, provider_user_id)
);

create index user_identities_user_id_idx on public.user_identities (user_id);
