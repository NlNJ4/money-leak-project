"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { todayISO } from "@/lib/date";
import type { Category } from "@/lib/transactions";

// Pre-filled values when the form edits an existing transaction; omit for
// the plain create flow.
export type EditableTransaction = {
  id: string;
  type: "expense" | "income";
  amount: number;
  category: string;
  description: string;
  date: string;
};

export function AddTransactionForm({
  categories,
  onSaved,
  initial,
  onCancel,
}: {
  categories: Category[];
  onSaved?: (saved: EditableTransaction) => void;
  initial?: EditableTransaction;
  onCancel?: () => void;
}) {
  const { t, locale } = useI18n();
  const [type, setType] = useState<"expense" | "income">(
    initial?.type ?? "expense",
  );
  const [amount, setAmount] = useState(
    initial ? String(initial.amount) : "",
  );
  const [category, setCategory] = useState(initial?.category ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = categories.filter((c) => c.type === type);

  const switchType = (next: "expense" | "income") => {
    setType(next);
    setCategory("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!category || !amount) {
      setError(t.dashboard.errors.generic);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(
        initial ? `/api/transactions/${initial.id}` : "/api/transactions",
        {
          method: initial ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            amount: Number(amount),
            category,
            description,
            date,
          }),
        },
      );

      if (!response.ok) {
        setError(t.dashboard.errors.generic);
        return;
      }

      if (!initial) {
        setAmount("");
        setDescription("");
      }
      onSaved?.({
        id: initial?.id ?? "",
        type,
        amount: Number(amount),
        category,
        description,
        date,
      });
    } catch {
      setError(t.dashboard.errors.generic);
    } finally {
      setSaving(false);
    }
  };

  const label = locale === "th" ? "name_th" : "name_en";

  const inputClass =
    "w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm focus:border-zinc-400 focus:outline-none";

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">
          {initial ? t.dashboard.form.editTitle : t.dashboard.form.title}
        </h2>
        {initial && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-zinc-500 hover:text-zinc-900"
          >
            {t.dashboard.form.cancel}
          </button>
        )}
      </div>

      <div className="flex gap-2">
        {(
          [
            ["expense", t.dashboard.form.typeExpense],
            ["income", t.dashboard.form.typeIncome],
          ] as const
        ).map(([value, text]) => (
          <button
            key={value}
            type="button"
            onClick={() => switchType(value)}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
              type === value
                ? value === "expense"
                  ? "bg-rose-500 text-white"
                  : "bg-emerald-500 text-white"
                : "border border-zinc-200 text-zinc-600 hover:text-zinc-900"
            }`}
          >
            {text}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          {t.dashboard.form.amount}
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          {t.dashboard.form.category}
          <select
            required
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClass}
          >
            <option value="" disabled>
              —
            </option>
            {options.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.icon} {c[label]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          {t.dashboard.form.description}
          <input
            type="text"
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          {t.dashboard.form.date}
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="self-start rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60"
      >
        {saving ? t.dashboard.form.saving : t.dashboard.form.save}
      </button>
    </form>
  );
}
