create table if not exists public.line_users (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  display_name text,
  daily_budget_baht integer not null default 200 check (daily_budget_baht > 0),
  monthly_budget_baht integer not null default 6000 check (monthly_budget_baht > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null references public.line_users(line_user_id) on delete cascade,
  title text not null,
  amount_baht integer not null check (amount_baht > 0),
  category text not null,
  is_need boolean not null default false,
  spent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists expenses_line_user_spent_at_idx
  on public.expenses (line_user_id, spent_at desc);

create index if not exists expenses_line_user_category_idx
  on public.expenses (line_user_id, category);

alter table public.line_users enable row level security;
alter table public.expenses enable row level security;
