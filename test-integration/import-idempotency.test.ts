import "./app-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { serviceClient } from "./env";
import { categoryId, createTestUser, wipeLocalData } from "./helpers";

// "Operation succeeded, response lost": an import committed twice under the
// same import ID must not duplicate rows. The route executes this RPC with
// the service role (user scoping comes from p_user_id), so the test does
// the same.

let user: { userId: string; email: string; password: string };

beforeAll(async () => {
  user = await createTestUser("import-idem");
});

afterAll(wipeLocalData);

describe("import_transactions idempotency", () => {
  it("imports once per import ID, even when committed twice", async () => {
    const foodId = await categoryId(serviceClient(), "food");
    const importId = randomUUID();
    const admin = serviceClient();

    const rows = [
      { type: "expense", amount: 100, category_id: foodId, description: "idem-a", date: "2026-09-06" },
      { type: "expense", amount: 200, category_id: foodId, description: "idem-b", date: "2026-09-06" },
    ];

    const first = await admin.rpc("import_transactions", {
      p_import_id: importId,
      p_user_id: user.userId,
      p_rows: rows,
    });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ status: "imported", inserted: 2 });

    // The retry after a lost response: same ID, same rows.
    const retry = await admin.rpc("import_transactions", {
      p_import_id: importId,
      p_user_id: user.userId,
      p_rows: rows,
    });
    expect(retry.error).toBeNull();
    expect(retry.data).toMatchObject({ status: "already_imported" });

    const { count } = await serviceClient()
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.userId);
    expect(count).toBe(2);

    // A DIFFERENT import ID is a deliberate new import and goes through.
    const second = await admin.rpc("import_transactions", {
      p_import_id: randomUUID(),
      p_user_id: user.userId,
      p_rows: rows,
    });
    expect(second.data).toMatchObject({ status: "imported", inserted: 2 });

    const { count: afterSecond } = await serviceClient()
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.userId);
    expect(afterSecond).toBe(4);
  });
});
