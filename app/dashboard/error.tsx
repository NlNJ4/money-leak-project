"use client";

import { useI18n } from "@/lib/i18n/provider";

export default function DashboardError({
  reset,
}: {
  reset: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm text-zinc-600">{t.errors.generic}</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700"
      >
        {t.errors.retry}
      </button>
    </div>
  );
}
