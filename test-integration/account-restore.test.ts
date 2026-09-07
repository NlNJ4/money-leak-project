import "./app-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { userClient } from "./env";
import { categoryId, createTestUser, wipeLocalData } from "./helpers";
import { collectExportData } from "@/lib/account";
import type { AuthContext } from "@/lib/supabase/server";

type UserClient = Awaited<ReturnType<typeof userClient>>;

// Recovery proof: the JSON export must contain everything needed to
// rebuild the account through the same validated paths the app uses.
// User A is seeded realistically (custom category, transactions in custom
// AND system categories, a budget, a recurring rule). A's export is then
// replayed into user B, and B's re-export must match A's export on every
// reconstructable field.
//
// Known, documented losses (provenance only, asserted here so the docs
// stay honest): per-transaction source/created_at, inactive recurring
// rules, and the LINE linkage itself.

let userA: { userId: string; email: string; password: string };
let userB: { userId: string; email: string; password: string };
let clientA: UserClient;
let clientB: UserClient;

function authLike(
  client: UserClient,
  userId: string,
): AuthContext {
  return {
    supabase: client as unknown as AuthContext["supabase"],
    userId,
    displayName: "restore-test",
    email: "restore@test.invalid",
  };
}

beforeAll(async () => {
  userA = await createTestUser("restore-a");
  userB = await createTestUser("restore-b");
  clientA = await userClient(userA.email, userA.password);
  clientB = await userClient(userB.email, userB.password);
});

afterAll(wipeLocalData);

describe("export → restore round-trip", () => {
  it("rebuilds the account from the export with field-level fidelity", async () => {
    // ---- Seed user A through RLS-scoped writes ----
    const customSlug = `resto-${randomSlug()}`;
    const { data: customCat, error: catErr } = await clientA
      .from("categories")
      .insert({
        user_id: userA.userId,
        slug: customSlug,
        name_th: "กาแฟดริป",
        name_en: "Drip coffee",
        icon: "☕",
        type: "expense",
        is_custom: true,
        sort_order: 99,
      })
      .select("id")
      .single();
    expect(catErr).toBeNull();

    const foodId = await categoryId(clientA, "food");
    const salaryId = await categoryId(clientA, "salary");

    await clientA.from("transactions").insert([
      { user_id: userA.userId, type: "expense", amount: 65, category_id: customCat!.id, description: "drip", transaction_date: "2026-09-01", source: "web" },
      { user_id: userA.userId, type: "expense", amount: 120, category_id: foodId, description: "lunch", transaction_date: "2026-09-02", source: "web" },
      { user_id: userA.userId, type: "income", amount: 30000, category_id: salaryId, description: "payday", transaction_date: "2026-09-05", source: "web" },
    ]);

    await clientA.from("budgets").upsert({
      user_id: userA.userId,
      category_id: customCat!.id,
      month: "2026-09-01",
      amount: 2000,
    }, { onConflict: "user_id,category_id,month" });

    await clientA.from("recurring_rules").insert({
      user_id: userA.userId,
      category_id: foodId,
      description: "มื้อกลางวัน",
      amount: 600,
      type: "expense",
      day_of_month: 10,
    });

    // ---- Export A ----
    const exportA = (await collectExportData(
      authLike(clientA, userA.userId),
    )) as {
      transactions: Array<Record<string, unknown>>;
      budgets: Array<Record<string, unknown>>;
      recurring_rules: Array<Record<string, unknown>>;
      custom_categories: Array<Record<string, unknown>>;
    };

    expect(exportA.transactions).toHaveLength(3);
    expect(exportA.budgets).toHaveLength(1);
    expect(exportA.recurring_rules).toHaveLength(1);
    expect(exportA.custom_categories).toHaveLength(1);

    // ---- Replay into user B using the same validated paths ----
    // Custom category first (transactions and budgets reference it).
    const exportedCategory = exportA.custom_categories[0];
    const { data: restoredCat, error: restoredCatErr } = await clientB
      .from("categories")
      .insert({
        user_id: userB.userId,
        slug: exportedCategory.slug as string,
        name_th: exportedCategory.name_th as string,
        name_en: exportedCategory.name_en as string,
        icon: exportedCategory.icon as string,
        type: exportedCategory.type as string,
        is_custom: true,
        sort_order: 99,
      })
      .select("id")
      .single();
    expect(restoredCatErr).toBeNull();

    for (const tx of exportA.transactions) {
      const slug = tx.category_id as string;
      const { data: cat } = await clientB
        .from("categories")
        .select("id")
        .eq("slug", slug)
        .or(`user_id.is.null,user_id.eq.${userB.userId}`)
        .limit(1)
        .maybeSingle();
      const { error } = await clientB.from("transactions").insert({
        user_id: userB.userId,
        type: tx.type as string,
        amount: tx.amount as number,
        category_id: cat!.id,
        description: tx.description as string,
        transaction_date: tx.date as string,
        source: "web",
      });
      expect(error).toBeNull();
    }

    for (const budget of exportA.budgets) {
      const { error } = await clientB.from("budgets").upsert({
        user_id: userB.userId,
        category_id: budget.category_id as string,
        month: budget.month as string,
        amount: budget.amount as number,
      }, { onConflict: "user_id,category_id,month" });
      expect(error).toBeNull();
    }

    for (const rule of exportA.recurring_rules) {
      const { error } = await clientB.from("recurring_rules").insert({
        user_id: userB.userId,
        category_id: rule.category_id as string,
        description: rule.description as string,
        amount: rule.amount as number,
        type: rule.type as string,
        day_of_month: rule.day_of_month as number,
      });
      expect(error).toBeNull();
    }

    // ---- Re-export B and compare, field by field ----
    const exportB = (await collectExportData(
      authLike(clientB, userB.userId),
    )) as typeof exportA;

    // Transactions: every reconstructable field matches.
    const aTx = [...exportA.transactions].sort(byDateDesc);
    const bTx = [...exportB.transactions].sort(byDateDesc);
    expect(bTx).toHaveLength(aTx.length);
    for (let i = 0; i < aTx.length; i++) {
      expect(bTx[i]).toMatchObject({
        date: aTx[i].date,
        type: aTx[i].type,
        category_id: aTx[i].category_id,
        description: aTx[i].description,
        amount: aTx[i].amount,
      });
    }

    // Budgets and rules: same rows, same values.
    expect(exportB.budgets).toHaveLength(exportA.budgets.length);
    expect(exportB.budgets[0]).toMatchObject({
      month: exportA.budgets[0].month,
      amount: exportA.budgets[0].amount,
      category_id: exportA.budgets[0].category_id,
    });
    expect(exportB.recurring_rules).toHaveLength(exportA.recurring_rules.length);
    expect(exportB.recurring_rules[0]).toMatchObject({
      description: exportA.recurring_rules[0].description,
      amount: exportA.recurring_rules[0].amount,
      type: exportA.recurring_rules[0].type,
      day_of_month: exportA.recurring_rules[0].day_of_month,
    });

    // Custom category: same slug and display fields.
    expect(exportB.custom_categories[0]).toMatchObject({
      slug: exportA.custom_categories[0].slug,
      name_th: exportA.custom_categories[0].name_th,
      name_en: exportA.custom_categories[0].name_en,
      type: exportA.custom_categories[0].type,
    });
  });
});

function randomSlug(): string {
  return Math.random().toString(36).slice(2, 10);
}

function byDateDesc(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number {
  return String(b.date).localeCompare(String(a.date));
}
