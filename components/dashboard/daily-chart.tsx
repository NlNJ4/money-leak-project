"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "@/lib/i18n/provider";
import { formatCurrency } from "@/lib/format";

export function DailyChart({
  data,
}: {
  data: { date: string; expense: number }[];
}) {
  const { t, locale } = useI18n();

  const chartData = data.map((d) => ({
    ...d,
    day: Number(d.date.slice(8, 10)),
  }));

  const maxDay = data.reduce(
    (best, d) => (d.expense > best.expense ? d : best),
    { date: "", expense: 0 },
  );

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-medium">
        {t.dashboard.charts.daily} · {t.dashboard.expense}
      </h2>
      {data.length === 0 ? (
        <p className="mt-6 pb-4 text-center text-xs text-zinc-400">
          {t.dashboard.charts.noData}
        </p>
      ) : (
        <div
          className="mt-3 h-44"
          role="img"
          aria-label={`${t.dashboard.charts.daily} · ${t.dashboard.expense}${
            maxDay.expense > 0
              ? ` — ${maxDay.date}: ${formatCurrency(maxDay.expense, locale)}`
              : ""
          }`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#f4f4f5" />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "#a1a1aa" }}
                minTickGap={16}
              />
              <YAxis hide domain={[0, "auto"]} />
              <Tooltip
                cursor={{ fill: "#fafafa" }}
                formatter={(value) => formatCurrency(Number(value), locale)}
                labelFormatter={(label) => `${t.dashboard.form.date}: ${String(label)}`}
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid #e4e4e7",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="expense" fill="#fb7185" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
