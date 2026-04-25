"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

export function BudgetSettings({
  lineUserId,
  accessToken,
  dailyBudgetBaht,
  monthlyBudgetBaht,
}: {
  lineUserId: string;
  accessToken?: string | null;
  dailyBudgetBaht: number;
  monthlyBudgetBaht: number;
}) {
  const router = useRouter();
  const [dailyBudget, setDailyBudget] = useState(String(dailyBudgetBaht));
  const [monthlyBudget, setMonthlyBudget] = useState(String(monthlyBudgetBaht));
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const response = await fetch("/api/budget", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { "x-money-leak-access-token": accessToken } : {}),
      },
      body: JSON.stringify({
        lineUserId,
        dailyBudgetBaht: Number(dailyBudget),
        monthlyBudgetBaht: Number(monthlyBudget),
      }),
    });

    if (!response.ok) {
      setMessage("ยังบันทึกงบไม่ได้");
      return;
    }

    setMessage("บันทึกงบแล้ว");
    startTransition(() => router.refresh());
  }

  return (
    <form
      className="mb-5 grid gap-3 rounded-md border border-zinc-100 bg-zinc-50 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={handleSubmit}
    >
      <label className="grid gap-1 text-sm font-medium text-zinc-700">
        งบรายวัน
        <input
          className="min-h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          inputMode="numeric"
          min={1}
          name="dailyBudgetBaht"
          onChange={(event) => setDailyBudget(event.target.value)}
          required
          step={1}
          type="number"
          value={dailyBudget}
        />
      </label>
      <label className="grid gap-1 text-sm font-medium text-zinc-700">
        งบรายเดือน
        <input
          className="min-h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          inputMode="numeric"
          min={1}
          name="monthlyBudgetBaht"
          onChange={(event) => setMonthlyBudget(event.target.value)}
          required
          step={1}
          type="number"
          value={monthlyBudget}
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          className="min-h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          disabled={isPending}
          type="submit"
        >
          บันทึก
        </button>
        {message ? (
          <p className="text-xs font-medium text-zinc-500">{message}</p>
        ) : null}
      </div>
    </form>
  );
}
