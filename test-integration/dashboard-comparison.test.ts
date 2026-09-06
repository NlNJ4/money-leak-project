import "./app-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient, userClient } from "./env";
import {
  categoryId,
  createTestUser,
  insertTransaction,
  wipeLocalData,
} from "./helpers";

// Month-over-month comparison: dashboard_summary returns a `previous`
// block computed over the preceding calendar month.

let client: Awaited<ReturnType<typeof userClient>>;
let userId: string;

beforeAll(async () => {
  const user = await createTestUser("comparison");
  userId = user.userId;
  client = await userClient(user.email, user.password);

  const now = new Date();
  const thisMonth = `${now.toISOString().slice(0, 7)}-10`;
  const lastMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
  const lastMonth = lastMonthDate.toISOString().slice(0, 10);

  // This month: 400 expense. Last month: 1000 expense, 5000 income.
  await insertTransaction(serviceClient(), userId, {
    slug: "food", amount: 400, type: "expense",
  });
  await serviceClient()
    .from("transactions")
    .insert({
      user_id: userId,
      type: "expense",
      amount: 1000,
      category_id: await categoryId(client, "food"),
      description: "last-month-spend",
      transaction_date: lastMonth,
      source: "web",
    });
  await serviceClient()
    .from("transactions")
    .insert({
      user_id: userId,
      type: "income",
      amount: 5000,
      category_id: await categoryId(client, "salary"),
      description: "last-month-income",
      transaction_date: lastMonth,
      source: "web",
    });
  void thisMonth;
});

afterAll(wipeLocalData);

describe("dashboard_summary comparison", () => {
  it("computes previous-calendar-month totals", async () => {
    const now = new Date();
    const monthStart = `${now.toISOString().slice(0, 7)}-01`;
    const monthEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    )
      .toISOString()
      .slice(0, 10);

    const { data, error } = await client.rpc("dashboard_summary", {
      p_from: monthStart,
      p_to: monthEnd,
    });
    expect(error).toBeNull();

    const summary = (Array.isArray(data) ? data[0] : data) as {
      totals: { income: number; expense: number; net: number };
      previous: { income: number; expense: number; net: number };
    };

    expect(Number(summary.totals.expense)).toBe(400);
    expect(Number(summary.previous.expense)).toBe(1000);
    expect(Number(summary.previous.income)).toBe(5000);
    expect(Number(summary.previous.net)).toBe(4000);
  });
});
