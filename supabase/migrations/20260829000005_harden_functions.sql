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
revoke execute on function public.rls_auto_enable() from public;
