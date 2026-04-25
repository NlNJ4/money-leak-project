import { formatBaht, formatCompactBaht } from "@/lib/format";
import type { DailySpending } from "@/lib/types";

export function DailyTrend({ days }: { days: DailySpending[] }) {
  const maxTotalBaht = Math.max(...days.map((day) => day.totalBaht), 1);

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex h-48 min-w-80 items-end gap-2 sm:gap-3">
        {days.map((day) => {
          const height =
            day.totalBaht > 0
              ? Math.max((day.totalBaht / maxTotalBaht) * 100, 8)
              : 2;

          return (
            <div
              key={day.dateKey}
              className="flex min-w-0 flex-1 flex-col items-center"
            >
              <div className="flex h-36 w-full items-end rounded-md bg-zinc-50 px-1">
                <div
                  className="w-full rounded-t-md bg-sky-500"
                  style={{ height: `${height}%` }}
                  title={`${day.label}: ${formatBaht(day.totalBaht)}`}
                />
              </div>
              <p className="mt-3 w-full truncate text-center text-xs text-zinc-500">
                {day.label}
              </p>
              <p className="mt-1 text-center text-xs font-medium text-zinc-800">
                {formatCompactBaht(day.totalBaht)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
