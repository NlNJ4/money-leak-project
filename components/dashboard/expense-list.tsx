import { getCategoryLabel } from "@/lib/categories";
import { formatBaht } from "@/lib/format";
import type { Expense } from "@/lib/types";

function formatExpenseDate(isoDate: string) {
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(isoDate));
}

export function ExpenseList({ expenses }: { expenses: Expense[] }) {
  if (expenses.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
        ยังไม่มีรายการล่าสุด
      </p>
    );
  }

  return (
    <div className="divide-y divide-zinc-100">
      {expenses.map((expense) => (
        <div
          key={expense.id}
          className="grid grid-cols-[1fr_auto] gap-4 py-3 first:pt-0 last:pb-0"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-950">
              {expense.title}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {getCategoryLabel(expense.category)} ·{" "}
              {formatExpenseDate(expense.spentAt)}
            </p>
          </div>
          <p className="text-sm font-semibold text-zinc-950">
            {formatBaht(expense.amountBaht)}
          </p>
        </div>
      ))}
    </div>
  );
}
