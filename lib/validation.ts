import { z } from "zod";
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
  // ISO date (YYYY-MM-DD); defaults to today in the service.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export const transactionFilterSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type TransactionFilterRange = z.infer<typeof transactionFilterSchema>;
