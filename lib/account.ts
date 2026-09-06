import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ServiceError } from "@/lib/transactions";
import { getAuthContext } from "@/lib/supabase/server";
import { enforceMutationRateLimit } from "@/lib/rate-limit";
import {
  listHistory,
  type HistoryCursor,
  type HistoryRow,
} from "@/lib/transactions";

// Account self-service: full data export as JSON, and typed-confirmation
// account deletion. Deletion cascades wipe transactions, budgets,
// recurring rules, identities, staging and pending confirms via FK; the
// queue tables have no user FK, so the linked LINE id is purged explicitly
// BEFORE the auth user disappears.

// Transactions are collected cursor-page by cursor-page (below the 1,000-row
// response cap): one unpaginated query would silently truncate the export.
const EXPORT_PAGE_SIZE = 999;
const EXPORT_MAX_ROWS = 50_000;

async function collectAllTransactions(): Promise<HistoryRow[]> {
  const rows: HistoryRow[] = [];
  let cursor: HistoryCursor | undefined;
  do {
    const page = await listHistory(
      { range: { from: "1970-01-01", to: "2999-12-31" } },
      cursor,
      EXPORT_PAGE_SIZE,
    );
    rows.push(...page.rows);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && rows.length < EXPORT_MAX_ROWS);
  return rows;
}

export async function exportMyData(): Promise<Record<string, unknown>> {
  const auth = await getAuthContext();
  if (!auth) throw new ServiceError("unauthorized");

  const supabase = auth.supabase;
  const [transactions, budgets, recurring, customCategories, identities] =
    await Promise.all([
      collectAllTransactions(),
      supabase
        .from("budgets")
        .select(
          "month, amount, category_id, category:categories (slug, name_th, name_en, icon, type)",
        ),
      supabase
        .from("recurring_rules")
        .select(
          "description, amount, type, day_of_month, active, category_id, category:categories (slug, name_th, name_en, icon)",
        ),
      supabase
        .from("categories")
        .select("slug, name_th, name_en, icon, type")
        .eq("is_custom", true),
      supabase
        .from("user_identities")
        .select("provider, created_at"),
    ]);

  for (const result of [budgets, recurring, customCategories, identities]) {
    if (result.error) {
      throw new ServiceError("query_failed", result.error.message);
    }
  }

  return {
    exported_at: new Date().toISOString(),
    account: { user_id: auth.userId, display_name: auth.displayName },
    // Category references are embedded per row (slug + display names), so
    // the export is self-describing without the categories table.
    transactions: transactions.map((row) => ({
      date: row.transaction_date,
      type: row.type,
      category_id: row.category?.slug ?? null,
      category: row.category,
      description: row.description,
      amount: Number(row.amount),
      source: row.source,
      created_at: row.created_at,
    })),
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
  enforceMutationRateLimit(auth.userId);

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
