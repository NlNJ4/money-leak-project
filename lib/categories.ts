// Fixed category slugs from the product spec (section 7). The AI parser and
// the web form may only assign these; display names/icons live in the DB.
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
