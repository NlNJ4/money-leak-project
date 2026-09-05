import "./app-env";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { serviceClient } from "./env";
import { createTestUser, wipeLocalData } from "./helpers";
import { startMock } from "./mocks";
import { enqueueLineJobs, processDueLineJobs } from "@/lib/line-jobs";

// Free-tier AI protection: daily quota, circuit breaker, and the
// ambiguous-confirmation flow that replaces guessing when AI is skipped.

let line: Awaited<ReturnType<typeof startMock>>;
let gemini: Awaited<ReturnType<typeof startMock>>;
let userId = "";
let lineUser = "";
let seq = 0;

function event(text: string) {
  seq += 1;
  return {
    eventKey: `aip-${randomUUID()}`,
    lineUserId: lineUser,
    replyToken: `tok-${seq}`,
    text,
    lineTimestamp: Date.now() + seq,
    batchSeq: 0,
  };
}

async function drain() {
  await processDueLineJobs(10);
}

beforeAll(async () => {
  line = await startMock("line-aip");
  gemini = await startMock("gemini-aip");
  process.env.LINE_API_BASE_URL = line.url;
  // Even though these tests should never reach the AI, point it at a mock
  // so a bug cannot leak a request to the real API.
  process.env.GEMINI_BASE_URL = gemini.url;

  // The flow suites legitimately open the circuit (15 min) and spend
  // quota; reset both so this file starts from a clean slate.
  const admin = serviceClient();
  await admin.from("ai_circuit").upsert(
    { id: 1, open_until: null, consecutive_quota_errors: 0 },
    { onConflict: "id" },
  );
  await admin.from("ai_usage").delete().eq("day", new Date().toISOString().slice(0, 10));

  const user = await createTestUser("aip");
  userId = user.userId;
  lineUser = `Uaip-${randomUUID()}`;
  await admin.from("user_identities").insert({
    user_id: userId,
    provider: "line",
    provider_user_id: lineUser,
  });
});

afterEach(async () => {
  line.reset();
  gemini.reset();
  process.env.GEMINI_DAILY_LIMIT = "";
  await serviceClient().from("line_jobs").delete().eq("line_user_id", lineUser);
  await serviceClient()
    .from("line_pending_confirms")
    .delete()
    .eq("user_id", userId);
});

afterAll(async () => {
  await wipeLocalData();
  await line.close();
  await gemini.close();
});

describe("quota and circuit breaker RPCs", () => {
  it("enforces the daily limit atomically", async () => {
    const admin = serviceClient();
    await admin.from("ai_usage").delete().eq("day", new Date().toISOString().slice(0, 10));

    const first = await admin.rpc("try_acquire_ai_slot", { p_limit: 2 });
    const second = await admin.rpc("try_acquire_ai_slot", { p_limit: 2 });
    const third = await admin.rpc("try_acquire_ai_slot", { p_limit: 2 });
    expect([first.data, second.data, third.data]).toEqual(["ok", "ok", "quota"]);

    await admin.from("ai_usage").delete().eq("day", new Date().toISOString().slice(0, 10));
  });

  it("opens the circuit after five consecutive quota errors", async () => {
    const admin = serviceClient();
    await admin.from("ai_circuit").upsert(
      { id: 1, open_until: null, consecutive_quota_errors: 0 },
      { onConflict: "id" },
    );

    for (let i = 0; i < 5; i++) {
      await admin.rpc("note_ai_outcome", { p_quota_err: true });
    }
    const blocked = await admin.rpc("try_acquire_ai_slot", { p_limit: 100 });
    expect(blocked.data).toBe("circuit");

    await admin
      .from("ai_circuit")
      .update({ open_until: null, consecutive_quota_errors: 0 })
      .eq("id", 1);
  });
});

describe("ambiguous-confirmation flow", () => {
  it("asks instead of guessing when the daily quota is exhausted", async () => {
    // "ของชิ้นนี้ 90": no keyword, no verb — rule confidence 0.4, mid-band.
    process.env.GEMINI_DAILY_LIMIT = "0";

    await enqueueLineJobs([event("ของชิ้นนี้ 90")]);
    await drain();

    const ask = line.requests.find((r) =>
      JSON.stringify(r.body).includes("พิมพ์ ใช่"),
    );
    expect(ask).toBeTruthy();

    const { count: pending } = await serviceClient()
      .from("line_pending_confirms")
      .select("event_key", { count: "exact", head: true })
      .eq("user_id", userId);
    expect(pending).toBe(1);

    const { count: saved } = await serviceClient()
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("description", "ของชิ้นนี้");
    expect(saved).toBe(0);
  });

  it("saves exactly once when the user replies ใช่", async () => {
    process.env.GEMINI_DAILY_LIMIT = "0";

    const ask = event("ของชิ้นนี้ 90");
    await enqueueLineJobs([ask]);
    await drain();
    await enqueueLineJobs([event("ใช่")]);
    await drain();

    const { count } = await serviceClient()
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("description", "ของชิ้นนี้");
    expect(count).toBe(1);

    const { data: tx } = await serviceClient()
      .from("transactions")
      .select("amount, type, category:categories(slug)")
      .eq("description", "ของชิ้นนี้")
      .single();
    expect(tx).toMatchObject({ amount: 90, type: "expense" });
    const category = tx?.category as unknown as { slug: string };
    expect(category?.slug).toBe("other");

    const { count: pendingLeft } = await serviceClient()
      .from("line_pending_confirms")
      .select("event_key", { count: "exact", head: true })
      .eq("user_id", userId);
    expect(pendingLeft).toBe(0);
  });

  it("skips cleanly when the user replies ไม่ใช่", async () => {
    process.env.GEMINI_DAILY_LIMIT = "0";

    await enqueueLineJobs([event("ของชิ้นโน้น 80")]);
    await drain();
    await enqueueLineJobs([event("ไม่ใช่")]);
    await drain();

    const { count } = await serviceClient()
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("description", "ของชิ้นโน้น");
    expect(count).toBe(0);
  });
});
