import type { ReactNode } from "react";

type StatusTone = "neutral" | "good" | "warning" | "danger" | "info";

const toneClassName: Record<StatusTone, string> = {
  neutral: "border-zinc-200 bg-zinc-50 text-zinc-700",
  good: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  info: "border-sky-200 bg-sky-50 text-sky-700",
};

export function StatusPill({
  tone = "neutral",
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex min-h-7 w-full items-center justify-center rounded-md border px-2.5 text-center text-sm font-medium min-[520px]:w-auto ${toneClassName[tone]}`}
    >
      {children}
    </span>
  );
}
