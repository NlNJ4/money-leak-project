create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('income', 'expense', 'transfer')),
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null default 'THB',
  category_id uuid not null references public.categories (id),
  description text not null default '',
  transaction_date date not null default current_date,
  source text not null default 'web' check (source in ('line', 'web', 'receipt')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index transactions_user_date_idx on public.transactions (user_id, transaction_date desc);
create index transactions_user_category_idx on public.transactions (user_id, category_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();
