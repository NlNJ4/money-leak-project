import "server-only";
import { z } from "zod";
import { EXPENSE_CATEGORY_SLUGS } from "@/lib/categories";
import { monthRange } from "@/lib/date";
import { getAuthContext } from "@/lib/supabase/server";
import { ServiceError } from "@/lib/transactions";

export const budgetSchema = z.object({
  category: z.enum(EXPENSE_CATEGORY_SLUGS),
  // YYYY-MM or a full ISO date; normalized to the month's first day.
  month: z
    .string()
    .regex(/^\d{4}-\d{2}(-\d{2})?$/, "invalid month"),
  amount: z.coerce.number().positive().max(999_999_999),
});

export type BudgetInput = z.infer<typeof budgetSchema>;

export type BudgetProgress = {
  slug: string;
  icon: string;
  name_th: string;
  name_en: string;
  budget: number;
  spent: number;
  pct: number;
};

function monthStart(month: string): string {
  return month.length === 7 ? `${month}-01` : month;
}

async function requireAuth() {
  const auth = await getAuthContext();
  if (!auth) throw new ServiceError("unauthorized");
  return auth;
}

// Upsert: one budget per (user, category, month) — setting again replaces.
export async function upsertBudget(input: BudgetInput): Promise<void> {
  const { supabase, userId } = await requireAuth();

  const { data: category } = await supabase
    .from("categories")
    .select("id, type")
    .eq("slug", input.category)
    .single();
  if (!category) throw new ServiceError("category_not_found");
  if (category.type !== "expense") throw new ServiceError("category_type_mismatch");

  const { error } = await supabase
    .from("budgets")
    .upsert(
      {
        user_id: userId,
        category_id: category.id,
        month: monthStart(input.month),
        amount: input.amount,
      },
      { onConflict: "user_id,category_id,month" },
    );

  if (error) throw new ServiceError("upsert_failed", error.message);
}

export async function deleteBudget(id: string): Promise<void> {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("budgets")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw new ServiceError("delete_failed", error.message);
  if (!data) throw new ServiceError("not_found");
}

// Month-to-date spend vs budgets, computed in SQL for the caller.
// budget_progress returns a JSON array as the scalar value — PostgREST
// delivers it as-is.
export async function getBudgetProgress(
  month = monthRange().from,
): Promise<BudgetProgress[]> {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase.rpc("budget_progress", {
    p_month: monthStart(month.slice(0, 7)),
  });
  if (error) throw new ServiceError("query_failed", error.message);
  return (data ?? []) as unknown as BudgetProgress[];
}
