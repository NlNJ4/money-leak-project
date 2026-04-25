import { formatBaht } from "@/lib/format";
import type { LeakInsight, LeakSeverity } from "@/lib/types";

const severityClassName: Record<LeakSeverity, string> = {
  low: "bg-emerald-500",
  medium: "bg-amber-500",
  high: "bg-rose-500",
};

export function LeakInsightList({
  insights,
}: {
  insights: LeakInsight[];
}) {
  if (insights.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
        เดือนนี้ยังไม่พบหมวดที่รั่วชัดเจน
      </p>
    );
  }

  return (
    <ol className="divide-y divide-zinc-100">
      {insights.map((insight, index) => (
        <li key={insight.category} className="py-4 first:pt-0 last:pb-0">
          <div className="flex flex-col gap-2 min-[420px]:flex-row min-[420px]:items-start min-[420px]:justify-between min-[420px]:gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-zinc-500">
                  {index + 1}
                </span>
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${severityClassName[insight.severity]}`}
                />
                <h3 className="truncate text-sm font-semibold text-zinc-950">
                  {insight.label}
                </h3>
              </div>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                {insight.message}
              </p>
            </div>
            <p className="shrink-0 text-sm font-semibold leading-6 text-zinc-950 min-[420px]:text-right">
              {formatBaht(insight.totalBaht)}
            </p>
          </div>
          <p className="mt-3 border-l-2 border-zinc-200 pl-3 text-sm leading-6 text-zinc-700">
            {insight.suggestion}
          </p>
        </li>
      ))}
    </ol>
  );
}
