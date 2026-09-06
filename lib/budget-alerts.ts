import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthRange } from "@/lib/date";
import { pushToUser, lineRetryKey } from "@/lib/line";

// Budget warnings: when an expense pushes a category to 80% or 100% of its
// monthly budget, the owner gets one LINE push per level per budget-month.
// The guard-row insert IS the dedup: only the writer that claimed the row
// sends the message, so concurrent saves or cron runs cannot double-push.

export async function checkBudgetAlerts(userId: string): Promise<void> {
  const admin = createAdminClient();
  const range = monthRange();

  const [{ data: budgets }, summaryResult] = await Promise.all([
    admin
      .from("budgets")
      .select("category_id, amount, categories(slug, name_th, icon)")
      .eq("user_id", userId)
      // month is always stored as the first day of the month.
      .eq("month", `${range.from.slice(0, 7)}-01`),
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
    categories?: { type: string; icon: string; name: string; total: number }[];
  } | null;

  const spentBySlug = new Map<string, number>();
  for (const row of summary?.categories ?? []) {
    if (row.type === "expense") {
      spentBySlug.set(row.name, Number(row.total));
    }
  }

  for (const budget of budgets) {
    const amount = Number(budget.amount);
    if (!(amount > 0)) continue;
    const spent = spentBySlug.get(budget.categories.name_th) ?? 0;
    const pct = (spent / amount) * 100;
    const level = pct >= 100 ? "100" : pct >= 80 ? "80" : null;
    if (!level) continue;

    // Claim the alert atomically; loser of the race sends nothing.
    const { data: claimed, error } = await admin
      .from("budget_alerts")
      .insert({
        user_id: userId,
        category_id: budget.category_id,
        month: `${range.from.slice(0, 7)}-01`,
        level,
      })
      .select("user_id")
      .maybeSingle();

    if (error || !claimed) continue;

    const { data: identity } = await admin
      .from("user_identities")
      .select("provider_user_id")
      .eq("user_id", userId)
      .eq("provider", "line")
      .maybeSingle();
    if (!identity) continue;

    const label = `${budget.categories.icon ?? "📦"} ${budget.categories.name_th}`;
    const text =
      level === "100"
        ? `⚠️ งบ "${label}" เดือนนี้หมดแล้ว\nใช้ไป ${fmt(spent)} / ${fmt(amount)} บาท`
        : `🔔 งบ "${label}" เดือนนี้ใช้แล้ว ${Math.round(pct)}%\n${fmt(spent)} / ${fmt(amount)} บาท`;

    try {
      await pushToUser(
        identity.provider_user_id,
        text,
        lineRetryKey(`budget-alert:${userId}:${budget.category_id}:${level}:${range.from.slice(0, 7)}`),
      );
    } catch (err) {
      console.error("[budget-alerts] push failed:", (err as Error).message);
    }
  }
}

function fmt(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}
