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
import { monthRange } from "@/lib/date";

// Failure-injection tests for the review findings: a retried confirmation,
// a retried recurring-rule creation, and a retried budget-alert delivery
// must each produce exactly one effect.

let line: Awaited<ReturnType<typeof startMock>>;
let user: { userId: string; email: string; password: string };
let lineUser = "";
let foodId = "";

beforeAll(async () => {
  line = await startMock("line-reviews");
  process.env.LINE_API_BASE_URL = line.url;

  user = await createTestUser("review-fixes");
  lineUser = `Urev-${randomUUID()}`;
  foodId = await categoryId(serviceClient(), "food");
  await serviceClient().from("user_identities").insert({
    user_id: user.userId,
    provider: "line",
    provider_user_id: lineUser,
  });
});

afterAll(async () => {
  await wipeLocalData();
  await line.close();
});

describe("confirm_pending_line_transaction replay (F4)", () => {
  it("saves once when the confirm command runs twice", async () => {
    const admin = serviceClient();

    await admin.from("line_pending_confirms").insert({
      event_key: `orig-${randomUUID()}`,
      user_id: user.userId,
      payload: {
        type: "expense",
        amount: 75,
        category: "food",
        description: "confirm-replay",
        date: monthRange().from,
      },
    });

    const confirmKey = `confirm-${randomUUID()}`;
    const first = await admin.rpc("confirm_pending_line_transaction", {
      p_event_key: confirmKey,
      p_user_id: user.userId,
    });
    expect(first.data).toMatchObject({ status: "saved", amount: 75 });

    // Same confirm command delivered again: replays, saves nothing new.
    const replay = await admin.rpc("confirm_pending_line_transaction", {
      p_event_key: confirmKey,
      p_user_id: user.userId,
    });
    expect(replay.data).toMatchObject({ status: "saved", amount: 75 });

    const { count } = await admin
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("description", "confirm-replay");
    expect(count).toBe(1);
  });
});

describe("create_recurring_rule replay (F5)", () => {
  it("creates one rule when creation runs twice", async () => {
    const admin = serviceClient();
    const key = `recurring-${randomUUID()}`;

    const first = await admin.rpc("create_recurring_rule", {
      p_event_key: key,
      p_user_id: user.userId,
      p_category_slug: "entertainment",
      p_description: "Netflix",
      p_amount: 419,
      p_type: "expense",
      p_day_of_month: 5,
    });
    expect(first.data).toMatchObject({ status: "created" });

    const replay = await admin.rpc("create_recurring_rule", {
      p_event_key: key,
      p_user_id: user.userId,
      p_category_slug: "entertainment",
      p_description: "Netflix",
      p_amount: 419,
      p_type: "expense",
      p_day_of_month: 5,
    });
    expect(replay.data).toMatchObject({ status: "created" });

    const { count } = await admin
      .from("recurring_rules")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.userId)
      .eq("description", "Netflix");
    expect(count).toBe(1);
  });
});

describe("budget alert delivery retry (F6)", () => {
  it("retries a failed push and never double-delivers", async () => {
    const admin = serviceClient();
    const month = `${monthRange().from.slice(0, 7)}-01`;

    await admin.from("budgets").upsert(
      { user_id: user.userId, category_id: foodId, month, amount: 1000 },
      { onConflict: "user_id,category_id,month" },
    );
    // 90% of budget.
    await admin.from("transactions").insert({
      user_id: user.userId,
      type: "expense",
      amount: 900,
      category_id: foodId,
      description: "alert-seed",
      transaction_date: monthRange().from,
      source: "web",
    });

    // First sweep: the push FAILS (LINE 500). The guard row must stay
    // pending so the next sweep retries.
    line.queue({ status: 500, body: { message: "server error" } });
    await checkBudgetAlerts(user.userId);

    let guard = await admin
      .from("budget_alerts")
      .select("status")
      .eq("user_id", user.userId)
      .eq("category_id", foodId)
      .eq("level", "80")
      .maybeSingle();
    expect(guard.data?.status).toBe("pending");

    // Second sweep: push succeeds once, guard flips to sent.
    await checkBudgetAlerts(user.userId);
    guard = await admin
      .from("budget_alerts")
      .select("status")
      .eq("user_id", user.userId)
      .eq("category_id", foodId)
      .eq("level", "80")
      .maybeSingle();
    expect(guard.data?.status).toBe("sent");

    // Exactly two requests so far: the failed push + the successful retry.
    const pushesAfterSuccess = line.requests.filter(
      (r) => JSON.stringify(r.body).includes("เดือนนี้ใช้แล้ว"),
    );
    expect(pushesAfterSuccess).toHaveLength(2);

    // A third sweep must not push again (at-most-once delivery).
    await checkBudgetAlerts(user.userId);
    const warnings = line.requests.filter((r) =>
      JSON.stringify(r.body).includes("เดือนนี้ใช้แล้ว"),
    );
    expect(warnings).toHaveLength(2);
  });
});
