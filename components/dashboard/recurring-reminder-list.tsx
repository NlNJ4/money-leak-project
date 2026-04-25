import { formatBaht } from "@/lib/format";
import type { RecurringPaymentReminder } from "@/lib/types";

const urgencyClassName: Record<RecurringPaymentReminder["urgency"], string> = {
  overdue: "border-rose-200 bg-rose-50 text-rose-800",
  today: "border-amber-200 bg-amber-50 text-amber-800",
  soon: "border-sky-200 bg-sky-50 text-sky-800",
};

export function RecurringReminderList({
  reminders,
}: {
  reminders: RecurringPaymentReminder[];
}) {
  if (reminders.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
        ยังไม่มีรายจ่ายซ้ำที่ใกล้ถึงใน 7 วัน
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {reminders.map((reminder) => (
        <li
          key={reminder.key}
          className={`rounded-lg border p-4 ${urgencyClassName[reminder.urgency]}`}
        >
          <div className="flex flex-col gap-2 min-[420px]:flex-row min-[420px]:items-start min-[420px]:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-normal">
                {reminder.dueLabel}
              </p>
              <h3 className="mt-1 truncate text-sm font-semibold">
                {reminder.title}
              </h3>
            </div>
            <p className="shrink-0 text-sm font-semibold min-[420px]:text-right">
              {formatBaht(reminder.averageAmountBaht)}
            </p>
          </div>
          <p className="mt-3 text-sm leading-6">{reminder.suggestion}</p>
        </li>
      ))}
    </ol>
  );
}
