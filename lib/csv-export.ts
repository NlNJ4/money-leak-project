import { getCategoryLabel } from "@/lib/categories";
import type { Expense } from "@/lib/types";

const CSV_EXCEL_FORMULA_PATTERN = /^[=+\-@\t\r]/;

function escapeCsvValue(value: string | number | boolean) {
  const rawValue = String(value);
  const safeValue = CSV_EXCEL_FORMULA_PATTERN.test(rawValue)
    ? `'${rawValue}`
    : rawValue;

  return `"${safeValue.replace(/"/g, '""')}"`;
}

function formatBangkokDateTime(isoDate: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Asia/Bangkok",
  }).format(new Date(isoDate));
}

export function buildExpensesCsv(expenses: Expense[]) {
  const headers = [
    "spent_at_bangkok",
    "title",
    "amount_baht",
    "category",
    "category_label",
    "is_need",
    "created_at",
    "expense_id",
  ];
  const rows = expenses.map((expense) => [
    formatBangkokDateTime(expense.spentAt),
    expense.title,
    expense.amountBaht,
    expense.category,
    getCategoryLabel(expense.category),
    expense.isNeed,
    expense.createdAt,
    expense.id,
  ]);

  return [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(",")),
  ].join("\r\n");
}

export function getExpensesCsvFilename(lineUserId: string, now = new Date()) {
  const dateKey = new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(now);
  const safeUserId = lineUserId.replace(/[^a-zA-Z0-9_-]/g, "");

  return `money-leak-expenses-${safeUserId}-${dateKey}.csv`;
}
