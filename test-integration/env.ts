import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Integration-test environment loading + safety guard.
//
// These suites MUST only ever run against a throwaway local/CI Supabase
// stack. The guard below refuses any URL that is not loopback, so a stray
// production credential cannot execute a single query.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `integration tests need ${name} (local Supabase stack keys — see .env.test.example or the CI job)`,
    );
  }
  return value;
}

export const SUPABASE_URL = requireEnv("SUPABASE_URL");
export const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
export const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const parsed = new URL(SUPABASE_URL);
const isLoopback =
  parsed.hostname === "localhost" ||
  parsed.hostname === "127.0.0.1" ||
  parsed.hostname === "::1";
if (!isLoopback) {
  throw new Error(
    `integration tests refuse to run against ${parsed.hostname} — only a local Supabase stack (localhost) is allowed`,
  );
}

// Clients built directly from test env: the app's lib/supabase/* modules
// read production env names and are deliberately not reused here.
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// A user-scoped client, exactly like the browser session would have.
export async function userClient(email: string, password: string) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return client;
}
