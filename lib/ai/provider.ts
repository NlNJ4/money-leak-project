import type { CategorySlug, TransactionType } from "@/lib/categories";

// Result of turning free text into a structured transaction.
// `null` means the text is not a usable transaction — the caller decides
// how to respond (help message, confirmation request, etc.).
export type ParsedTransaction = {
  type: TransactionType;
  amount: number;
  category: CategorySlug;
  description: string;
  date: string; // YYYY-MM-DD
};

export interface TransactionParser {
  parseTransaction(text: string): Promise<ParsedTransaction | null>;
}
