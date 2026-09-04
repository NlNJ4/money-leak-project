import { z } from "zod";
import { isValidISODate } from "@/lib/date";
import { CATEGORY_SLUGS } from "@/lib/categories";

// 'transfer' is postponed per the spec (section 8).
export const createTransactionSchema = z.object({
  type: z.enum(["income", "expense"]),
  amount: z.coerce
    .number()
    .positive()
    .max(999_999_999, "amount too large"),
  category: z.enum(CATEGORY_SLUGS),
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
