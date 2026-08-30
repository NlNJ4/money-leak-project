"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useI18n } from "@/lib/i18n/provider";
import { formatCurrency } from "@/lib/format";
import type { CategoryTotal } from "@/lib/transactions";

// Stable categorical palette; slices map to legend rows by position.
const PALETTE = [
  "#f43f5e",
  "#fb923c",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#94a3b8",
];

export function CategoryDonut({
  items,
  total,
}: {
  items: CategoryTotal[];
  total: number;
}) {
  const { t, locale } = useI18n();

  const expenses = items
    .filter((c) => c.type === "expense")
    .map((c, index) => ({
      ...c,
      name: locale === "th" ? c.name_th : c.name_en,
      fill: PALETTE[index % PALETTE.length],
    }));

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-medium">{t.dashboard.categoryBreakdown}</h2>

      {expenses.length === 0 ? (
        <p className="mt-6 pb-4 text-center text-xs text-zinc-400">
          {t.dashboard.charts.noData}
        </p>
      ) : (
        <div className="mt-2 flex flex-col items-center gap-4 sm:flex-row">
          <div className="relative h-44 w-44 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={expenses}
                  dataKey="total"
                  nameKey="name"
                  innerRadius={58}
                  outerRadius={85}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {expenses.map((slice) => (
                    <Cell key={slice.slug} fill={slice.fill} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value), locale)}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-lg font-semibold tabular-nums">
                {formatCurrency(total, locale)}
              </p>
              <p className="text-[11px] text-zinc-500">{t.dashboard.expense}</p>
            </div>
          </div>

          <ul className="flex w-full flex-col gap-1.5 text-xs">
            {expenses.map((slice) => (
              <li
                key={slice.slug}
                className="flex items-center justify-between gap-2"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: slice.fill }}
                  />
                  <span className="truncate">
                    {slice.icon} {slice.name}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-zinc-500">
                  {total > 0 ? Math.round((slice.total / total) * 100) : 0}%
                </span>
                <span className="w-20 shrink-0 text-right font-medium tabular-nums">
                  {formatCurrency(slice.total, locale)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
