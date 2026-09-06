import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthRange } from "@/lib/date";
import { pushToUser, lineRetryKey } from "@/lib/line";

// Budget warnings: when an expense pushes a category to 80% or 100% of its
// monthly budget, the owner gets one LINE push per level per budget-month.
//
// Delivery is at-least-once with LINE-side dedup: the guard row starts
// 'pending' before the push and flips to 'sent' only after a successful
// send. A failed push leaves the row pending, so the next sweep retries
// with the SAME retry key — LINE's dedup prevents double delivery. Spending
// is matched by category_id (display names can collide across categories).

export async function checkBudgetAlerts(userId: string): Promise<void> {
  const admin = createAdminClient();
  const range = monthRange();
  const month = `${range.from.slice(0, 7)}-01`;

  const [{ data: budgets }, summaryResult] = await Promise.all([
    admin
      .from("budgets")
      .select("category_id, amount, categories(slug, name_th, icon)")
      .eq("user_id", userId)
      .eq("month", month),
    admin.rpc("line_range_summary", {
      p_user_id: userId,
      p_from: range.from,
      p_to: range.to,
    }),
  ]);

  if (!budgets || budgets.length === 0) return;

  // Scalar JSON: the summary object arrives as-is on data.
  const summary = (Array.isArray(summaryResult.data)
    ? summaryResult.data[0]
    : summaryResult.data) as {
    categories?: {
      type: string;
      category_id: string;
      icon: string;
      name: string;
      total: number;
    }[];
  } | null;

  const spentById = new Map<string, number>();
  for (const row of summary?.categories ?? []) {
    if (row.type === "expense") {
      spentById.set(row.category_id, Number(row.total));
    }
  }

  const { data: identity } = await admin
    .from("user_identities")
    .select("provider_user_id")
    .eq("user_id", userId)
    .eq("provider", "line")
    .maybeSingle();

  for (const budget of budgets) {
    const amount = Number(budget.amount);
    if (!(amount > 0)) continue;
    const spent = spentById.get(budget.category_id) ?? 0;
    const pct = (spent / amount) * 100;
    const level = pct >= 100 ? "100" : pct >= 80 ? "80" : null;
    if (!level) continue;

    const { data: existing } = await admin
      .from("budget_alerts")
      .select("status")
      .eq("user_id", userId)
      .eq("category_id", budget.category_id)
      .eq("month", month)
      .eq("level", level)
      .maybeSingle();

    // 'sent' means already delivered; 'pending' means a previous push
    // failed and this sweep is the retry.
    if (existing?.status === "sent") continue;

    await admin.from("budget_alerts").upsert(
      { user_id: userId, category_id: budget.category_id, month, level, status: "pending" },
      { onConflict: "user_id,category_id,month,level" },
    );

    if (!identity) continue;

    const label = `${budget.categories.icon ?? "📦"} ${budget.categories.name_th}`;
    const text =
      level === "100"
        ? `⚠️ งบ "${label}" เดือนนี้หมดแล้ว\nใช้ไป ${fmt(spent)} / ${fmt(amount)} บาท`
        : `🔔 งบ "${label}" เดือนนี้ใช้แล้ว ${Math.round(pct)}%\n${fmt(spent)} / ${fmt(amount)} บาท`;

    const retryKey = lineRetryKey(
      `budget-alert:${userId}:${budget.category_id}:${level}:${month}`,
    );

    try {
      await pushToUser(identity.provider_user_id, text, retryKey);
    } catch (err) {
      // Leave the guard row pending: the next sweep retries this alert.
      console.error("[budget-alerts] push failed (will retry):", (err as Error).message);
      continue;
    }

    await admin
      .from("budget_alerts")
      .update({ status: "sent" })
      .eq("user_id", userId)
      .eq("category_id", budget.category_id)
      .eq("month", month)
      .eq("level", level);
  }
}

function fmt(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}
