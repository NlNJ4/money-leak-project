import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, serviceClient, userClient } from "./env";
import {
  createTestUser,
  insertTransaction,
  wipeLocalData,
  type TestUser,
} from "./helpers";

// Cross-user RLS isolation and anonymous lockdown, enforced by the
// database — not the application.

let userA: TestUser;
let userB: TestUser;
let rowId = "";

beforeAll(async () => {
  userA = await createTestUser("rls-a");
  userB = await createTestUser("rls-b");
  const clientA = await userClient(userA.email, userA.password);
  rowId = await insertTransaction(clientA, userA.userId, {
    description: "rls fixture A",
  });
});

afterAll(async () => {
  await wipeLocalData();
});

describe("authenticated users are isolated", () => {
  it("user B cannot see user A's transactions", async () => {
    const clientB = await userClient(userB.email, userB.password);
    const { data, error } = await clientB.from("transactions").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("user B cannot update or delete user A's row", async () => {
    const clientB = await userClient(userB.email, userB.password);

    const update = await clientB
      .from("transactions")
      .update({ amount: 1 })
      .eq("id", rowId);
    expect(update.error).toBeNull();

    const del = await clientB.from("transactions").delete().eq("id", rowId);
    expect(del.error).toBeNull();

    // Row untouched from A's perspective.
    const clientA = await userClient(userA.email, userA.password);
    const { data } = await clientA
      .from("transactions")
      .select("amount, description")
      .eq("id", rowId)
      .single();
    expect(data?.amount).toBe(100);
    expect(data?.description).toBe("rls fixture A");
  });

  it("user B cannot read A's linking codes or identities", async () => {
    await serviceClient()
      .from("linking_codes")
      .insert({
        code: `MONEY-rlsCode${"x".repeat(18)}`,
        user_id: userA.userId,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });

    const clientB = await userClient(userB.email, userB.password);
    const codes = await clientB.from("linking_codes").select("code");
    expect(codes.error).toBeNull();
    expect(codes.data).toEqual([]);

    const identities = await clientB
      .from("user_identities")
      .select("provider");
    expect(identities.error).toBeNull();
    expect(identities.data).toEqual([]);
  });
});

describe("anonymous clients are locked out", () => {
  it("reads no transactions (RLS, no anon policy)", async () => {
    const { data, error } = await anonClient().from("transactions").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot touch service-role-only tables (privileges revoked)", async () => {
    const anon = anonClient();
    for (const table of [
      "line_jobs",
      "webhook_events",
      "line_command_results",
      "line_worker_tokens",
      "deleted_transaction_staging",
    ] as const) {
      const { error } = await anon.from(table).select("*").limit(1);
      expect(error, table).toBeTruthy();
      expect(error?.message, table).toMatch(/permission denied|insufficient/i);
    }
  });

  it("cannot execute privileged RPCs", async () => {
    const anon = anonClient();
    const claim = await anon.rpc("claim_due_line_jobs", { p_limit: 1 });
    expect(claim.error).toBeTruthy();

    const redeem = await anon.rpc("redeem_linking_code", {
      p_event_key: "",
      p_code: "MONEY-doesnotexist0000000000000",
      p_provider: "line",
      p_provider_user_id: "x",
    });
    expect(redeem.error).toBeTruthy();

    const save = await anon.rpc("save_line_transaction", {
      p_event_key: "anon-attempt",
      p_user_id: userA.userId,
      p_type: "expense",
      p_amount: 1,
      p_category_slug: "food",
      p_description: "x",
      p_transaction_date: "2026-01-01",
    });
    expect(save.error).toBeTruthy();
  });
});
