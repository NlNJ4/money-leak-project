import type { ReactNode } from "react";

type MetricTone = "neutral" | "good" | "warning" | "danger" | "info";

const toneClassName: Record<MetricTone, string> = {
  neutral: "border-zinc-200",
  good: "border-emerald-300",
  warning: "border-amber-300",
  danger: "border-rose-300",
  info: "border-sky-300",
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
      className={`min-h-36 rounded-md border bg-white p-5 shadow-sm ${toneClassName[tone]}`}
    >
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium text-zinc-500">{label}</p>
        {action}
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-normal text-zinc-950">
        {value}
      </p>
      <p className="mt-3 text-sm leading-6 text-zinc-600">{detail}</p>
    </article>
  );
}
