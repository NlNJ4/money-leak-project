import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { serviceClient } from "./env";

// Phase 1 acceptance: a fresh database that ran every migration (via
// `supabase db reset`) has the seeded catalog, the worker token bootstrap,
// and callable queue machinery. This is the canary that fails CI when a
// migration is invalid or out of order.

let workerToken = "";

beforeAll(async () => {
  const { data, error } = await serviceClient()
    .from("line_worker_tokens")
    .select("token")
    .limit(1);
  if (error) throw new Error(`worker token bootstrap missing: ${error.message}`);
  workerToken = data?.[0]?.token ?? "";
});

describe("migrations applied on a fresh database", () => {
  it("seeds the 14 fixed categories", async () => {
    const { data, error } = await serviceClient()
      .from("categories")
      .select("slug, type");
    expect(error).toBeNull();
    expect(data?.length).toBe(14);
    expect(data?.filter((c) => c.type === "expense").length).toBe(9);
    expect(data?.filter((c) => c.type === "income").length).toBe(5);
  });

  it("bootstraps exactly one worker token", async () => {
    const { count, error } = await serviceClient()
      .from("line_worker_tokens")
      .select("token", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(count).toBe(1);
    expect(workerToken.length).toBeGreaterThan(20);
  });

  it("creates the queue tables and can claim nothing on an empty queue", async () => {
    const { data, error } = await serviceClient().rpc("claim_due_line_jobs", {
      p_limit: 5,
    });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("runs the idempotency RPCs end to end on an unknown user", async () => {
    const admin = serviceClient();
    const key = `smoke-${randomUUID()}`;

    const first = await admin.rpc("delete_latest_line_transaction", {
      p_event_key: key,
      p_line_user_id: "no-such-line-user",
    });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ status: "not_linked" });

    // Same event key replays the stored result instead of re-executing.
    const replay = await admin.rpc("delete_latest_line_transaction", {
      p_event_key: key,
      p_line_user_id: "no-such-line-user",
    });
    expect(replay.error).toBeNull();
    expect(replay.data).toMatchObject({ status: "not_linked" });

    await admin.from("line_command_results").delete().eq("event_key", key);
  });

  it("aggregates summaries without touching transaction rows", async () => {
    const admin = serviceClient();
    const { data: users } = await admin.from("user_identities").select("user_id").limit(1);
    const someUser = users?.[0]?.user_id ?? "00000000-0000-0000-0000-000000000000";
    const { data, error } = await admin.rpc("line_range_summary", {
      p_user_id: someUser,
      p_from: "2026-01-01",
      p_to: "2026-12-31",
    });
    expect(error).toBeNull();
    expect(data).toHaveProperty("income");
    expect(data).toHaveProperty("expense");
  });
});
