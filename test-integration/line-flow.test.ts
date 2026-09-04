import "./app-env";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { serviceClient } from "./env";
import { createTestUser, wipeLocalData } from "./helpers";
import { startMock } from "./mocks";
import { enqueueLineJobs, processDueLineJobs } from "@/lib/line-jobs";

// End-to-end LINE bot workflow against a real database with the LINE and
// Gemini APIs mocked at the HTTP boundary — no real messages, no quota.

let line: Awaited<ReturnType<typeof startMock>>;
let gemini: Awaited<ReturnType<typeof startMock>>;
let userId = "";
let lineUser = "";
let jobSeq = 0;

function event(text: string) {
  jobSeq += 1;
  return {
    eventKey: `flow-${randomUUID()}`,
    lineUserId: lineUser,
    replyToken: `tok-${jobSeq}`,
    text,
    lineTimestamp: Date.now() + jobSeq,
    batchSeq: 0,
  };
}

function send(text: string) {
  return enqueueLineJobs([event(text)]);
}

async function jobRow(id: string) {
  const { data } = await serviceClient()
    .from("line_jobs")
    .select("status, attempts, last_error, text, reply_token, reply_text")
    .eq("id", id)
    .maybeSingle();
  return data;
}

async function forceDue(prefix: string) {
  await serviceClient()
    .from("line_jobs")
    .update({ next_retry_at: new Date(Date.now() - 1_000).toISOString() })
    .like("id", prefix);
}

beforeAll(async () => {
  line = await startMock("line");
  gemini = await startMock("gemini");
  process.env.LINE_API_BASE_URL = line.url;
  process.env.GEMINI_BASE_URL = gemini.url;

  const user = await createTestUser("flow");
  userId = user.userId;
  lineUser = `Uflow-${randomUUID()}`;
  await serviceClient().from("user_identities").insert({
    user_id: userId,
    provider: "line",
    provider_user_id: lineUser,
  });
});

afterAll(async () => {
  await wipeLocalData();
  await line.close();
  await gemini.close();
});

beforeEach(() => {
  line.reset();
  gemini.reset();
});

