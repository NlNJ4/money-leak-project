import "server-only";
import { z } from "zod";
import { EXPENSE_CATEGORY_SLUGS, INCOME_CATEGORY_SLUGS } from "@/lib/categories";
import { getAuthContext } from "@/lib/supabase/server";
import { ServiceError } from "@/lib/transactions";

// Custom categories: user-created, must not collide with the system
// catalog or the user's own rows (DB unique indexes are the final gate).

export const customCategorySchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_-]+$/, "invalid slug"),
  name_th: z.string().trim().min(1).max(50),
  name_en: z.string().trim().min(1).max(50),
  icon: z.string().trim().min(1).max(8).default("🏷️"),
  type: z.enum(["income", "expense"]),
});

export type CustomCategoryInput = z.infer<typeof customCategorySchema>;

async function requireAuth() {
  const auth = await getAuthContext();
  if (!auth) throw new ServiceError("unauthorized");
  return auth;
}

export async function createCustomCategory(
  input: CustomCategoryInput,
): Promise<void> {
  const { supabase, userId } = await requireAuth();

  if (
    (EXPENSE_CATEGORY_SLUGS as readonly string[]).includes(input.slug) ||
    (INCOME_CATEGORY_SLUGS as readonly string[]).includes(input.slug)
  ) {
    throw new ServiceError("slug_reserved");
  }

  const { error } = await supabase.from("categories").insert({
    user_id: userId,
    slug: input.slug,
    name_th: input.name_th,
    name_en: input.name_en,
    icon: input.icon,
    type: input.type,
    is_custom: true,
    sort_order: 99,
  });

  if (error) {
    if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
      throw new ServiceError("slug_taken");
    }
    throw new ServiceError("insert_failed", error.message);
  }
}

export async function deleteCustomCategory(id: string): Promise<void> {
  const { supabase } = await requireAuth();
  const { data, error } = await supabase
    .from("categories")
    .delete()
    .eq("id", id)
    .eq("is_custom", true)
    .select("id")
    .maybeSingle();

  if (error) {
    // A category still referenced by transactions is protected by the FK.
    if (/foreign key/i.test(error.message)) {
      throw new ServiceError("category_in_use");
    }
    throw new ServiceError("delete_failed", error.message);
  }
  if (!data) throw new ServiceError("not_found");
}
