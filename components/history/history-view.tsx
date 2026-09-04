"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LanguageToggle } from "@/components/i18n/language-toggle";
import { useI18n } from "@/lib/i18n/provider";
import { formatAmountSigned, formatDate } from "@/lib/format";
import { AddTransactionForm } from "@/components/dashboard/add-transaction-form";
import type {
  Category,
  HistoryCursor,
  HistoryRow,
} from "@/lib/transactions";

type Filters = {
  from: string;
  to: string;
  type?: "income" | "expense";
  category?: string;
  source?: string;
  q?: string;
};

export function HistoryView({
  rows,
  nextCursor,
  categories,
  filters,
  displayName,
}: {
  rows: HistoryRow[];
  nextCursor: HistoryCursor | null;
  categories: Category[];
  filters: Filters;
  displayName: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState<HistoryRow | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const [type, setType] = useState(filters.type ?? "");
  const [category, setCategory] = useState(filters.category ?? "");
  const [source, setSource] = useState(filters.source ?? "");
  const [q, setQ] = useState(filters.q ?? "");

  const categoryLabel = (c: { name_th: string; name_en: string }) =>
    locale === "th" ? c.name_th : c.name_en;

  const buildQuery = (extra?: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { from, to, type, category, source, q, ...extra };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    return params.toString();
  };

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    router.push(`/history?${buildQuery()}`);
  };

  const loadMore = () => {
    if (!nextCursor) return;
    router.push(
      `/history?${buildQuery({ cursor: `${nextCursor.createdAt}|${nextCursor.id}` })}`,
    );
  };

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/transactions/${id}`, {
        method: "DELETE",
      });
      if (response.ok) {
        router.refresh();
      }
    } catch {
      // Leave the row; the user can retry.
    }
  };

  const exportHref = `/api/transactions/export?${buildQuery()}`;
  const selectClass =
    "rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs";

  return (
    <div className="min-h-screen w-full bg-zinc-50 font-sans">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <span>💰</span>
            <span className="text-sm">{t.appName}</span>
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
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="text-xs text-zinc-500 hover:text-zinc-900"
              >
                {t.nav.signOut}
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            {t.history.title}
            {displayName ? (
              <span className="text-sm font-normal text-zinc-400">
                {" "}
                · {displayName}
              </span>
            ) : null}
          </h1>
          <a
            href={exportHref}
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50"
          >
            ⬇ {t.history.export}
          </a>
        </div>

        <form
          onSubmit={applyFilters}
          className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              {t.dashboard.period.from}
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className={selectClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              {t.dashboard.period.to}
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={selectClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              {t.history.type}
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className={selectClass}
              >
                <option value="">{t.history.all}</option>
                <option value="expense">{t.dashboard.form.typeExpense}</option>
                <option value="income">{t.dashboard.form.typeIncome}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              {t.dashboard.form.category}
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={selectClass}
              >
                <option value="">{t.history.all}</option>
                {categories.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.icon} {categoryLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500">
              {t.history.source}
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className={selectClass}
              >
                <option value="">{t.history.all}</option>
                <option value="web">{t.history.sourceWeb}</option>
                <option value="line">{t.history.sourceLine}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-zinc-500 sm:col-span-2 lg:col-span-3">
              {t.history.search}
              <input
                type="search"
                maxLength={100}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t.history.searchPlaceholder}
                className={selectClass}
              />
            </label>
          </div>
          <button
            type="submit"
            className="self-start rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700"
          >
            {t.dashboard.period.apply}
          </button>
        </form>

        {editing && (
          <AddTransactionForm
            key={editing.id}
            categories={categories}
            initial={{
              id: editing.id,
              type: editing.type === "income" ? "income" : "expense",
              amount: Number(editing.amount),
              category: editing.category?.slug ?? "",
              description: editing.description,
              date: editing.transaction_date,
            }}
            onSaved={() => {
              setEditing(null);
              router.refresh();
            }}
            onCancel={() => setEditing(null)}
          />
        )}

        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <ul className="flex flex-col divide-y divide-zinc-100">
            {rows.length === 0 && (
              <li className="py-2 text-xs text-zinc-400">{t.dashboard.empty}</li>
            )}
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-2 py-2 text-xs"
              >
                <span>{row.category?.icon ?? "📦"}</span>
                <span className="min-w-0 flex-1 truncate">
                  {row.category ? categoryLabel(row.category) : "—"}
                  {row.description ? (
                    <span className="text-zinc-400"> · {row.description}</span>
                  ) : null}
                </span>
                <span className="hidden text-zinc-400 md:inline">
                  {formatDate(row.transaction_date, locale)}
                </span>
                <span
                  className={`w-20 text-right font-medium tabular-nums ${
                    row.type === "income" ? "text-emerald-600" : "text-zinc-700"
                  }`}
                >
                  {formatAmountSigned(row.type, Number(row.amount))}
                </span>
                {confirmId === row.id ? (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmId(null);
                        handleDelete(row.id);
                      }}
                      className="rounded-md bg-rose-600 px-2 py-1 font-medium text-white hover:bg-rose-500"
                    >
                      {t.dashboard.recent.confirmDelete}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="rounded-md border border-zinc-200 px-2 py-1 text-zinc-500"
                    >
                      {t.dashboard.recent.cancelDelete}
                    </button>
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={t.dashboard.recent.edit}
                      onClick={() => {
                        window.scrollTo({ top: 0, behavior: "smooth" });
                        setEditing(row);
                      }}
                      className="rounded-md px-1.5 py-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      aria-label={t.dashboard.recent.delete}
                      onClick={() => setConfirmId(row.id)}
                      className="rounded-md px-1.5 py-1 text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                    >
                      🗑
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-3 flex justify-center">
            {nextCursor ? (
              <button
                type="button"
                onClick={loadMore}
                className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-600 shadow-sm transition-colors hover:text-zinc-900"
              >
                {t.history.loadMore}
              </button>
            ) : (
              rows.length > 0 && (
                <span className="text-xs text-zinc-400">{t.history.noMore}</span>
              )
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
