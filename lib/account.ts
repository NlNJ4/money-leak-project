import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ServiceError } from "@/lib/transactions";
import { getAuthContext } from "@/lib/supabase/server";

// Account self-service: full data export as JSON, and typed-confirmation
// account deletion. Deletion cascades wipe transactions, budgets,
// recurring rules, identities, staging and pending confirms via FK; the
// queue tables have no user FK, so the linked LINE id is purged explicitly
// BEFORE the auth user disappears.

export async function exportMyData(): Promise<Record<string, unknown>> {
  const auth = await getAuthContext();
  if (!auth) throw new ServiceError("unauthorized");

  const supabase = auth.supabase;
  const [transactions, budgets, recurring, customCategories, identities] =
    await Promise.all([
      supabase
        .from("transactions")
        .select("type, amount, description, transaction_date, source, created_at")
        .order("transaction_date", { ascending: false }),
      supabase
        .from("budgets")
        .select("month, amount, category_id"),
      supabase
        .from("recurring_rules")
        .select("description, amount, type, day_of_month, active"),
      supabase
        .from("categories")
        .select("slug, name_th, name_en, icon, type")
        .eq("is_custom", true),
      supabase
        .from("user_identities")
        .select("provider, created_at"),
    ]);

  for (const result of [
    transactions,
    budgets,
    recurring,
    customCategories,
    identities,
  ]) {
    if (result.error) {
      throw new ServiceError("query_failed", result.error.message);
    }
  }

  return {
    exported_at: new Date().toISOString(),
    account: { user_id: auth.userId, display_name: auth.displayName },
    transactions: transactions.data ?? [],
    budgets: budgets.data ?? [],
    recurring_rules: recurring.data ?? [],
    custom_categories: customCategories.data ?? [],
    linked_identities: identities.data ?? [],
  };
}

// Returns the identity rows removed (for the caller's best-effort LINE
// goodbye), or null when the account did not exist.
export async function deleteMyAccount(
  confirmation: string,
): Promise<{ providerUserId: string | null } | null> {
  const auth = await getAuthContext();
  if (!auth) throw new ServiceError("unauthorized");

  // Typed confirmation: the user must type their email — no accidental
  // deletes. Case-insensitive, trimmed.
  const expected = (auth.email ?? "").toLowerCase();
  if (!expected || confirmation.trim().toLowerCase() !== expected) {
    throw new ServiceError("confirmation_mismatch");
  }

  const admin = createAdminClient();

  const { data: identities } = await admin
    .from("user_identities")
    .select("provider_user_id")
    .eq("user_id", auth.userId)
    .eq("provider", "line");
  const providerUserId = identities?.[0]?.provider_user_id ?? null;

  // Queue rows are keyed by LINE user id without FKs — purge explicitly.
  if (providerUserId) {
    const jobs = await admin
      .from("line_jobs")
      .delete()
      .eq("line_user_id", providerUserId);
    if (jobs.error) {
      throw new ServiceError("delete_failed", jobs.error.message);
    }
    const attempts = await admin
      .from("line_redeem_attempts")
      .delete()
      .eq("line_user_id", providerUserId);
    if (attempts.error) {
      throw new ServiceError("delete_failed", attempts.error.message);
    }
  }

  const { error } = await admin.auth.admin.deleteUser(auth.userId);
  if (error) {
    throw new ServiceError("delete_failed", error.message);
  }

  return { providerUserId };
}
