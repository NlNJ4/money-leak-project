"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { LanguageToggle } from "@/components/i18n/language-toggle";
import { useI18n } from "@/lib/i18n/provider";
import type { DeadJob, QueueHealth } from "@/lib/observability";

const STATUS_ORDER = ["pending", "retry", "processing", "completed", "dead"] as const;

export function OpsView({
  health,
  ai,
  circuitOpen,
  dead,
  retryDeadAction,
}: {
  health: QueueHealth;
  ai: {
    usage: { day: string; requests: number }[];
    circuitOpenUntil: string | null;
  };
  circuitOpen: boolean;
  dead: DeadJob[];
  retryDeadAction: () => Promise<number>;
}) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [retryCount, setRetryCount] = useState<number | null>(null);

  const retryDead = () => {
    startTransition(async () => {
      try {
        const count = await retryDeadAction();
        setRetryCount(count);
      } catch {
        setRetryCount(-1);
      }
    });
  };

  const heartbeatStale =
    health.heartbeatAgeSeconds === null || health.heartbeatAgeSeconds > 180;

  const totalAi7d = ai.usage.reduce((sum, row) => sum + row.requests, 0);

  return (
    <div className="min-h-screen w-full bg-zinc-50 font-sans">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <span>🛠</span>
            <span className="text-sm">{t.ops.title}</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              prefetch
              className="text-xs text-zinc-500 hover:text-zinc-900"
            >
              ← {t.dashboard.title}
            </Link>
            <LanguageToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 text-xs">
        <section className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <p className="text-zinc-500">{t.ops.lastWorkerRun}</p>
            <p
              className={`mt-1 font-semibold ${
                heartbeatStale ? "text-rose-600" : "text-emerald-600"
              }`}
            >
              {health.heartbeatAgeSeconds === null
                ? t.ops.never
                : t.ops.secondsAgo.replace(
                    "{n}",
                    String(health.heartbeatAgeSeconds),
                  )}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <p className="text-zinc-500">{t.ops.oldestPending}</p>
            <p className="mt-1 font-semibold tabular-nums">
              {health.oldestPendingSeconds === null
                ? "—"
                : t.ops.secondsAgo.replace(
                    "{n}",
                    String(health.oldestPendingSeconds),
                  )}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4">
            <p className="text-zinc-500">{t.ops.ai7d}</p>
            <p className="mt-1 font-semibold tabular-nums">
              {totalAi7d}
              {circuitOpen && (
                <span className="ml-1 text-xs font-normal text-amber-600">
                  {t.ops.circuitOpen}
                </span>
              )}
            </p>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-medium">{t.ops.queue}</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {STATUS_ORDER.map((status) => (
              <li
                key={status}
                className={`rounded-full px-3 py-1 font-medium ${
                  status === "dead" && (health.depth["dead"] ?? 0) > 0
                    ? "bg-rose-100 text-rose-700"
                    : "border border-zinc-200 text-zinc-600"
                }`}
              >
                {status}: {health.depth[status] ?? 0}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">{t.ops.deadLetters}</h2>
            {dead.length > 0 && (
              <button
                type="button"
                onClick={retryDead}
                disabled={pending}
                className="min-h-9 rounded-lg bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
              >
                {pending ? "..." : t.ops.retryAll}
              </button>
            )}
          </div>
          {retryCount !== null && (
            <p className="mt-2 text-emerald-600">
              {t.ops.retried.replace("{n}", String(retryCount))}
            </p>
          )}
          <ul className="mt-3 flex flex-col divide-y divide-zinc-100">
            {dead.length === 0 && (
              <li className="py-2 text-zinc-400">{t.ops.noDead}</li>
            )}
            {dead.map((job) => (
              <li key={job.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate font-mono">
                  {job.id}
                </span>
                <span className="text-zinc-400">×{job.attempts}</span>
                <span className="min-w-0 flex-1 truncate text-rose-600">
                  {job.lastError ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-medium">{t.ops.aiDaily}</h2>
          <ul className="mt-3 flex flex-col divide-y divide-zinc-100">
            {ai.usage.length === 0 && (
              <li className="py-2 text-zinc-400">{t.ops.noAiUsage}</li>
            )}
            {ai.usage.map((row) => (
              <li key={row.day} className="flex justify-between py-2">
                <span>{row.day}</span>
                <span className="tabular-nums">{row.requests}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
