import { formatBaht, formatPercent } from "@/lib/format";
import type { CategoryTotal } from "@/lib/types";

export function CategoryBarList({
  categories,
}: {
  categories: CategoryTotal[];
}) {
  if (categories.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
        ยังไม่มีรายการในเดือนนี้
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {categories.map((category) => (
        <div key={category.category} className="min-w-0">
          <div className="mb-2 flex flex-col gap-1 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between min-[420px]:gap-4">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: category.color }}
              />
              <span className="truncate text-sm font-medium text-zinc-800">
                {category.label}
              </span>
            </div>
            <span className="shrink-0 text-sm font-medium text-zinc-600 min-[420px]:text-right">
              {formatBaht(category.totalBaht)}
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-zinc-100">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(Math.max(category.percentage, 2), 100)}%`,
                backgroundColor: category.color,
              }}
            />
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {category.count} ครั้ง · {formatPercent(category.percentage)}
          </p>
        </div>
      ))}
    </div>
  );
}
