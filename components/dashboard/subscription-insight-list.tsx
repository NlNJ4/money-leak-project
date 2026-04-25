import { formatBaht } from "@/lib/format";
import type { RecurringExpenseInsight } from "@/lib/types";

function formatDateKey(dateKey: string | null) {
  if (!dateKey) return "ยังไม่ทราบรอบถัดไป";

  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${dateKey}T00:00:00.000Z`));
}

export function SubscriptionInsightList({
  insights,
}: {
  insights: RecurringExpenseInsight[];
}) {
  if (insights.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
        ยังไม่พบรายจ่ายซ้ำที่ชัดเจนใน 90 วันล่าสุด
      </p>
    );
  }

  return (
    <ol className="divide-y divide-zinc-100">
      {insights.map((insight) => (
        <li key={insight.key} className="py-4 first:pt-0 last:pb-0">
          <div className="flex flex-col gap-2 min-[420px]:flex-row min-[420px]:items-start min-[420px]:justify-between min-[420px]:gap-4">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-zinc-950">
                {insight.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                {insight.message}
              </p>
            </div>
            <p className="shrink-0 text-sm font-semibold leading-6 text-zinc-950 min-[420px]:text-right">
              {formatBaht(insight.averageAmountBaht)}
            </p>
          </div>
          <div className="mt-3 grid gap-2 rounded-md bg-zinc-50 p-3 text-sm text-zinc-600 min-[420px]:grid-cols-2">
            <span>รอบถัดไป: {formatDateKey(insight.nextExpectedDateKey)}</span>
            <span>ความมั่นใจ: {insight.confidence}%</span>
          </div>
          <p className="mt-3 border-l-2 border-zinc-200 pl-3 text-sm leading-6 text-zinc-700">
            {insight.suggestion}
          </p>
        </li>
      ))}
    </ol>
  );
}
