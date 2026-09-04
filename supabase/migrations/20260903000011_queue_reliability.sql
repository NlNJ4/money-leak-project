-- Queue reliability + privacy (post-ship audit gaps 1-5).

-- Delivery separation (gaps 2/3): the computed reply is persisted on the
-- job so a failed reply can be re-delivered WITHOUT re-running transaction
-- processing. Payload columns become nullable because completed jobs clear
-- message text and reply tokens immediately (gap 5).
alter table public.line_jobs
  add column if not exists reply_text text,
  alter column text drop not null,
  alter column reply_token drop not null;

-- Worker auth tokens for the scheduled sweep endpoint (gap 3). Tokens are
-- generated in-database and never appear in code or environment files.
create table if not exists public.line_worker_tokens (
  token text primary key,
  created_at timestamptz not null default now()
);

alter table public.line_worker_tokens enable row level security;

-- Explicit privilege lockdown on service-role-only tables (gap 5): RLS
-- with no policies already blocks row access; these remove table
-- privileges entirely so even schema-level access is denied.
revoke all on public.line_jobs from anon, authenticated;
revoke all on public.webhook_events from anon, authenticated;
revoke all on public.line_worker_tokens from anon, authenticated;

-- Retention cleanup moves out of the per-save hot path (gap 5): the
-- scheduled worker deletes old webhook_events markers, so this function no
-- longer runs a DELETE on every transaction save. Save semantics are
-- otherwise identical to migration 7.
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
