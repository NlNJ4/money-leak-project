import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { serviceClient } from "./env";
import {
  createTestUser,
  insertTransaction,
  wipeLocalData,
  type TestUser,
} from "./helpers";

// Queue integrity: idempotent saves, command replay, per-user FIFO under
// concurrency, and stale-job recovery.

let owner: TestUser;

beforeAll(async () => {
  owner = await createTestUser("queue-owner");
});

afterAll(async () => {
  await wipeLocalData();
});

function enqueue(id: string, timestamp: number, seq = 0, text = "กินข้าว 60") {
  return serviceClient().from("line_jobs").insert({
    id,
    line_user_id: LINE_USER,
    reply_token: "tok-integration",
    text,
    line_timestamp: timestamp,
    batch_seq: seq,
  });
}

const LINE_USER = `Uqueue-${randomUUID()}`;

async function linkLineUser() {
  const admin = serviceClient();
  await admin.from("user_identities").insert({
    user_id: owner.userId,
    provider: "line",
    provider_user_id: LINE_USER,
  });
}

beforeAll(linkLineUser);

describe("save_line_transaction", () => {
  it("creates exactly one transaction for a duplicated webhook event", async () => {
    const admin = serviceClient();
    const key = `save-${randomUUID()}`;

    const first = await admin.rpc("save_line_transaction", {
      p_event_key: key,
      p_user_id: owner.userId,
      p_type: "expense",
      p_amount: 120,
      p_category_slug: "food",
      p_description: "กินข้าว",
      p_transaction_date: "2026-09-05",
    });
    expect(first.data).toBe("saved");

    const dup = await admin.rpc("save_line_transaction", {
      p_event_key: key,
      p_user_id: owner.userId,
      p_type: "expense",
      p_amount: 120,
      p_category_slug: "food",
      p_description: "กินข้าว",
      p_transaction_date: "2026-09-05",
    });
    expect(dup.data).toBe("duplicate");

    const { count } = await admin
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", owner.userId)
      .eq("description", "กินข้าว");
    expect(count).toBe(1);
  });

  it("rejects categories that do not match the transaction type", async () => {
    const { data } = await serviceClient().rpc("save_line_transaction", {
      p_event_key: `cat-${randomUUID()}`,
      p_user_id: owner.userId,
      p_type: "income",
      p_amount: 50,
      p_category_slug: "food",
      p_description: "mismatch",
      p_transaction_date: "2026-09-05",
    });
    expect(data).toBe("invalid_category");
  });

  it("rejects non-positive amounts at the database", async () => {
    const { error } = await serviceClient()
      .from("transactions")
      .insert({
        user_id: owner.userId,
        type: "expense",
        amount: 0,
        category_id: (
          await serviceClient()
            .from("categories")
            .select("id")
            .eq("slug", "food")
            .single()
        ).data!.id,
        description: "zero",
        transaction_date: "2026-09-05",
        source: "web",
      });
    expect(error).toBeTruthy();
  });
});

