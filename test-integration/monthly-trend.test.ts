import "./app-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient, userClient } from "./env";
import { createTestUser, insertTransaction, wipeLocalData } from "./helpers";

// Monthly trend: trailing-N-month series with zero-filled months.

let user: { userId: string; email: string; password: string };
let client: Awaited<ReturnType<typeof userClient>>;

beforeAll(async () => {
  user = await createTestUser("trend");
  client = await userClient(user.email, user.password);
});

afterAll(wipeLocalData);

describe("monthly_trend", () => {
  it("returns a zero-filled series of exactly N months in order", async () => {
    // One expense this month; all other months must arrive as zeros.
    await insertTransaction(serviceClient(), user.userId, {
      slug: "food",
      amount: 250,
      type: "expense",
    });

    const { data, error } = await client.rpc("monthly_trend", { p_months: 6 });
    expect(error).toBeNull();

    // Scalar json: the array arrives as-is.
    const trend = (data ?? []) as Array<{
      month: string;
      income: number;
      expense: number;
      net: number;
    }>;
    expect(trend).toHaveLength(6);

    // Chronological order.
    const months = trend.map((row) => row.month);
    expect([...months].sort()).toEqual(months);

    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);
    const current = trend.find((row) => row.month === thisMonth);
    expect(current).toBeTruthy();
    expect(Number(current?.expense)).toBe(250);

    // Every non-current month is zero-filled.
    for (const row of trend) {
      if (row.month !== thisMonth) {
        expect(Number(row.expense)).toBe(0);
        expect(Number(row.income)).toBe(0);
      }
    }
  });

  it("isolates users", async () => {
    const other = await createTestUser("trend-other");
    const otherClient = await userClient(other.email, other.password);
    const { data } = await otherClient.rpc("monthly_trend", { p_months: 3 });
    const trend = (data ?? []) as Array<{ expense: number }>;
    for (const row of trend) {
      expect(Number(row.expense)).toBe(0);
    }
  });
});
