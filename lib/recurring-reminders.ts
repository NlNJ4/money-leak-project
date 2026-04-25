import { getBangkokDateKey } from "@/lib/date";
import type {
  RecurringExpenseInsight,
  RecurringPaymentReminder,
} from "@/lib/types";

export const RECURRING_REMINDER_LOOKAHEAD_DAYS = 7;
const RECURRING_REMINDER_OVERDUE_GRACE_DAYS = 7;

function getDaysBetweenDateKeys(leftDateKey: string, rightDateKey: string) {
  const left = new Date(`${leftDateKey}T00:00:00.000Z`).getTime();
  const right = new Date(`${rightDateKey}T00:00:00.000Z`).getTime();

  return Math.round((right - left) / 86_400_000);
}

function getDueLabel(daysUntilDue: number) {
  if (daysUntilDue < 0) return `เลยกำหนด ${Math.abs(daysUntilDue)} วัน`;
  if (daysUntilDue === 0) return "วันนี้";
  if (daysUntilDue === 1) return "พรุ่งนี้";

  return `อีก ${daysUntilDue} วัน`;
}

function getUrgency(daysUntilDue: number): RecurringPaymentReminder["urgency"] {
  if (daysUntilDue < 0) return "overdue";
  if (daysUntilDue === 0) return "today";

  return "soon";
}

export function getRecurringPaymentReminders({
  insights,
  now = new Date(),
  lookaheadDays = RECURRING_REMINDER_LOOKAHEAD_DAYS,
}: {
  insights: RecurringExpenseInsight[];
  now?: Date;
  lookaheadDays?: number;
}) {
  const todayKey = getBangkokDateKey(now);

  return insights
    .map<RecurringPaymentReminder | null>((insight) => {
      if (!insight.nextExpectedDateKey) return null;

      const daysUntilDue = getDaysBetweenDateKeys(
        todayKey,
        insight.nextExpectedDateKey,
      );

      if (
        daysUntilDue > lookaheadDays ||
        daysUntilDue < -RECURRING_REMINDER_OVERDUE_GRACE_DAYS
      ) {
        return null;
      }

      return {
        ...insight,
        daysUntilDue,
        dueLabel: getDueLabel(daysUntilDue),
        urgency: getUrgency(daysUntilDue),
      };
    })
    .filter(
      (reminder): reminder is RecurringPaymentReminder => reminder !== null,
    )
    .sort((a, b) => {
      if (a.daysUntilDue !== b.daysUntilDue) {
        return a.daysUntilDue - b.daysUntilDue;
      }

      return b.averageAmountBaht - a.averageAmountBaht;
    });
}
