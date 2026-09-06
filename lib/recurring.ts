import "server-only";
import { z } from "zod";
import { CATEGORY_SLUGS } from "@/lib/categories";
import { getAuthContext } from "@/lib/supabase/server";
import { ServiceError } from "@/lib/transactions";
import { enforceMutationRateLimit } from "@/lib/rate-limit";

export const recurringCreateSchema = z.object({
  category: z.enum(CATEGORY_SLUGS),
  description: z.string().trim().max(200).default(""),
  amount: z.coerce.number().positive().max(999_999_999),
  type: z.enum(["income", "expense"]),
  dayOfMonth: z.coerce.number().int().min(1).max(28),
});

export type RecurringCreateInput = z.infer<typeof recurringCreateSchema>;

export type RecurringRule = {
  id: string;
  description: string;
  amount: number;
  type: string;
  day_of_month: number;
  active: boolean;
  category: { slug: string; name_th: string; name_en: string; icon: string } | null;
};

async function requireAuth() {
  const auth = await getAuthContext();
  if (!auth) throw new ServiceError("unauthorized");
  enforceMutationRateLimit(auth.userId);
  return auth;
}

const ruleSelect = `
  id, description, amount, type, day_of_month, active,
  category:categories (slug, name_th, name_en, icon)
`;

export async function listRecurring(): Promise<RecurringRule[]> {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("recurring_rules")
    .select(ruleSelect)
    .order("day_of_month");
  if (error) throw new ServiceError("query_failed", error.message);
  return (data ?? []) as unknown as RecurringRule[];
}

export async function createRecurring(input: RecurringCreateInput): Promise<void> {
  const { supabase, userId } = await requireAuth();

  const { data: category } = await supabase
    .from("categories")
    .select("id, type")
    .eq("slug", input.category)
    .single();
  if (!category) throw new ServiceError("category_not_found");
  if (category.type !== input.type) throw new ServiceError("category_type_mismatch");

  const { error } = await supabase.from("recurring_rules").insert({
    user_id: userId,
    category_id: category.id,
    description: input.description,
    amount: input.amount,
    type: input.type,
    day_of_month: input.dayOfMonth,
  });
  if (error) throw new ServiceError("insert_failed", error.message);
}

export async function deactivateRecurring(id: string): Promise<void> {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("recurring_rules")
    .update({ active: false })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw new ServiceError("update_failed", error.message);
  if (!data) throw new ServiceError("not_found");
}
