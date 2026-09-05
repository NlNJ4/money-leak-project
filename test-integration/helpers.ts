import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from "./env";

// Shared fixtures for the integration suites. Everything targets the
// throwaway local/CI stack (enforced by the env guard) and is wiped by
// wipeLocalData() between files.

export type TestUser = {
  userId: string;
  email: string;
  password: string;
};

export async function createTestUser(label: string): Promise<TestUser> {
  const email = `test-${label}-${randomUUID()}@example.invalid`;
  const password = `pw-${randomUUID()}`;
  const admin = serviceClient();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  return { userId: data.user.id, email, password };
}

export async function deleteUser(user: TestUser): Promise<void> {
  const { error } = await serviceClient().auth.admin.deleteUser(user.userId);
  if (error) throw new Error(`deleteUser failed: ${error.message}`);
}

// Wipes everything the suites can create. Seeded categories stay. The
// user-owned tables cascade from auth.users; queue tables have no FK and
// are cleared directly.
export async function wipeLocalData(): Promise<void> {
  const admin = serviceClient();

  await admin.from("line_command_results").delete().neq("event_key", "");
  await admin.from("line_jobs").delete().neq("id", "");
  await admin.from("webhook_events").delete().neq("id", "");
  await admin.from("line_redeem_attempts").delete().neq("line_user_id", "");
  await admin.from("line_pending_confirms").delete().neq("event_key", "");
  await admin.from("deleted_transaction_staging").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await admin.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await admin.from("linking_codes").delete().neq("code", "");
  await admin.from("line_metrics").delete().neq("key", "");
  await admin.from("ai_usage").delete().neq("day", "1900-01-01");
  await admin.from("ai_circuit").delete().neq("id", 0);

  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  for (const user of users?.users ?? []) {
    await admin.auth.admin.deleteUser(user.id);
  }
}

export async function categoryId(
  client: SupabaseClient,
  slug: string,
): Promise<string> {
  const { data, error } = await client
    .from("categories")
    .select("id")
    .eq("slug", slug)
    .single();
  if (error || !data) throw new Error(`category ${slug} missing: ${error?.message}`);
  return data.id;
}

export async function insertTransaction(
  client: SupabaseClient,
  userId: string,
  overrides: { slug?: string; type?: string; amount?: number; description?: string } = {},
): Promise<string> {
  const { data, error } = await client
    .from("transactions")
    .insert({
      user_id: userId,
      type: overrides.type ?? "expense",
      amount: overrides.amount ?? 100,
      category_id: await categoryId(client, overrides.slug ?? "food"),
      description: overrides.description ?? "integration fixture",
      transaction_date: new Date().toISOString().slice(0, 10),
      source: "web",
    })
    .select("id")
    .single();
  if (error) throw new Error(`fixture insert failed: ${error.message}`);
  return data.id;
}

export { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY };
