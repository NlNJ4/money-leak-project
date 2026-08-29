-- Pin search_path so the trigger function can't be hijacked by a
-- maliciously named object in another schema.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Platform-installed RLS safety net; not meant to be callable over the API.
-- Guarded: the function is optional on some Supabase setups, so a fresh
-- migration replay must not fail when it does not exist.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from public';
  end if;
end
$$;