describe("command replay by event key", () => {
  it("undo deletes once even when the command runs twice", async () => {
    const admin = serviceClient();
    const client = admin; // service role inserts fixture rows directly
    await insertTransaction(client, owner.userId, {
      description: "replay-undo",
      amount: 55,
    });
    const key = `undo-${randomUUID()}`;

    const first = await admin.rpc("delete_latest_line_transaction", {
      p_event_key: key,
      p_line_user_id: LINE_USER,
    });
    expect(first.data).toMatchObject({ status: "deleted", amount: 55 });

    const replay = await admin.rpc("delete_latest_line_transaction", {
      p_event_key: key,
      p_line_user_id: LINE_USER,
    });
    expect(replay.data).toMatchObject({ status: "deleted", amount: 55 });

    const { count } = await admin
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("description", "replay-undo");
    expect(count).toBe(0);

    const { count: staged } = await admin
      .from("deleted_transaction_staging")
      .select("id", { count: "exact", head: true });
    expect(staged).toBe(1);
  });

  it("restore runs once and consumes the staging row", async () => {
    const admin = serviceClient();
    const key = `restore-${randomUUID()}`;

    const first = await admin.rpc("restore_latest_line_transaction", {
      p_event_key: key,
      p_line_user_id: LINE_USER,
    });
    expect(first.data).toMatchObject({ status: "restored", amount: 55 });

    const replay = await admin.rpc("restore_latest_line_transaction", {
      p_event_key: key,
      p_line_user_id: LINE_USER,
    });
    expect(replay.data).toMatchObject({ status: "restored", amount: 55 });

    const { count: staged } = await admin
      .from("deleted_transaction_staging")
      .select("id", { count: "exact", head: true });
    expect(staged).toBe(0);

    const { count: back } = await admin
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("description", "replay-undo");
    expect(back).toBe(1);
  });

  it("edit applies once and replays the same result", async () => {
    const admin = serviceClient();
    const key = `edit-${randomUUID()}`;

    const first = await admin.rpc("update_latest_line_transaction_amount", {
      p_event_key: key,
      p_line_user_id: LINE_USER,
      p_amount: 80,
    });
    expect(first.data).toMatchObject({ status: "updated", amount: 80 });

    const replay = await admin.rpc("update_latest_line_transaction_amount", {
      p_event_key: key,
      p_line_user_id: LINE_USER,
      p_amount: 999, // ignored: result replays, amount stays 80
    });
    expect(replay.data).toMatchObject({ status: "updated", amount: 80 });

    const { data } = await admin
      .from("transactions")
      .select("amount")
      .eq("description", "replay-undo")
      .single();
    expect(Number(data?.amount)).toBe(80);
  });
});

describe("per-user FIFO claiming", () => {
  it("never lets a later message overtake an earlier live one (x20)", async () => {
    const admin = serviceClient();

    for (let round = 0; round < 20; round++) {
      const base = 1_000_000 + round * 100;
      const suffix = `${randomUUID().slice(0, 8)}`;
      await enqueue(`fifo-a-${suffix}`, base, 0);
      await enqueue(`fifo-b-${suffix}`, base + 1, 1);

      // Two concurrent claim attempts — only the earlier job may win.
      const [c1, c2] = await Promise.all([
        admin.rpc("claim_due_line_jobs", { p_limit: 5 }),
        admin.rpc("claim_due_line_jobs", { p_limit: 5 }),
      ]);
      expect(c1.error).toBeNull();
      expect(c2.error).toBeNull();

      const claimed = [
        ...((c1.data ?? []) as { id: string }[]),
        ...((c2.data ?? []) as { id: string }[]),
      ];
      const mine = claimed.filter((job) => job.id.startsWith("fifo-"));
      expect(mine.length).toBe(1);
      expect(mine[0].id).toBe(`fifo-a-${suffix}`);

      await admin.from("line_jobs").delete().like("id", `fifo-%`);
    }
  });

  it("recovers jobs stuck in processing for over 10 minutes", async () => {
    const admin = serviceClient();
    const suffix = randomUUID().slice(0, 8);
    await enqueue(`stale-${suffix}`, 2_000_000, 0);
    await admin.rpc("claim_due_line_jobs", { p_limit: 5 });

    // Nothing to re-claim while the claim is fresh.
    const fresh = await admin.rpc("claim_due_line_jobs", { p_limit: 5 });
    expect((fresh.data as { id: string }[]).filter((j) => j.id.startsWith("stale-"))).toEqual([]);

    // Age the claim past the recovery threshold.
    await admin
      .from("line_jobs")
      .update({
        claimed_at: new Date(Date.now() - 11 * 60_000).toISOString(),
      })
      .eq("id", `stale-${suffix}`);

    const recovered = await admin.rpc("claim_due_line_jobs", { p_limit: 5 });
    const found = ((recovered.data ?? []) as { id: string; attempts: number }[]).find(
      (j) => j.id === `stale-${suffix}`,
    );
    expect(found).toBeTruthy();
    expect(found?.attempts).toBe(2); // recovery incremented

    await admin.from("line_jobs").delete().like("id", `stale-%`);
  });
});
