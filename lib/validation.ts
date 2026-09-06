import { z } from "zod";
import { isValidISODate } from "@/lib/date";

// Slugs are validated against the caller's effective category set (system
// 14 + their custom rows) at the service layer; here we only enforce shape.
export const categorySlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9_-]+$/, "invalid slug");

// 'transfer' is postponed per the spec (section 8).
export const createTransactionSchema = z.object({
  type: z.enum(["income", "expense"]),
  amount: z.coerce
    .number()
    .positive()
    .max(999_999_999, "amount too large"),
  category: categorySlugSchema,
  description: z.string().trim().max(200).default(""),
  // Real calendar date (YYYY-MM-DD) — rejects 2026-99-99 (audit item 15).
  date: z
    .string()
    .refine(isValidISODate, "invalid date")
    .optional(),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

// Partial edit: only provided fields change. Changing type without also
// providing a matching category is rejected at the service layer (and by
// the DB trigger), because the current category belongs to the old type.
export const updateTransactionSchema = createTransactionSchema.partial();

export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

export const idParamSchema = z.string().uuid();

export const transactionFilterSchema = z
  .object({
    from: z.string(),
    to: z.string(),
  })
  .refine(
    (v) => isValidISODate(v.from) && isValidISODate(v.to) && v.from <= v.to,
    "invalid range",
  );

export type TransactionFilterRange = z.infer<typeof transactionFilterSchema>;

// History page + CSV export filters: extends the strict range schema
// (real calendar dates, from <= to) instead of duplicating its fields.
export const historyFilterSchema = transactionFilterSchema.and(
  z.object({
    type: z.enum(["income", "expense"]).optional(),
    category: categorySlugSchema.optional(),
    source: z.enum(["web", "line", "receipt", "recurring"]).optional(),
    q: z.string().trim().max(100).optional(),
  }),
);

export type HistoryFilterInput = z.infer<typeof historyFilterSchema>;
