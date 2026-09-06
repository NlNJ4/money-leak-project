-- "Operation succeeded, response lost" protection for CSV imports.
-- The client supplies a persistent import UUID; the marker insert and the
-- row inserts happen in ONE transaction. If the response is lost after a
-- successful commit, a retry with the same UUID hits the marker and gets
-- 'already_imported' instead of duplicating rows. Any insert failure rolls
-- back everything (marker included), so retries after real failures are
-- clean.
-- Rollback: drop function public.import_transactions(uuid, uuid, jsonb);

create or replace function public.import_transactions(
  p_import_id uuid,
  p_user_id uuid,
  p_rows jsonb
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marker text := 'import:' || p_import_id::text;
  v_inserted int := 0;
begin
  if p_import_id is null then
    raise exception 'import id required';
  end if;

  insert into public.webhook_events (id) values (v_marker)
  on conflict (id) do nothing;

  if not found then
    return json_build_object('status', 'already_imported');
  end if;

  begin
    insert into public.transactions
      (user_id, type, amount, category_id, description, transaction_date, source)
    select
      p_user_id,
      r->>'type',
      (r->>'amount')::numeric,
      (r->>'category_id')::uuid,
      coalesce(r->>'description', ''),
      (r->>'date')::date,
      'web'
    from jsonb_array_elements(p_rows) r;

    get diagnostics v_inserted = row_count;
  exception when others then
    -- Release the marker so a corrected retry can go through.
    delete from public.webhook_events where id = v_marker;
    raise;
  end;

  return json_build_object('status', 'imported', 'inserted', v_inserted);
end;
$$;

revoke execute on function public.import_transactions(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.import_transactions(uuid, uuid, jsonb) to service_role;
