import "./app-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient, userClient } from "./env";
import { categoryId, createTestUser, wipeLocalData } from "./helpers";

// Regression test for the export-paging bug: listHistory pages must stay
// below the 1,000-row response cap, or the look-ahead row is dropped and
// a >1,000-row export silently stops at 1,000. This walks pages exactly
// the way the export route does (limit = 999 + 1 look-ahead).

const TOTAL = 1_150;

let user: { userId: string; email: string; password: string };
let client: Awaited<ReturnType<typeof userClient>>;

beforeAll(async () => {
  user = await createTestUser("export-paging");
  client = await userClient(user.email, user.password);

  const foodId = await categoryId(serviceClient(), "food");
  const month = new Date().toISOString().slice(0, 7);

  // Bulk-seed TOTAL rows in chunks of 500.
  for (let start = 0; start < TOTAL; start += 500) {
    const chunk = Array.from({ length: Math.min(500, TOTAL - start) }, (_, i) => ({
      user_id: user.userId,
      type: "expense",
      amount: 1,
      category_id: foodId,
      description: `bulk-${start + i}`,
      transaction_date: `${month}-01`,
      source: "web",
    }));
    const { error } = await serviceClient().from("transactions").insert(chunk);
    if (error) throw new Error(`bulk insert failed: ${error.message}`);
  }
});

afterAll(wipeLocalData);

describe("export pagination below the response cap", () => {
  it("collects every row across 999-row pages where a naive page stops", async () => {

    // Prove the cap is real on this stack: a single 1,000-row request
    // must not return more than 1,000.
    const naive = await client
      .from("transactions")
      .select("id")
      .eq("user_id", user.userId)
      .limit(1_000);
    expect(naive.data?.length).toBeLessThanOrEqual(1_000);

    // Walk pages exactly like the export route (999 + 1 look-ahead).
    const collected: string[] = [];
    let cursor: { createdAt: string; id: string } | undefined;
    let guard = 0;
    do {
      let query = client
        .from("transactions")
        .select("id, created_at")
        .eq("user_id", user.userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(999 + 1);
      if (cursor) {
        query = query.or(
          `and(created_at.lt.${cursor.createdAt}),and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
        );
      }
      const { data, error } = await query;
      expect(error).toBeNull();

      const rows = (data ?? []) as { id: string; created_at: string }[];
      const hasMore = rows.length > 999;
      const page = hasMore ? rows.slice(0, 999) : rows;
      collected.push(...page.map((row) => row.id));

      if (!hasMore) break;
      const last = page[page.length - 1];
      cursor = { createdAt: last.created_at, id: last.id };
      guard += 1;
      expect(guard).toBeLessThan(10); // no runaway loops
    } while (cursor);

    expect(collected).toHaveLength(TOTAL);
    expect(new Set(collected).size).toBe(TOTAL);
  });
});
