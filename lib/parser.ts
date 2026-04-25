import { categoryConfig, categoryOrder } from "@/lib/categories";
import type { ExpenseCategory } from "@/lib/types";

export type ParsedExpenseText = {
  title: string;
  amountBaht: number;
  category: ExpenseCategory;
};

export function detectCategory(title: string): ExpenseCategory {
  const normalizedTitle = title.toLowerCase();

  for (const category of categoryOrder) {
    if (category === "other") continue;

    const hasKeyword = categoryConfig[category].keywords.some((keyword) =>
      normalizedTitle.includes(keyword.toLowerCase()),
    );

    if (hasKeyword) return category;
  }

  return "other";
}

export function parseExpenseText(text: string): ParsedExpenseText | null {
  const match = text
    .trim()
    .match(/^(.+?)\s+(\d+)(?:\s*(?:บาท|฿))?$/iu);

  if (!match) return null;

  const title = match[1].trim();
  const amountBaht = Number(match[2]);

  if (!title || !Number.isInteger(amountBaht) || amountBaht <= 0) return null;

  return {
    title,
    amountBaht,
    category: detectCategory(title),
  };
}

export function parseDailyBudgetCommand(text: string) {
  const match = text
    .trim()
    .match(/^(?:ตั้งงบ|ตั้งงบวัน|budget|daily budget)\s+(\d+)(?:\s*(?:บาท|฿))?$/iu);

  if (!match) return null;

  const dailyBudgetBaht = Number(match[1]);

  if (!Number.isInteger(dailyBudgetBaht) || dailyBudgetBaht <= 0) return null;

  return { dailyBudgetBaht };
}

export function parseMonthlyBudgetCommand(text: string) {
  const match = text
    .trim()
    .match(/^(?:ตั้งงบเดือน|budget month|month budget|monthly budget)\s+(\d+)(?:\s*(?:บาท|฿))?$/iu);

  if (!match) return null;

  const monthlyBudgetBaht = Number(match[1]);

  if (!Number.isInteger(monthlyBudgetBaht) || monthlyBudgetBaht <= 0) {
    return null;
  }

  return { monthlyBudgetBaht };
}
