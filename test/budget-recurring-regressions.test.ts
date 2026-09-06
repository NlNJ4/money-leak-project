import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getAuthContext: mocks.auth }));
vi.mock("@/lib/rate-limit", () => ({ enforceMutationRateLimit: mocks.limit }));

import { budgetSchema, getBudgetProgress, upsertBudget, deleteBudget } from "@/lib/budgets";
import { recurringCreateSchema, listRecurring, createRecurring, deactivateRecurring } from "@/lib/recurring";

const query = {
  select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
  single: vi.fn(), order: vi.fn(), upsert: vi.fn(), insert: vi.fn(),
  delete: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(), maybeSingle: vi.fn(),
};
const rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: "owner", supabase: { from: () => query, rpc } });
  query.single.mockResolvedValue({ data: { id: "category-id", type: "expense" } });
  query.order.mockResolvedValue({ data: [], error: null });
  query.upsert.mockResolvedValue({ error: null });
  query.insert.mockResolvedValue({ error: null });
  query.maybeSingle.mockResolvedValue({ data: { id: "id" }, error: null });
  rpc.mockResolvedValue({ data: [], error: null });
});

describe("budget and recurring regressions", () => {
  it("does not charge reads against the mutation allowance", async () => {
    for (let i = 0; i < 35; i++) {
      await getBudgetProgress();
      await listRecurring();
    }
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("still rate-limits every write", async () => {
    await upsertBudget({ category: "food", month: "2026-09", amount: 100 });
    await deleteBudget("id");
    await createRecurring({ category: "food", amount: 100, type: "expense", dayOfMonth: 1, description: "" });
    await deactivateRecurring("id");
    expect(mocks.limit).toHaveBeenCalledTimes(4);
    expect(mocks.limit).toHaveBeenCalledWith("owner");
  });

  it("accepts custom slugs and checks their type before writes", async () => {
    const budget = budgetSchema.parse({ category: "my-coffee", month: "2026-09", amount: 100 });
    const recurring = recurringCreateSchema.parse({ category: "my-coffee", amount: 100, type: "expense", dayOfMonth: 1 });
    await upsertBudget(budget);
    await createRecurring(recurring);
    expect(query.eq).toHaveBeenCalledWith("slug", "my-coffee");
    query.single.mockResolvedValue({ data: { id: "category-id", type: "income" } });
    await expect(upsertBudget(budget)).rejects.toThrow("category_type_mismatch");
    await expect(createRecurring(recurring)).rejects.toThrow("category_type_mismatch");
    expect(query.upsert).toHaveBeenCalledTimes(1);
    expect(query.insert).toHaveBeenCalledTimes(1);
  });

  it("rejects inaccessible categories without writing", async () => {
    query.single.mockResolvedValue({ data: null });
    await expect(upsertBudget({ category: "other-user", month: "2026-09", amount: 100 })).rejects.toThrow("category_not_found");
    expect(query.upsert).not.toHaveBeenCalled();
  });

  it("normalizes a full date so the budget is visible in its month", async () => {
    await upsertBudget(budgetSchema.parse({ category: "food", month: "2026-09-17", amount: 100 }));
    expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({ month: "2026-09-01" }), expect.anything());
  });

  it.each(["2026-13", "2026-00", "2026-02-30", "2026-09-00"])("rejects invalid month %s", (month) => {
    expect(budgetSchema.safeParse({ category: "food", month, amount: 100 }).success).toBe(false);
  });
});
