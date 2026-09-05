"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useOptimistic, useState } from "react";
import { LanguageToggle } from "@/components/i18n/language-toggle";
import { useI18n } from "@/lib/i18n/provider";
import { formatAmountSigned, formatCurrency, formatDate } from "@/lib/format";
import type {
  Category,
  DashboardData,
  TransactionRow,
} from "@/lib/transactions";
import {
  AddTransactionForm,
  type EditableTransaction,
} from "@/components/dashboard/add-transaction-form";
import { CategoryDonut } from "@/components/dashboard/category-donut";
import { DailyChart } from "@/components/dashboard/daily-chart";
import { ConnectLine } from "@/components/dashboard/connect-line";

type Period = "today" | "week" | "month" | "custom";

// Optimistic list actions: add prepends, edit patches, delete removes —
// the server refresh reconciles afterwards.
type RecentAction =
  | { kind: "add"; row: TransactionRow }
  | { kind: "edit"; id: string; patch: Partial<TransactionRow> }
  | { kind: "delete"; id: string };

function recentReducer(rows: TransactionRow[], action: RecentAction) {
  switch (action.kind) {
    case "add":
      return [action.row, ...rows];
    case "edit":
      return rows.map((row) =>
        row.id === action.id ? { ...row, ...action.patch } : row,
      );
    case "delete":
      return rows.filter((row) => row.id !== action.id);
  }
}

