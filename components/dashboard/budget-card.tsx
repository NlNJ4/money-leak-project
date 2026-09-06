"use client";

import { useI18n } from "@/lib/i18n/provider";
import { formatCurrency } from "@/lib/format";
import type { BudgetProgress } from "@/lib/budgets";

// Budget bars for the current month. Color language: emerald under 80%,
// amber 80–99%, rose at/over budget.
export function BudgetCard({ items }: { items: BudgetProgress[] }) {
  const { t, locale } = useI18n();

  if (items.length === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-medium">{t.dashboard.budgets.title}</h2>
      <ul className="mt-3 flex flex-col gap-3">
        {items.map((item) => {
          const pct = Math.min(100, item.pct);
          const tone =
            item.pct >= 100
              ? "bg-rose-500"
              : item.pct >= 80
                ? "bg-amber-500"
                : "bg-emerald-500";
          return (
            <li key={item.slug} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <span className="truncate">
                  {item.icon}{" "}
                  {locale === "th" ? item.name_th : item.name_en}
                  {item.pct >= 100 ? " ⚠️" : ""}
                </span>
                <span className="tabular-nums text-zinc-500">
                  {formatCurrency(Number(item.spent), locale)} /{" "}
                  {formatCurrency(Number(item.budget), locale)}
                </span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-zinc-100"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(item.pct)}
                aria-label={`${locale === "th" ? item.name_th : item.name_en}: ${item.pct}%`}
              >
                <div
                  className={`h-full rounded-full ${tone}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
