import "./app-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceClient, userClient } from "./env";
import {
  categoryId,
  createTestUser,
  wipeLocalData,
} from "./helpers";

// Recurring rules: web CRUD through RLS, SQL-side idempotent
// materialization, and source tagging.

let user: { userId: string; email: string; password: string };
let client: Awaited<ReturnType<typeof userClient>>;

beforeAll(async () => {
  user = await createTestUser("recurring");
  client = await userClient(user.email, user.password);
});

afterAll(wipeLocalData);

describe("recurring rules", () => {
  it("creates a rule through RLS and materializes exactly one transaction per month", async () => {
    const subscriptionId = await categoryId(client, "entertainment");

    const { error } = await client.from("recurring_rules").insert({
      user_id: user.userId,
      category_id: subscriptionId,
      description: "Netflix",
      amount: 419,
      type: "expense",
      day_of_month: 5,
    });
    expect(error).toBeNull();

    const today = new Date();
    const thisMonth = `${today.toISOString().slice(0, 7)}-05`;

    const first = await serviceClient().rpc("materialize_recurring", {
      p_month: thisMonth,
    });
    expect(Number(first.data)).toBeGreaterThanOrEqual(1);

    // Second run in the same month: idempotent, nothing new.
    const second = await serviceClient().rpc("materialize_recurring", {
      p_month: thisMonth,
    });
    expect(Number(second.data)).toBe(0);

    const { data: rows } = await serviceClient()
      .from("transactions")
      .select("id, amount, source")
      .eq("user_id", user.userId)
      .eq("description", "Netflix");
    expect(rows).toHaveLength(1);
    expect(Number(rows?.[0]?.amount)).toBe(419);
    expect(rows?.[0]?.source).toBe("recurring");
  });

  it("isolates rules between users", async () => {
    const other = await createTestUser("recurring-other");
    const otherClient = await userClient(other.email, other.password);
    const { data } = await otherClient.from("recurring_rules").select("id");
    expect(data).toEqual([]);
  });

  it("rejects non-positive amounts at the table", async () => {
    const foodId = await categoryId(client, "food");
    const { error } = await client.from("recurring_rules").insert({
      user_id: user.userId,
      category_id: foodId,
      amount: 0,
      type: "expense",
      day_of_month: 1,
    });
    expect(error).toBeTruthy();
  });
});