export function DashboardView({
  data,
  categories,
  period,
  range,
  displayName,
  lineConnected,
}: {
  data: DashboardData;
  categories: Category[];
  period: Period;
  range: { from: string; to: string };
  displayName: string;
  lineConnected: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TransactionRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [recentRows, applyRecent] = useOptimistic(
    data.recent,
    recentReducer,
  );

  const categoryLabel = (c: { name_th: string; name_en: string }) =>
    locale === "th" ? c.name_th : c.name_en;

  const startEditing = (row: TransactionRow) => {
    setFormOpen(false);
    setEditing(row);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = (id: string) => {
    setActionError(null);
    startTransition(async () => {
      applyRecent({ kind: "delete", id });
      try {
        const response = await fetch(`/api/transactions/${id}`, {
          method: "DELETE",
        });
        if (!response.ok) throw new Error(String(response.status));
        router.refresh();
      } catch {
        setActionError(t.errors.actionFailed);
        router.refresh();
      }
    });
  };

  const cards = [
    { label: t.dashboard.income, value: data.totals.income, tone: "text-emerald-600" },
    { label: t.dashboard.expense, value: data.totals.expense, tone: "text-rose-600" },
    { label: t.dashboard.net, value: data.totals.net, tone: data.totals.net >= 0 ? "text-zinc-900" : "text-rose-600" },
  ];

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
              href="/history"
              prefetch
              className="text-xs text-zinc-500 hover:text-zinc-900"
            >
              {t.history.title}
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

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {t.dashboard.greeting}
              {displayName ? ` ${displayName}` : ""} 👋
            </h1>
            <p className="mt-0.5 text-xs text-zinc-500">
              {formatDate(range.from, locale)} – {formatDate(range.to, locale)}
            </p>
          </div>
          <ConnectLine connected={lineConnected} />
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setFormOpen((open) => !open);
            }}
            className="rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-zinc-700"
          >
            {formOpen ? t.dashboard.form.cancel : `+ ${t.dashboard.addTransaction}`}
          </button>
        </div>

        {formOpen && (
          <AddTransactionForm
            categories={categories}
            onSaved={(saved) => {
              setFormOpen(false);
              const category = categories.find((c) => c.slug === saved.category);
              startTransition(() => {
                applyRecent({
                  kind: "add",
                  row: {
                    id: `temp-${saved.date}-${saved.amount}-${saved.category}`,
                    type: saved.type,
                    amount: saved.amount,
                    description: saved.description,
                    transaction_date: saved.date,
                    category: category
                      ? {
                          slug: category.slug,
                          name_th: category.name_th,
                          name_en: category.name_en,
                          icon: category.icon,
                        }
                      : null,
                  },
                });
                router.refresh();
              });
            }}
          />
        )}

        {editing && (
          <AddTransactionForm
            key={editing.id}
            categories={categories}
            initial={toEditable(editing)}
            onSaved={(saved) => {
              const edited = editing;
              setEditing(null);
              startTransition(() => {
                applyRecent({
                  kind: "edit",
                  id: edited.id,
                  patch: {
                    type: saved.type,
                    amount: saved.amount,
                    description: saved.description,
                    transaction_date: saved.date,
                  },
                });
                router.refresh();
              });
            }}
            onCancel={() => setEditing(null)}
          />
        )}

        <section className="grid grid-cols-3 gap-3">
          {cards.map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-zinc-200 bg-white p-4"
            >
              <p className="text-xs text-zinc-500">{card.label}</p>
              <p className={`mt-1 font-semibold tabular-nums ${card.tone}`}>
                {formatCurrency(card.value, locale)}
              </p>
            </div>
          ))}
        </section>

        <section className="flex flex-wrap items-center gap-2">
          {(
            [
              ["today", t.dashboard.period.today],
              ["week", t.dashboard.period.thisWeek],
              ["month", t.dashboard.period.thisMonth],
              ["custom", t.dashboard.period.custom],
            ] as const
          ).map(([value, label]) => {
            const href =
              value === "custom"
                ? "/dashboard?period=custom"
                : `/dashboard?period=${value}`;

            return (
              <Link
                key={value}
                href={href}
                prefetch={true}
                scroll={false}
                aria-current={period === value ? "page" : undefined}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  period === value
                    ? "bg-zinc-900 text-white"
                    : "border border-zinc-200 bg-white text-zinc-600 hover:text-zinc-900"
                }`}
              >
                {label}
              </Link>
            );
          })}
          {period === "custom" && <CustomRange from={range.from} to={range.to} />}
        </section>

        <CategoryDonut items={data.byCategory} total={data.totals.expense} />

        <DailyChart data={data.dailyTotals} />

        {actionError && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {actionError}
          </p>
        )}

        <RecentCard
          title={t.dashboard.recentTransactions}
          empty={t.dashboard.empty}
          rows={recentRows}
          categoryLabel={categoryLabel}
          onEdit={startEditing}
          onDelete={handleDelete}
        />
      </main>
    </div>
  );
}

function toEditable(row: TransactionRow): EditableTransaction {
  return {
    id: row.id,
    type: row.type === "income" ? "income" : "expense",
    amount: Number(row.amount),
    category: row.category?.slug ?? "",
    description: row.description,
    date: row.transaction_date,
  };
}

function CustomRange({ from, to }: { from: string; to: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [fromValue, setFromValue] = useState(from);
  const [toValue, setToValue] = useState(to);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    router.push(`/dashboard?period=custom&from=${fromValue}&to=${toValue}`);
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-2 text-xs">
      <label className="flex items-center gap-1 text-zinc-500">
        {t.dashboard.period.from}
        <input
          type="date"
          value={fromValue}
          onChange={(e) => setFromValue(e.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1"
        />
      </label>
      <label className="flex items-center gap-1 text-zinc-500">
        {t.dashboard.period.to}
        <input
          type="date"
          value={toValue}
          onChange={(e) => setToValue(e.target.value)}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1"
        />
      </label>
      <button
        type="submit"
        className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 font-medium hover:bg-zinc-50"
      >
        {t.dashboard.period.apply}
      </button>
    </form>
  );
}

function RecentCard({
  title,
  empty,
  rows,
  categoryLabel,
  onEdit,
  onDelete,
}: {
  title: string;
  empty: string;
  rows: TransactionRow[];
  categoryLabel: (c: { name_th: string; name_en: string }) => string;
  onEdit: (row: TransactionRow) => void;
  onDelete: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      <ul className="mt-3 flex flex-col divide-y divide-zinc-100">
        {rows.length === 0 && (
          <li className="py-2 text-xs text-zinc-400">{empty}</li>
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
            <span className="hidden text-zinc-400 sm:inline">
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
                  aria-label={t.dashboard.recent.confirmDelete}
                  onClick={() => {
                    setConfirmId(null);
                    onDelete(row.id);
                  }}
                  className="rounded-md bg-rose-600 px-2 py-1 font-medium text-white hover:bg-rose-500"
                >
                  {t.dashboard.recent.confirmDelete}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmId(null)}
                  className="rounded-md border border-zinc-200 px-2 py-1 text-zinc-500 hover:text-zinc-900"
                >
                  {t.dashboard.recent.cancelDelete}
                </button>
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={t.dashboard.recent.edit}
                  onClick={() => onEdit(row)}
                  className="rounded-md min-h-9 min-w-9 px-2 py-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                >
                  ✎
                </button>
                <button
                  type="button"
                  aria-label={t.dashboard.recent.delete}
                  onClick={() => setConfirmId(row.id)}
                  className="rounded-md min-h-9 min-w-9 px-2 py-1.5 text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                >
                  🗑
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
