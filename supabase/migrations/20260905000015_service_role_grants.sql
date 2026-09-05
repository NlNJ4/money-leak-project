-- Deterministic service-role grants.
--
-- The app's server-side worker (service role) touches every table and RPC
-- in this schema. Hosted Supabase grants that via default privileges; a
-- fresh local/CI stack does not, which made the two environments behave
-- differently. Make explicit what the runtime relies on. The security
-- revokes on anon/authenticated/public are untouched.

grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Client roles: hosted Supabase grants base table privileges to
-- anon/authenticated by default; a fresh local/CI stack does not. Grant
-- exactly what the RLS policies are written against — RLS still governs
-- every row.
grant select on public.categories to anon, authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant select, delete on public.user_identities to authenticated;
grant select, insert, delete on public.linking_codes to authenticated;
grant execute on function public.dashboard_summary(date, date) to authenticated;

-- Future objects created by migrations (this role) inherit the service
-- role grant, so a fresh replay cannot regress the worker. Client-facing
-- grants stay explicit per feature migration.
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;
