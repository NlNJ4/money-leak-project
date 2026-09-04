import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { serviceClient } from "./env";
import {
  createTestUser,
  deleteUser,
  wipeLocalData,
  type TestUser,
} from "./helpers";

// Linking-code lifecycle: expiry, single use, event-key replay, one LINE
// account per web account, and the redemption rate limiter.

let owner: TestUser;

beforeAll(async () => {
  owner = await createTestUser("link-owner");
});

afterAll(async () => {
  await wipeLocalData();
});

async function issueCode(userId: string, expiresInMs = 15 * 60_000) {
  const code = `MONEY-${randomUUID().replace(/-/g, "").slice(0, 22)}`;
  const { error } = await serviceClient().rpc("create_linking_code", {
    p_user_id: userId,
    p_code: code,
    p_expires_at: new Date(Date.now() + expiresInMs).toISOString(),
  });
  if (error) throw new Error(`issue failed: ${error.message}`);
  return code;
}

describe("linking codes", () => {
  it("links, consumes the code, and replays identical results by event key", async () => {
    const admin = serviceClient();
    const code = await issueCode(owner.userId);
    const lineUser = `Ulink-${randomUUID()}`;
    const eventKey = `link-${randomUUID()}`;

    const first = await admin.rpc("redeem_linking_code", {
      p_event_key: eventKey,
      p_code: code,
      p_provider: "line",
      p_provider_user_id: lineUser,
    });
    expect(first.data).toBe("linked");

    // A retried delivery of the SAME webhook event replays, not re-links.
    const replay = await admin.rpc("redeem_linking_code", {
      p_event_key: eventKey,
      p_code: code,
      p_provider: "line",
      p_provider_user_id: lineUser,
    });
    expect(replay.data).toBe("linked");

    const { count } = await admin
      .from("user_identities")
      .select("id", { count: "exact", head: true })
      .eq("user_id", owner.userId)
      .eq("provider", "line");
    expect(count).toBe(1);

    // The code is consumed: a NEW event with the same code finds nothing.
    const reuse = await admin.rpc("redeem_linking_code", {
      p_event_key: `link2-${randomUUID()}`,
      p_code: code,
      p_provider: "line",
      p_provider_user_id: "U-someone-else",
    });
    expect(reuse.data).toBe("not_found");
  });

  it("rejects expired codes and deletes them", async () => {
    const admin = serviceClient();
    const code = await issueCode(owner.userId, -1_000); // already expired
    const { data } = await admin.rpc("redeem_linking_code", {
      p_event_key: `exp-${randomUUID()}`,
      p_code: code,
      p_provider: "line",
      p_provider_user_id: `Uexp-${randomUUID()}`,
    });
    expect(data).toBe("expired");

    const { count } = await admin
      .from("linking_codes")
      .select("code", { count: "exact", head: true })
      .eq("code", code);
    expect(count).toBe(0);
  });

  it("keeps one web account to one LINE account", async () => {
    const admin = serviceClient();
    const code = await issueCode(owner.userId);
    const { data } = await admin.rpc("redeem_linking_code", {
      p_event_key: `second-${randomUUID()}`,
      p_code: code,
      p_provider: "line",
      p_provider_user_id: `Usecond-${randomUUID()}`,
    });
    expect(data).toBe("user_already_linked");
  });

  it("keeps one LINE account to one web account", async () => {
    const admin = serviceClient();
    const other = await createTestUser("link-other");
    const code = await issueCode(other.userId);

    // Re-linking the SAME line user (already linked to owner) to another
    // account must not silently move the identity.
    const { data: existing } = await admin
      .from("user_identities")
      .select("provider_user_id")
      .eq("provider", "line")
      .limit(1);
    const linkedLineUser = existing?.[0]?.provider_user_id ?? "";

    const { data } = await admin.rpc("redeem_linking_code", {
      p_event_key: `third-${randomUUID()}`,
      p_code: code,
      p_provider: "line",
      p_provider_user_id: linkedLineUser,
    });
    expect(data).toBe("already_linked_other");

    await deleteUser(other);
  });

  it("rate-limits redemption attempts to 5 per hour per LINE user", async () => {
    const admin = serviceClient();
    const lineUser = `Urate-${randomUUID()}`;
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      const { data } = await admin.rpc("register_redeem_attempt", {
        p_line_user_id: lineUser,
      });
      results.push(data === true);
    }
    expect(results).toEqual([true, true, true, true, true, false]);
  });
});
