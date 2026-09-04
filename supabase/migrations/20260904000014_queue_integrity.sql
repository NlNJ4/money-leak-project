-- Data-integrity hardening from the production-safety review.
--
-- P1-1 Idempotent command results: mutating commands (undo/restore/edit/
--      redeem) store their result under the webhook event key in the SAME
--      transaction as the mutation, so a retried job replays the stored
--      result instead of operating on different data. save_line_transaction
--      already had this via webhook_events.
-- P1-2 Per-user FIFO: jobs carry the LINE event timestamp + batch position
--      and the claim RPC never skips ahead of a user's earlier live job.
-- P2-4 Cardinality: one linking code per user, one identity per
--      (user, provider), atomic code issuance.
-- P2-10 Bounded totals: line_range_summary aggregates in SQL (no 1000-row
--      hosted limit on summaries).
-- P2-12 Token bootstrap: a fresh install always has a worker token.

-- ---- P1-1 command result replay ----

create table public.line_command_results (
  event_key text primary key,
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.line_command_results enable row level security;
revoke all on public.line_command_results from anon, authenticated;

create index line_command_results_created_idx
  on public.line_command_results (created_at);

-- ---- P1-2 ordering columns ----

alter table public.line_jobs
  add column if not exists line_timestamp bigint not null default 0,
  add column if not exists batch_seq int not null default 0;

create index if not exists line_jobs_user_order_idx
  on public.line_jobs (line_user_id, line_timestamp, batch_seq);

-- Claim v2: strict per-user FIFO. A job is claimable only when no earlier
-- live job (pending/retry/processing) exists for the same LINE user, so
-- "กินข้าว 100" can never be overtaken by a later "ลบล่าสุด".
create or replace function public.claim_due_line_jobs(p_limit int)
returns setof public.line_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    update public.line_jobs j
    set status = 'processing',
        attempts = j.attempts + 1,
        claimed_at = now()
    from (
      select j2.id
      from public.line_jobs j2
      where (
        (j2.status in ('pending', 'retry') and j2.next_retry_at <= now())
        or (j2.status = 'processing' and j2.claimed_at < now() - interval '10 minutes')
      )
      and not exists (
        select 1 from public.line_jobs earlier
        where earlier.line_user_id = j2.line_user_id
          and earlier.id <> j2.id
          and earlier.status in ('pending', 'retry', 'processing')
          and (earlier.line_timestamp, earlier.batch_seq, earlier.received_at)
            < (j2.line_timestamp, j2.batch_seq, j2.received_at)
      )
      order by j2.line_timestamp, j2.batch_seq, j2.next_retry_at
      limit greatest(p_limit, 1)
      for update skip locked
    ) claimed
    where j.id = claimed.id
    returning j.*;
end;
$$;

revoke execute on function public.claim_due_line_jobs(int) from public, anon, authenticated;

-- ---- P1-1: idempotent undo ----

create or replace function public.delete_latest_line_transaction(
  p_event_key text,
  p_line_user_id text
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_row record;
  v_payload jsonb;
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

  select user_id into v_user_id
  from public.user_identities
  where provider = 'line' and provider_user_id = p_line_user_id;

  if v_user_id is null then
    v_result := json_build_object('status', 'not_linked');
  else
    select to_jsonb(t) into v_payload
    from public.transactions t
    where t.user_id = v_user_id
    order by t.created_at desc, t.id desc
    limit 1
    for update of t;

    if v_payload is null then
      v_result := json_build_object('status', 'not_found');
    else
      insert into public.deleted_transaction_staging (id, user_id, payload)
      values ((v_payload->>'id')::uuid, v_user_id, v_payload)
      on conflict (id) do update set payload = excluded.payload, deleted_at = now();

      delete from public.transactions where id = (v_payload->>'id')::uuid;

      select c.icon, c.name_th into v_row
      from public.categories c
      where c.id = (v_payload->>'category_id')::uuid;

      v_result := json_build_object(
        'status', 'deleted',
        'type', v_payload->>'type',
        'amount', (v_payload->>'amount')::numeric,
        'description', v_payload->>'description',
        'icon', coalesce(v_row.icon, '📦'),
        'name', coalesce(v_row.name_th, '')
      );
    end if;
  end if;

  update public.line_command_results
  set result = v_result
  where event_key = p_event_key;

  return v_result;
end;
$$;

revoke execute on function public.delete_latest_line_transaction(text, text) from public, anon, authenticated;

-- ---- P1-1: idempotent restore ----

create or replace function public.restore_latest_line_transaction(
  p_event_key text,
  p_line_user_id text
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_staging record;
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

  select user_id into v_user_id
  from public.user_identities
  where provider = 'line' and provider_user_id = p_line_user_id;

  if v_user_id is null then
    v_result := json_build_object('status', 'not_linked');
  else
    select * into v_staging
    from public.deleted_transaction_staging
    where user_id = v_user_id
      and deleted_at > now() - interval '2 minutes'
    order by deleted_at desc
    limit 1
    for update;

    if not found then
      v_result := json_build_object('status', 'nothing_to_restore');
    else
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

      v_result := json_build_object(
        'status', 'restored',
        'type', v_staging.payload->>'type',
        'amount', (v_staging.payload->>'amount')::numeric,
        'description', v_staging.payload->>'description'
      );
    end if;
  end if;

  update public.line_command_results
  set result = v_result
  where event_key = p_event_key;

  return v_result;
end;
$$;

revoke execute on function public.restore_latest_line_transaction(text, text) from public, anon, authenticated;

-- ---- P1-1: idempotent amount edit ----

create or replace function public.update_latest_line_transaction_amount(
  p_event_key text,
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

  if p_amount is null or p_amount <= 0 or p_amount > 999999999 then
    v_result := json_build_object('status', 'invalid_amount');
  else
    select user_id into v_user_id
    from public.user_identities
    where provider = 'line' and provider_user_id = p_line_user_id;

    if v_user_id is null then
      v_result := json_build_object('status', 'not_linked');
    else
      select t.id, c.icon, c.name_th into v_row
      from public.transactions t
      join public.categories c on c.id = t.category_id
      where t.user_id = v_user_id
      order by t.created_at desc, t.id desc
      limit 1
      for update of t;

      if not found then
        v_result := json_build_object('status', 'not_found');
      else
        update public.transactions
        set amount = p_amount
        where id = v_row.id
        returning description into v_description;

        v_result := json_build_object(
          'status', 'updated',
          'amount', p_amount,
          'description', v_description,
          'icon', v_row.icon,
          'name', v_row.name_th
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

revoke execute on function public.update_latest_line_transaction_amount(text, text, numeric) from public, anon, authenticated;

-- ---- P1-1 + P2-4: idempotent, user-uniqueness-aware redemption ----

create or replace function public.redeem_linking_code(
  p_event_key text,
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
  v_result text;
begin
  if p_event_key is not null and p_event_key <> '' then
    select r.result->>'status' into v_result
    from public.line_command_results r
    where r.event_key = p_event_key;
    if v_result is not null then
      if v_result = 'pending' then
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

  select user_id, expires_at
    into v_code_user_id, v_expires_at
    from public.linking_codes
    where code = p_code
    for update;

  if not found then
    v_result := 'not_found';
  elsif v_expires_at < now() then
    delete from public.linking_codes where code = p_code;
    v_result := 'expired';
  else
    select user_id into v_existing_user_id
      from public.user_identities
      where provider = p_provider
        and provider_user_id = p_provider_user_id;

    if v_existing_user_id is not null then
      if v_existing_user_id = v_code_user_id then
        delete from public.linking_codes where code = p_code;
        v_result := 'already_linked_same';
      else
        v_result := 'already_linked_other';
      end if;
    elsif exists (
      select 1 from public.user_identities
      where user_id = v_code_user_id and provider = p_provider
    ) then
      -- This web account is already linked to a different LINE account.
      delete from public.linking_codes where code = p_code;
      v_result := 'user_already_linked';
    else
      insert into public.user_identities (user_id, provider, provider_user_id)
      values (v_code_user_id, p_provider, p_provider_user_id);
      delete from public.linking_codes where code = p_code;
      v_result := 'linked';
    end if;
  end if;

  update public.line_command_results
  set result = jsonb_build_object('status', v_result)
  where event_key = p_event_key;

  return v_result;
end;
$$;

revoke execute on function public.redeem_linking_code(text, text, text, text) from public, anon, authenticated;

-- ---- P2-4: atomic code issuance (delete-then-insert in one statement) ----

create or replace function public.create_linking_code(
  p_user_id uuid,
  p_code text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.linking_codes where user_id = p_user_id;
  insert into public.linking_codes (code, user_id, expires_at)
  values (p_code, p_user_id, p_expires_at);
end;
$$;

revoke execute on function public.create_linking_code(uuid, text, timestamptz) from public, anon, authenticated;

-- ---- P2-4: cardinality constraints ----

alter table public.linking_codes
  add constraint linking_codes_one_per_user unique (user_id);
alter table public.user_identities
  add constraint user_identities_one_per_provider unique (user_id, provider);

-- ---- P2-10: SQL-side summary (no hosted row limit) ----

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
        json_build_object('type', t.type, 'icon', c.icon, 'name', c.name_th, 'total', t.total)
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

-- ---- P2-12: fresh installs always get a worker token ----

insert into public.line_worker_tokens (token)
select encode(gen_random_bytes(24), 'hex')
where not exists (select 1 from public.line_worker_tokens);
