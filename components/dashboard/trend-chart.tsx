"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "@/lib/i18n/provider";
import { formatCurrency } from "@/lib/format";

export type TrendPoint = {
  month: string; // YYYY-MM
  income: number;
  expense: number;
  net: number;
};

// Six-month income vs expense trend, zero-filled months included so the
// time axis stays honest.
export function TrendChart({ data }: { data: TrendPoint[] }) {
  const { t, locale } = useI18n();

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-medium">{t.dashboard.charts.trend}</h2>
        <p className="mt-6 pb-4 text-center text-xs text-zinc-400">
          {t.dashboard.charts.noData}
        </p>
      </div>
    );
  }

  const chartData = data.map((point) => ({
    ...point,
    label: `${Number(point.month.slice(5, 7))}/${point.month.slice(2, 4)}`,
  }));

  const peak = chartData.reduce(
    (best, point) => (point.expense > best.expense ? point : best),
    chartData[0],
  );

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-medium">{t.dashboard.charts.trend}</h2>
      <div
        className="mt-3 h-48"
        role="img"
        aria-label={`${t.dashboard.charts.trend} — ${t.dashboard.expense} ${formatCurrency(peak.expense, locale)} (${peak.month})`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="expenseFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fb7185" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#fb7185" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#34d399" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="#f4f4f5" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={10} />
            <YAxis hide />
            <Tooltip
              formatter={(value: unknown, name: unknown) => [
                formatCurrency(Number(value ?? 0), locale),
                name === "expense" ? t.dashboard.expense : t.dashboard.income,
              ]}
            />
            <Area
              type="monotone"
              dataKey="expense"
              stroke="#fb7185"
              strokeWidth={2}
              fill="url(#expenseFill)"
            />
            <Area
              type="monotone"
              dataKey="income"
              stroke="#34d399"
              strokeWidth={2}
              fill="url(#incomeFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
