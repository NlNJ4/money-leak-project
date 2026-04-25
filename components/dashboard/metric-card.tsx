import type { ReactNode } from "react";

type MetricTone = "neutral" | "good" | "warning" | "danger" | "info";

const toneClassName: Record<MetricTone, string> = {
  neutral: "border-zinc-200 bg-white",
  good: "border-emerald-200 bg-emerald-50/60",
  warning: "border-amber-200 bg-amber-50/70",
  danger: "border-rose-200 bg-rose-50/70",
  info: "border-sky-200 bg-sky-50/70",
};

export function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
  action,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: MetricTone;
  action?: ReactNode;
}) {
  return (
    <article
      className={`min-h-32 rounded-lg border p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)] sm:min-h-36 sm:p-5 ${toneClassName[tone]}`}
    >
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium text-zinc-500">{label}</p>
        {action}
      </div>
      <p className="mt-3 text-2xl font-semibold leading-tight tracking-normal text-zinc-950 [overflow-wrap:anywhere] sm:mt-4 sm:text-3xl">
        {value}
      </p>
      <p className="mt-3 text-sm leading-6 text-zinc-600">{detail}</p>
    </article>
  );
}
