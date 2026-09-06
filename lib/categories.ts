// Fixed category slugs from the product spec (section 7) — the SYSTEM
// catalog. Users may add custom categories (migration 21); system slugs
// remain the keyword-matching vocabulary for the local parser and the
// fallback "other"/"other_income".
export const EXPENSE_CATEGORY_SLUGS = [
  "food",
  "transport",
  "shopping",
  "housing",
  "bills",
  "health",
  "entertainment",
  "family",
  "other",
] as const;

export const INCOME_CATEGORY_SLUGS = [
  "salary",
  "freelance",
  "investment",
  "refund",
  "other_income",
] as const;

export const CATEGORY_SLUGS = [...EXPENSE_CATEGORY_SLUGS, ...INCOME_CATEGORY_SLUGS] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];
export type TransactionType = "income" | "expense";

export function isSystemSlug(slug: string): boolean {
  return (CATEGORY_SLUGS as readonly string[]).includes(slug);
}
