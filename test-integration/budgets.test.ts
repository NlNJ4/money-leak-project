import "./app-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient, userClient } from "./env";
import {
  categoryId,
  createTestUser,
  insertTransaction,
  wipeLocalData,
} from "./helpers";
import { monthRange } from "@/lib/date";

// Monthly budgets: upsert semantics, RLS isolation, and SQL-side progress
// computation (budget vs month-to-date expense per category).

let user: { userId: string; email: string; password: string };
let client: Awaited<ReturnType<typeof userClient>>;

beforeAll(async () => {
  user = await createTestUser("budget");
  client = await userClient(user.email, user.password);
});

afterAll(wipeLocalData);

describe("budgets", () => {
  it("upserts one budget per category+month (replace, not duplicate)", async () => {
    const foodId = await categoryId(client, "food");

    const first = await client.from("budgets").upsert(
      { user_id: user.userId, category_id: foodId, month: "2026-09-01", amount: 6000 },
      { onConflict: "user_id,category_id,month" },
    );
    expect(first.error).toBeNull();

    const second = await client.from("budgets").upsert(
      { user_id: user.userId, category_id: foodId, month: "2026-09-01", amount: 7000 },
      { onConflict: "user_id,category_id,month" },
    );
    expect(second.error).toBeNull();

    const { count } = await client
      .from("budgets")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.userId);
    expect(count).toBe(1);

    const { data } = await client
      .from("budgets")
      .select("amount")
      .single();
    expect(Number(data?.amount)).toBe(7000);
  });

  it("rejects non-positive amounts at the table", async () => {
    const transportId = await categoryId(client, "transport");
    const { error } = await client.from("budgets").insert({
      user_id: user.userId,
      category_id: transportId,
      month: "2026-09-01",
      amount: 0,
    });
    expect(error).toBeTruthy();
  });

  it("computes progress from month-to-date expenses in SQL", async () => {
    // 1200 spent on food this month against the 7000 budget → ~17.1%.
    await insertTransaction(serviceClient(), user.userId, {
      slug: "food",
      amount: 1200,
    });

    const { data, error } = await client.rpc("budget_progress", {
      p_month: monthRange().from,
    });
    expect(error).toBeNull();

    // Scalar JSON: the array arrives as-is.
    const progress = (data ?? []) as Array<{
      slug: string;
      budget: number;
      spent: number;
      pct: number;
    }>;
    const food = progress.find((row) => row.slug === "food");
    expect(food).toBeTruthy();
    expect(Number(food!.budget)).toBe(7000);
    expect(Number(food!.spent)).toBe(1200);
    expect(Number(food!.pct)).toBeCloseTo(17.1, 1);
  });

  it("isolates budgets between users", async () => {
    const other = await createTestUser("budget-other");
    const otherClient = await userClient(other.email, other.password);

    const { data } = await otherClient.from("budgets").select("id");
    expect(data).toEqual([]);
  });
});
