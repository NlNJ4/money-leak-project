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

// ---- Step 1: delivery trust — dead-letter notices and safe retry ----

async function forceDue(prefix: string) {
  await serviceClient()
    .from("line_jobs")
    .update({ next_retry_at: new Date(Date.now() - 1_000).toISOString() })
    .like("id", prefix);
}

describe("delivery-dead notice distinguishes saved from unsaved", () => {
  it("pushes saved-not-lost (never resend) when delivery exhausts retries", async () => {
    const admin = serviceClient();
    const evt = {
      eventKey: `trust-${randomUUID()}`,
      lineUserId: lineUser,
      text: "ล่าสุด",
      lineTimestamp: Date.now() + 900,
      batchSeq: 0,
    };
    await (await import("@/lib/line-jobs")).enqueueLineJobs([evt]);

    // Exhaust all 5 delivery attempts with server errors.
    for (let attempt = 1; attempt <= 5; attempt++) {
      line.queue({ status: 500, body: { message: "down" } });
      await (await import("@/lib/line-jobs")).processDueLineJobs(5);
      if (attempt < 5) await forceDue(evt.eventKey);
    }

    const job = await admin
      .from("line_jobs")
      .select("status")
      .eq("id", evt.eventKey)
      .single();
    expect(job.data?.status).toBe("dead");

    // The dead-letter notice says the record IS saved, and never the
    // processing-failure "please resend" wording.
    const notice = line.requests.find((r) =>
      JSON.stringify(r.body).includes("ระบบบันทึกให้เรียบร้อยแล้ว"),
    );
    expect(notice).toBeTruthy();
    const resend = line.requests.find((r) =>
      JSON.stringify(r.body).includes("ลองส่งข้อความนี้อีกครั้ง"),
    );
    expect(resend).toBeUndefined();

    await admin.from("line_jobs").delete().eq("id", evt.eventKey);
  });
});

describe("safe dead-job retry endpoint", () => {
  it("resets dead jobs to retry with a fresh attempt cycle", async () => {
    const admin = serviceClient();
    const { data: tokenRows } = await admin
      .from("line_worker_tokens")
      .select("token")
      .limit(1);
    const token = tokenRows![0].token;

    // Seed a dead job.
    const deadId = `dead-${randomUUID()}`;
    await admin.from("line_jobs").insert({
      id: deadId,
      line_user_id: lineUser,
      text: "ล่าสุด",
      status: "dead",
      attempts: 5,
      last_error: "delivery: boom",
    });

    const { PUT } = await import("@/app/api/line/worker/route");
    const response = await PUT(
      new Request("http://localhost/api/line/worker", {
        method: "PUT",
        headers: { "x-worker-token": token },
      }) as never,
    );
    const payload = (await response.json()) as {
      ok: boolean;
      retried: number;
      ids: string[];
    };
    expect(payload.ok).toBe(true);
    expect(payload.ids).toContain(deadId);

    const row = await admin
      .from("line_jobs")
      .select("status, attempts")
      .eq("id", deadId)
      .single();
    expect(row.data?.status).toBe("retry");
    expect(row.data?.attempts).toBe(0);

    // The next sweep processes it end to end.
    const { processDueLineJobs } = await import("@/lib/line-jobs");
    await processDueLineJobs(5);
    const done = await admin
      .from("line_jobs")
      .select("status")
      .eq("id", deadId)
      .single();
    expect(done.data?.status).toBe("completed");

    await admin.from("line_jobs").delete().eq("id", deadId);
  });

  it("rejects the retry action without a worker token", async () => {
    const { PUT } = await import("@/app/api/line/worker/route");
    const response = await PUT(
      new Request("http://localhost/api/line/worker", {
        method: "PUT",
      }) as never,
    );
    expect(response.status).toBe(401);
  });
});
