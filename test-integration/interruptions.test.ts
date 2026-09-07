import "./app-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { serviceClient } from "./env";
import {
  categoryId,
  createTestUser,
  wipeLocalData,
} from "./helpers";
import { startMock } from "./mocks";
import { checkBudgetAlerts } from "@/lib/budget-alerts";
import { processDueLineJobs } from "@/lib/line-jobs";
import { monthRange } from "@/lib/date";

// Interrupted-workflow cases where happy-path tests miss bugs: concurrent
// budget-alert sweeps, account deletion while a job is mid-flight, and
// month-boundary recurring materialization.

let line: Awaited<ReturnType<typeof startMock>>;

beforeAll(async () => {
  line = await startMock("line-interruptions");
  process.env.LINE_API_BASE_URL = line.url;
});

afterAll(async () => {
  await wipeLocalData();
  await line.close();
});

function freshAccount(label: string) {
  return (async () => {
    const user = await createTestUser(label);
    const lineUserId = `U${label}-${randomUUID()}`;
    await serviceClient().from("user_identities").insert({
      user_id: user.userId,
      provider: "line",
      provider_user_id: lineUserId,
    });
    return { user, lineUserId };
  })();
}

describe("concurrent budget-alert sweeps", () => {
  it("records one guard row and identical retry keys across racing sweeps", async () => {
    const { user } = await freshAccount("conc");
    const foodId = await categoryId(serviceClient(), "food");
    const month = `${monthRange().from.slice(0, 7)}-01`;

    await serviceClient().from("budgets").upsert(
      { user_id: user.userId, category_id: foodId, month, amount: 1000 },
      { onConflict: "user_id,category_id,month" },
    );
    await serviceClient().from("transactions").insert({
      user_id: user.userId,
      type: "expense",
      amount: 950,
      category_id: foodId,
      description: "conc-alert",
      transaction_date: monthRange().from,
      source: "web",
    });

    // Two sweeps race (concurrent save + cron overlap).
    await Promise.all([
      checkBudgetAlerts(user.userId),
      checkBudgetAlerts(user.userId),
    ]);

    // Exactly one guard row exists.
    const { data: guards } = await serviceClient()
      .from("budget_alerts")
      .select("status")
      .eq("user_id", user.userId)
      .eq("category_id", foodId)
      .eq("level", "80");
    expect(guards).toHaveLength(1);

    // Both racing pushes carried the SAME retry key, so LINE delivers once.
    const pushes = line.requests.filter(
      (r) => JSON.stringify(r.body).includes("เดือนนี้ใช้แล้ว"),
    );
    expect(pushes.length).toBeGreaterThanOrEqual(1);
    const keys = new Set(pushes.map((r) => r.headers["x-line-retry-key"]));
    expect(keys.size).toBe(1);

    await serviceClient()
      .from("budget_alerts")
      .delete()
      .eq("user_id", user.userId);
  });
});

describe("account deletion mid-processing", () => {
  it("completes cleanly without crashing or leaving partial state", async () => {
    const { user, lineUserId } = await freshAccount("delmid");
    const admin = serviceClient();

    const jobId = `delmid-${randomUUID()}`;
    await admin.from("line_jobs").insert({
      id: jobId,
      line_user_id: lineUserId,
      text: "กินข้าว 60",
      line_timestamp: Date.now(),
      batch_seq: 0,
    });

    // Worker claims the job, THEN the account is deleted (identity and
    // transaction rows cascade; the queue row has no FK and was purged by
    // deleteMyAccount — simulate a racing sweep that claimed first).
    await admin.rpc("claim_due_line_jobs", { p_limit: 5 });
    await admin.auth.admin.deleteUser(user.userId);

    // A stale sweep re-claims the abandoned job and must run to a defined
    // terminal state without crashing.
    await admin
      .from("line_jobs")
      .update({ claimed_at: new Date(Date.now() - 11 * 60_000).toISOString() })
      .eq("id", jobId);
    await processDueLineJobs(5);

    const { data: job } = await admin
      .from("line_jobs")
      .select("status")
      .eq("id", jobId)
      .single();
    // The bot replies "not linked" (identity is gone) and the job completes.
    expect(job?.status).toBe("completed");

    await admin.from("line_jobs").delete().eq("id", jobId);
  });
});

describe("month-boundary recurring materialization", () => {
  it("backfills a missed previous month and stays idempotent", async () => {
    const { user } = await freshAccount("monthbound");
    const admin = serviceClient();
    const entertainmentId = await categoryId(admin, "entertainment");

    await admin.from("recurring_rules").insert({
      user_id: user.userId,
      category_id: entertainmentId,
      description: "missed-month",
      amount: 300,
      type: "expense",
      day_of_month: 1,
    });

    // The previous month was missed entirely; the watchdog backfills it.
    const now = new Date();
    const prevMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    const prevMonthStart = prevMonth.toISOString().slice(0, 10);

    const first = await admin.rpc("materialize_recurring", {
      p_month: prevMonthStart,
    });
    expect(Number(first.data)).toBe(1);

    // Re-running the same month stays idempotent.
    const again = await admin.rpc("materialize_recurring", {
      p_month: prevMonthStart,
    });
    expect(Number(again.data)).toBe(0);

    // The current month materializes separately (not swallowed by the
    // backfill marker).
    const current = await admin.rpc("materialize_recurring", {
      p_month: now.toISOString().slice(0, 10),
    });
    expect(Number(current.data)).toBe(1);

    const { data: rows } = await admin
      .from("transactions")
      .select("transaction_date")
      .eq("description", "missed-month")
      .order("transaction_date");
    expect(rows).toHaveLength(2);
    expect(rows![0].transaction_date.slice(0, 7)).toBe(
      prevMonthStart.slice(0, 7),
    );
    expect(rows![1].transaction_date.slice(0, 7)).toBe(
      now.toISOString().slice(0, 7),
    );
  });
});
