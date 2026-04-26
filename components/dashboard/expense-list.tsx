"use client";

import {
  categoryConfig,
  categoryOrder,
  getCategoryLabel,
} from "@/lib/categories";
import { formatBaht } from "@/lib/format";
import type { Expense, ExpenseCategory } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type ExpenseFormState = {
  title: string;
  amountBaht: string;
  category: ExpenseCategory;
  isNeed: boolean;
};

function formatExpenseDate(isoDate: string) {
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(isoDate));
}

function toExpenseFormState(expense: Expense): ExpenseFormState {
  return {
    title: expense.title,
    amountBaht: String(expense.amountBaht),
    category: expense.category,
    isNeed: expense.isNeed,
  };
}

export function ExpenseList({
  expenses,
  lineUserId,
  accessToken,
  emptyMessage,
}: {
  expenses: Expense[];
  lineUserId: string;
  accessToken?: string | null;
  emptyMessage?: string;
}) {
  const router = useRouter();
  const [updatedExpenses, setUpdatedExpenses] = useState<Record<string, Expense>>(
    {},
  );
  const [deletedExpenseIds, setDeletedExpenseIds] = useState<
    Record<string, true>
  >({});
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [formState, setFormState] = useState<ExpenseFormState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mutatingExpenseId, setMutatingExpenseId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const visibleExpenses = expenses
    .map((expense) => updatedExpenses[expense.id] ?? expense)
    .filter((expense) => !deletedExpenseIds[expense.id]);
  const emptyState = (
    <p className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
      {emptyMessage ? (
        emptyMessage
      ) : (
        <>
      ยังไม่มีรายการล่าสุด
        </>
      )}
    </p>
  );

  if (expenses.length === 0) {
    return emptyState;
  }

  function requestHeaders() {
    return {
      "Content-Type": "application/json",
      ...(accessToken ? { "x-money-leak-access-token": accessToken } : {}),
    };
  }

  function startEditing(expense: Expense) {
    setMessage(null);
    setEditingExpenseId(expense.id);
    setFormState(toExpenseFormState(expense));
  }

  async function handleUpdate(expenseId: string) {
    if (!formState) return;

    setMessage(null);
    setMutatingExpenseId(expenseId);

    const response = await fetch("/api/expenses", {
      method: "PATCH",
      headers: requestHeaders(),
      body: JSON.stringify({
        id: expenseId,
        lineUserId,
        title: formState.title,
        amountBaht: Number(formState.amountBaht),
        category: formState.category,
        isNeed: formState.isNeed,
      }),
    });

    setMutatingExpenseId(null);

    if (!response.ok) {
      setMessage("ยังแก้ไขรายการไม่ได้");
      return;
    }

    const payload = (await response.json()) as { expense: Expense };
    setUpdatedExpenses((currentExpenses) => ({
      ...currentExpenses,
      [payload.expense.id]: payload.expense,
    }));
    setEditingExpenseId(null);
    setFormState(null);
    setMessage("แก้ไขรายการแล้ว");
    startTransition(() => router.refresh());
  }

  async function handleDelete(expense: Expense) {
    if (!window.confirm(`ลบรายการ ${expense.title}?`)) return;

    setMessage(null);
    setMutatingExpenseId(expense.id);

    const response = await fetch("/api/expenses", {
      method: "DELETE",
      headers: requestHeaders(),
      body: JSON.stringify({
        id: expense.id,
        lineUserId,
      }),
    });

    setMutatingExpenseId(null);

    if (!response.ok) {
      setMessage("ยังลบรายการไม่ได้");
      return;
    }

    setDeletedExpenseIds((currentExpenseIds) => ({
      ...currentExpenseIds,
      [expense.id]: true,
    }));
    setMessage("ลบรายการแล้ว");
    startTransition(() => router.refresh());
  }

  return (
    <div>
      {message ? (
        <p className="mb-3 rounded-md bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-600">
          {message}
        </p>
      ) : null}
      {visibleExpenses.length === 0 ? (
        emptyState
      ) : (
        <div className="divide-y divide-zinc-100">
          {visibleExpenses.map((expense) => (
            <div key={expense.id} className="py-3 first:pt-0 last:pb-0">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 sm:gap-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium leading-6 text-zinc-950">
                    {expense.title}
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-zinc-500">
                    {getCategoryLabel(expense.category)} ·{" "}
                    {formatExpenseDate(expense.spentAt)}
                  </p>
                </div>
                <p className="text-right text-sm font-semibold leading-6 text-zinc-950">
                  {formatBaht(expense.amountBaht)}
                </p>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="min-h-8 rounded-md border border-zinc-200 px-3 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-300"
                  disabled={mutatingExpenseId === expense.id || isPending}
                  onClick={() => startEditing(expense)}
                  type="button"
                >
                  แก้ไข
                </button>
                <button
                  className="min-h-8 rounded-md border border-rose-200 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-rose-300"
                  disabled={mutatingExpenseId === expense.id || isPending}
                  onClick={() => handleDelete(expense)}
                  type="button"
                >
                  ลบ
                </button>
              </div>

              {editingExpenseId === expense.id && formState ? (
                <form
                  className="mt-3 grid gap-3 rounded-md border border-zinc-100 bg-zinc-50 p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleUpdate(expense.id);
                  }}
                >
                  <label className="grid gap-1 text-xs font-medium text-zinc-600">
                    รายการ
                    <input
                      className="min-h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                      onChange={(event) =>
                        setFormState({
                          ...formState,
                          title: event.target.value,
                        })
                      }
                      required
                      value={formState.title}
                    />
                  </label>
                  <div className="grid gap-3 min-[520px]:grid-cols-2">
                    <label className="grid gap-1 text-xs font-medium text-zinc-600">
                      จำนวนเงิน
                      <input
                        className="min-h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                        inputMode="numeric"
                        min={1}
                        onChange={(event) =>
                          setFormState({
                            ...formState,
                            amountBaht: event.target.value,
                          })
                        }
                        required
                        step={1}
                        type="number"
                        value={formState.amountBaht}
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-medium text-zinc-600">
                      หมวด
                      <select
                        className="min-h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                        onChange={(event) =>
                          setFormState({
                            ...formState,
                            category: event.target.value as ExpenseCategory,
                          })
                        }
                        value={formState.category}
                      >
                        {categoryOrder.map((category) => (
                          <option key={category} value={category}>
                            {categoryConfig[category].label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-medium text-zinc-600">
                    <input
                      checked={formState.isNeed}
                      className="h-4 w-4 rounded border-zinc-300 text-emerald-600"
                      onChange={(event) =>
                        setFormState({
                          ...formState,
                          isNeed: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    จำเป็น
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="min-h-9 rounded-md bg-zinc-950 px-4 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                      disabled={mutatingExpenseId === expense.id || isPending}
                      type="submit"
                    >
                      บันทึก
                    </button>
                    <button
                      className="min-h-9 rounded-md border border-zinc-200 px-4 text-xs font-semibold text-zinc-700 transition hover:bg-white"
                      onClick={() => {
                        setEditingExpenseId(null);
                        setFormState(null);
                      }}
                      type="button"
                    >
                      ยกเลิก
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
