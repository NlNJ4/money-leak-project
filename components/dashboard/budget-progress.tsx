import { formatBaht, formatPercent } from "@/lib/format";

function getProgressTone(usedBaht: number, budgetBaht: number) {
  const ratio = budgetBaht > 0 ? usedBaht / budgetBaht : 0;

  if (ratio >= 1) return "bg-rose-500";
  if (ratio >= 0.8) return "bg-amber-500";

  return "bg-emerald-500";
}

export function BudgetProgress({
  label,
  usedBaht,
  budgetBaht,
}: {
  label: string;
  usedBaht: number;
  budgetBaht: number;
}) {
  const ratio = budgetBaht > 0 ? usedBaht / budgetBaht : 0;
  const progress = Math.min(ratio * 100, 100);
  const remainingBaht = budgetBaht - usedBaht;

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-zinc-700">{label}</p>
        <p className="text-sm text-zinc-500">
          {formatPercent(Math.round(progress))}
        </p>
      </div>
      <div
        className="mt-3 h-3 overflow-hidden rounded-full bg-zinc-100"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={budgetBaht}
        aria-valuenow={Math.min(usedBaht, budgetBaht)}
      >
        <div
          className={`h-full rounded-full ${getProgressTone(usedBaht, budgetBaht)}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-4 text-sm">
        <span className="font-medium text-zinc-950">
          {formatBaht(usedBaht)} / {formatBaht(budgetBaht)}
        </span>
        <span
          className={remainingBaht >= 0 ? "text-emerald-700" : "text-rose-700"}
        >
          {remainingBaht >= 0
            ? `เหลือ ${formatBaht(remainingBaht)}`
            : `เกิน ${formatBaht(Math.abs(remainingBaht))}`}
        </span>
      </div>
    </div>
  );
}
