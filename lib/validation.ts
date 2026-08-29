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