describe("normal flow", () => {
  it("saves a rule-parsed transaction and replies without touching Gemini", async () => {
    await send("กินข้าว 120");
    const processed = await processDueLineJobs();

    expect(processed).toBeGreaterThanOrEqual(1);

    const { data: tx } = await serviceClient()
      .from("transactions")
      .select("amount, type, source, category:categories(slug)")
      .eq("user_id", userId)
      .eq("description", "กินข้าว")
      .maybeSingle();
    expect(tx).toMatchObject({ amount: 120, type: "expense", source: "line" });
    const category = tx?.category as unknown as
      | { slug: string }
      | { slug: string }[]
      | null;
    const slug = Array.isArray(category) ? category[0]?.slug : category?.slug;
    expect(slug).toBe("food");

    const reply = line.requests.find((r) => r.path === "/message/reply");
    expect(reply).toBeTruthy();
    expect(reply?.headers["x-line-retry-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(reply?.body)).toContain("บันทึกแล้ว");

    expect(gemini.requests.length).toBe(0);
  });

  it("clears all sensitive payload once completed", async () => {
    await send("กาแฟ 55");
    await processDueLineJobs();

    const { data } = await serviceClient()
      .from("line_jobs")
      .select("id, status, text, reply_token, reply_text")
      .ilike("text", "%กาแฟ%")
      .maybeSingle();
    // Completed rows no longer carry text to match on — that is the point.
    expect(data).toBeNull();
    const { data: done } = await serviceClient()
      .from("line_jobs")
      .select("status, text, reply_token, reply_text")
      .eq("status", "completed")
      .limit(5);
    for (const row of done ?? []) {
      expect(row.text).toBeNull();
      expect(row.reply_token).toBeNull();
      expect(row.reply_text).toBeNull();
    }
  });
});

describe("duplicate and ordered delivery", () => {
  it("accepts a duplicate enqueue without a second job", async () => {
    const evt = event("เติมน้ำมัน 300");
    await enqueueLineJobs([evt]);
    await enqueueLineJobs([evt]);

    const { count } = await serviceClient()
      .from("line_jobs")
      .select("id", { count: "exact", head: true })
      .eq("id", evt.eventKey);
    expect(count).toBe(1);

    await processDueLineJobs();
    const { count: saved } = await serviceClient()
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("description", "เติมน้ำมัน");
    expect(saved).toBe(1);
  });

  it("processes one user's messages strictly in order (save → undo → restore)", async () => {
    const save = { ...event("ก๋วยเตี๋ยว 500"), lineTimestamp: Date.now() + 100 };
    const undo = { ...event("ลบล่าสุด"), lineTimestamp: Date.now() + 200 };
    const restore = { ...event("กู้คืน"), lineTimestamp: Date.now() + 300 };
    await enqueueLineJobs([save, undo, restore]);

    await processDueLineJobs();

    // Undo must have removed the 500 entry (not an older one)…
    const { data: staged } = await serviceClient()
      .from("deleted_transaction_staging")
      .select("payload")
      .limit(1);
    expect(Number((staged?.[0]?.payload as { amount?: string })?.amount)).toBe(500);

    // …and restore must have brought exactly it back.
    const { count } = await serviceClient()
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("description", "ก๋วยเตี๋ยว");
    expect(count).toBe(1);
    const { count: stagedLeft } = await serviceClient()
      .from("deleted_transaction_staging")
      .select("id", { count: "exact", head: true });
    expect(stagedLeft).toBe(0);
  });
});

describe("delivery failure paths", () => {
  it("retries a rejected reply token via push with the retry key", async () => {
    line.queue({ status: 400, body: { message: "Invalid reply token" } });
    const evt = event("ล่าสุด");
    await enqueueLineJobs([evt]);
    await processDueLineJobs();

    const failed = await jobRow(evt.eventKey);
    expect(failed?.status).toBe("retry");
    expect(failed?.last_error).toMatch(/^delivery:/);
    expect(failed?.reply_text).toBeTruthy();

    await forceDue(evt.eventKey);
    await processDueLineJobs();

    const pushed = line.requests.find((r) => r.path === "/message/push");
    expect(pushed?.headers["x-line-retry-key"]).toMatch(/^[0-9a-f-]{36}$/);

    const done = await jobRow(evt.eventKey);
    expect(done?.status).toBe("completed");
  });

  it("treats 409 with a retry key as delivered", async () => {
    line.queue({ status: 409, body: { message: "The request has already been processed" } });
    const evt = event("วันนี้");
    await enqueueLineJobs([evt]);
    await processDueLineJobs();

    const done = await jobRow(evt.eventKey);
    expect(done?.status).toBe("completed");
  });

  it("survives a LINE timeout into a retry", async () => {
    line.queue({ hang: true });
    const evt = event("เดือนนี้");
    await enqueueLineJobs([evt]);
    await processDueLineJobs();

    const retrying = await jobRow(evt.eventKey);
    expect(retrying?.status).toBe("retry");
    expect(retrying?.last_error).toMatch(/^delivery:/);
  });
});

describe("Gemini outage behavior", () => {
  it("still records rule-parsed messages while Gemini is down", async () => {
    gemini.reset();
    // Default mock behavior stays 200 — the point is it is never called.
    await send("เติมน้ำมัน 800");
    await processDueLineJobs();

    const { count } = await serviceClient()
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("description", "เติมน้ำมัน");
    expect(count).toBeGreaterThanOrEqual(1);
    expect(gemini.requests.length).toBe(0);
  });

  it("retries a quota-blocked escalation until dead-letter, then apologizes", async () => {
    // "วันจันทร์..." carries an explicit date → escalates to Gemini.
    gemini.queue({ status: 429, body: { error: { code: 429 } } });
    gemini.queue({ status: 429, body: { error: { code: 429 } } });

    const evt = event("วันจันทร์กินข้าว 200");
    await enqueueLineJobs([evt]);

    for (let attempt = 1; attempt <= 5; attempt++) {
      await processDueLineJobs(5);
      const row = await jobRow(evt.eventKey);
      if (attempt < 5) {
        expect(row?.status).toBe("retry");
        expect(row?.attempts).toBe(attempt);
        await forceDue(evt.eventKey);
      } else {
        expect(row?.status).toBe("dead");
      }
    }

    const apology = line.requests.find(
      (r) => r.path === "/message/push" && JSON.stringify(r.body).includes("ข้อผิดพลาด"),
    );
    expect(apology).toBeTruthy();
  });

  it("recovers jobs a crashed worker left mid-claim, saving once", async () => {
    const evt = event("ขนม 40");
    await enqueueLineJobs([evt]);

    // Simulate the crash: the claim happens, processing never does.
    await serviceClient().rpc("claim_due_line_jobs", { p_limit: 5 });
    await serviceClient()
      .from("line_jobs")
      .update({ claimed_at: new Date(Date.now() - 11 * 60_000).toISOString() })
      .eq("id", evt.eventKey);

    await processDueLineJobs(5);

    const done = await jobRow(evt.eventKey);
    expect(done?.status).toBe("completed");
    const { count } = await serviceClient()
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("description", "ขนม");
    expect(count).toBe(1);
  });
});
