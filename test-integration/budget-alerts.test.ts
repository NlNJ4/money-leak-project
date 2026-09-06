import "./app-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { serviceClient } from "./env";
import {
  categoryId,
  createTestUser,
  wipeLocalData,
} from "./helpers";
import { startMock } from "./mocks";
import { checkBudgetAlerts } from "@/lib/budget-alerts";
import { monthRange } from "@/lib/date";

// Budget warnings: exactly one push per level per budget-month, even when
// the check runs repeatedly, and only the correct severity per spend.

let line: Awaited<ReturnType<typeof startMock>>;
let userId = "";
let foodId = "";

beforeAll(async () => {
  line = await startMock("line-budget-alerts");
  process.env.LINE_API_BASE_URL = line.url;

  const user = await createTestUser("budget-alerts");
  userId = user.userId;
  foodId = await categoryId(serviceClient(), "food");

  await serviceClient().from("user_identities").insert({
    user_id: userId,
    provider: "line",
    provider_user_id: `Ubudget-${randomUUID()}`,
  });
});

afterAll(async () => {
  await wipeLocalData();
  await line.close();
});

async function setBudget(amount: number) {
  const { error } = await serviceClient().from("budgets").upsert(
    {
      user_id: userId,
      category_id: foodId,
      month: `${monthRange().from.slice(0, 7)}-01`,
      amount,
    },
    { onConflict: "user_id,category_id,month" },
  );
  if (error) throw error;
}

describe("budget alerts", () => {
  it("stays silent below 80%", async () => {
    await setBudget(1000);
    // 30% of budget
    await serviceClient().from("transactions").insert({
      user_id: userId,
      type: "expense",
      amount: 300,
      category_id: foodId,
      description: "under",
      transaction_date: monthRange().from,
      source: "web",
    });

    await checkBudgetAlerts(userId);
    expect(line.requests.length).toBe(0);
  });

  it("pushes the 80% warning once across repeated checks", async () => {
    // Cross 80%: total 900/1000.
    await serviceClient().from("transactions").insert({
      user_id: userId,
      type: "expense",
      amount: 600,
      category_id: foodId,
      description: "over80",
      transaction_date: monthRange().from,
      source: "web",
    });

    await checkBudgetAlerts(userId);
    await checkBudgetAlerts(userId);
    await checkBudgetAlerts(userId);

    // Warning text carries the real percentage; level-100 messages say
    // "หมดแล้ว" instead.
    const warnings = line.requests.filter((r) =>
      JSON.stringify(r.body).includes("เดือนนี้ใช้แล้ว"),
    );
    expect(warnings).toHaveLength(1);
  });

  it("pushes the 100% warning once and never repeats the 80%", async () => {
    // Cross 100%: total 1050/1000.
    await serviceClient().from("transactions").insert({
      user_id: userId,
      type: "expense",
      amount: 150,
      category_id: foodId,
      description: "over100",
      transaction_date: monthRange().from,
      source: "web",
    });

    await checkBudgetAlerts(userId);
    await checkBudgetAlerts(userId);

    const exceeded = line.requests.filter((r) =>
      JSON.stringify(r.body).includes("หมดแล้ว"),
    );
    expect(exceeded).toHaveLength(1);
    const warnings = line.requests.filter((r) =>
      JSON.stringify(r.body).includes("เดือนนี้ใช้แล้ว"),
    );
    expect(warnings).toHaveLength(1); // still exactly the earlier one
  });
});
