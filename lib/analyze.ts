import { categoryConfig, categoryOrder } from "@/lib/categories";
import {
  addDaysToDateKey,
  formatDateKeyThai,
  getBangkokCalendarContext,
  getBangkokDateKey,
  getRecentBangkokDateKeys,
} from "@/lib/date";
import type {
  CategoryTotal,
  DashboardSummary,
  Expense,
  ExpenseCategory,
  LeakInsight,
  LeakSeverity,
  RecurringCadence,
  RecurringExpenseInsight,
  UserBudget,
} from "@/lib/types";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function sumExpenses(expenses: Expense[]) {
  return expenses.reduce((sum, expense) => sum + expense.amountBaht, 0);
}

function isSameBangkokDay(expense: Expense, dayKey: string) {
  return getBangkokDateKey(new Date(expense.spentAt)) === dayKey;
}

function isSameBangkokMonth(expense: Expense, monthKey: string) {
  return getBangkokDateKey(new Date(expense.spentAt)).startsWith(monthKey);
}

function getCategoryTotals(expenses: Expense[], totalBahtForPercent: number) {
  return categoryOrder
    .map<CategoryTotal>((category) => {
      const categoryExpenses = expenses.filter(
        (expense) => expense.category === category,
      );
      const totalBaht = sumExpenses(categoryExpenses);

      return {
        category,
        label: categoryConfig[category].label,
        totalBaht,
        count: categoryExpenses.length,
        percentage:
          totalBahtForPercent > 0
            ? (totalBaht / totalBahtForPercent) * 100
            : 0,
        color: categoryConfig[category].color,
      };
    })
    .filter((categoryTotal) => categoryTotal.totalBaht > 0)
    .sort((a, b) => b.totalBaht - a.totalBaht);
}

function buildTrend(expenses: Expense[], dateKeys: string[]) {
  return dateKeys.map((dateKey) => {
    const totalBaht = sumExpenses(
      expenses.filter((expense) => isSameBangkokDay(expense, dateKey)),
    );

    return {
      dateKey,
      label: formatDateKeyThai(dateKey),
      totalBaht,
    };
  });
}

function getLeakSuggestion(
  category: ExpenseCategory,
  totalBaht: number,
  count: number,
) {
  const averageBaht = count > 0 ? Math.round(totalBaht / count) : 0;

  switch (category) {
    case "drinks":
      return `ลดเครื่องดื่มลง 2 ครั้งต่อสัปดาห์ จะประหยัดประมาณ ${averageBaht * 2} บาท`;
    case "delivery":
      return "รวมออร์เดอร์หรือสลับเป็นรับเองในวันที่ไม่เร่ง จะลดค่าส่งซ้ำได้";
    case "shopping":
      return "พักรายการจุกจิก 24 ชั่วโมงก่อนจ่าย เพื่อแยกของจำเป็นออกจากของอยากได้";
    case "subscriptions":
      return "เช็กสมาชิกที่ไม่ได้ใช้ในเดือนนี้ แล้วตัดรายการซ้ำก่อนต่ออายุ";
    default:
      return "กำหนดเพดานรายสัปดาห์ให้หมวดนี้ แล้วติดตามยอดทุกวัน";
  }
}

function getSeverity(score: number): LeakSeverity {
  if (score >= 80) return "high";
  if (score >= 45) return "medium";

  return "low";
}

function getLeakInsights(categoryTotals: CategoryTotal[], monthTotalBaht: number) {
  return categoryTotals
    .map<LeakInsight>((categoryTotal) => {
      const config = categoryConfig[categoryTotal.category];
      const recurringWeight = Math.min(categoryTotal.count * 5, 35);
      const shareWeight =
        monthTotalBaht > 0
          ? Math.min((categoryTotal.totalBaht / monthTotalBaht) * 70, 55)
          : 0;
      const score = Math.round(
        recurringWeight + shareWeight + (config.leakProne ? 20 : 0),
      );
      const severity = getSeverity(score);

      return {
        category: categoryTotal.category,
        label: categoryTotal.label,
        totalBaht: categoryTotal.totalBaht,
        count: categoryTotal.count,
        score,
        severity,
        message: `${categoryTotal.label} ใช้ไป ${categoryTotal.count} ครั้งในเดือนนี้`,
        suggestion: getLeakSuggestion(
          categoryTotal.category,
          categoryTotal.totalBaht,
          categoryTotal.count,
        ),
      };
    })
    .filter((insight) => {
      const config = categoryConfig[insight.category];

      return (
        insight.count >= 3 ||
        insight.totalBaht >= 500 ||
        (config.leakProne && insight.totalBaht >= 250)
      );
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

const subscriptionTitleHints = [
  "netflix",
  "spotify",
  "youtube",
  "icloud",
  "google one",
  "chatgpt",
  "gemini",
  "canva",
  "adobe",
  "subscription",
  "membership",
  "member",
  "รายเดือน",
  "สมาชิก",
];

function normalizeRecurringKey(title: string) {
  return title
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[0-9]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSubscriptionCandidate(expense: Expense) {
  const normalizedTitle = expense.title.toLowerCase();

  return (
    expense.category === "subscriptions" ||
    subscriptionTitleHints.some((hint) => normalizedTitle.includes(hint))
  );
}

function getMedian(values: number[]) {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middleIndex = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) return sorted[middleIndex];

  return Math.round((sorted[middleIndex - 1] + sorted[middleIndex]) / 2);
}

function getDaysBetweenDateKeys(leftDateKey: string, rightDateKey: string) {
  const left = new Date(`${leftDateKey}T00:00:00.000Z`).getTime();
  const right = new Date(`${rightDateKey}T00:00:00.000Z`).getTime();

  return Math.round((right - left) / 86_400_000);
}

function getRecurringCadence(intervalDays: number): RecurringCadence | null {
  if (intervalDays >= 24 && intervalDays <= 38) return "monthly";
  if (intervalDays >= 5 && intervalDays <= 9) return "weekly";

  return null;
}

function getCadenceLabel(cadence: RecurringCadence) {
  return cadence === "monthly" ? "รายเดือน" : "รายสัปดาห์";
}

function buildRecurringInsights(expenses: Expense[]) {
  const groups = new Map<string, Expense[]>();

  for (const expense of expenses.filter(isSubscriptionCandidate)) {
    const key = normalizeRecurringKey(expense.title);
    if (!key) continue;

    groups.set(key, [...(groups.get(key) ?? []), expense]);
  }

  return Array.from(groups.entries())
    .map<RecurringExpenseInsight | null>(([key, groupExpenses]) => {
      const sortedExpenses = [...groupExpenses].sort(
        (a, b) =>
          new Date(a.spentAt).getTime() - new Date(b.spentAt).getTime(),
      );

      if (sortedExpenses.length < 2) return null;

      const dateKeys = sortedExpenses.map((expense) =>
        getBangkokDateKey(new Date(expense.spentAt)),
      );
      const intervals = dateKeys
        .slice(1)
        .map((dateKey, index) =>
          getDaysBetweenDateKeys(dateKeys[index], dateKey),
        )
        .filter((interval) => interval > 0);
      const medianIntervalDays = getMedian(intervals);
      const cadence = getRecurringCadence(medianIntervalDays);

      if (!cadence) return null;

      const totalBaht = sumExpenses(sortedExpenses);
      const averageAmountBaht = Math.round(totalBaht / sortedExpenses.length);
      const amounts = sortedExpenses.map((expense) => expense.amountBaht);
      const amountRange = Math.max(...amounts) - Math.min(...amounts);
      const isStableAmount =
        amountRange <= Math.max(25, Math.round(averageAmountBaht * 0.2));

      if (!isStableAmount) return null;

      const lastExpense = sortedExpenses[sortedExpenses.length - 1];
      const nextExpectedDateKey = addDaysToDateKey(
        getBangkokDateKey(new Date(lastExpense.spentAt)),
        medianIntervalDays,
      );
      const confidence = clamp(
        45 + sortedExpenses.length * 15 + (isStableAmount ? 20 : 0),
        0,
        95,
      );
      const cadenceLabel = getCadenceLabel(cadence);

      return {
        key,
        title: lastExpense.title,
        category: lastExpense.category,
        cadence,
        count: sortedExpenses.length,
        averageAmountBaht,
        totalBaht,
        lastSpentAt: lastExpense.spentAt,
        nextExpectedDateKey,
        confidence,
        message: `${lastExpense.title} ดูเหมือนเป็นค่าใช้จ่าย${cadenceLabel} ${sortedExpenses.length} ครั้ง`,
        suggestion: `เตรียมไว้ประมาณ ${averageAmountBaht} บาท รอบถัดไปใกล้ ${formatDateKeyThai(nextExpectedDateKey)}`,
      };
    })
    .filter(
      (insight): insight is RecurringExpenseInsight => insight !== null,
    )
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;

      return b.averageAmountBaht - a.averageAmountBaht;
    })
    .slice(0, 3);
}

function getLeakScore(
  todayTotalBaht: number,
  monthTotalBaht: number,
  budget: UserBudget,
  leakInsights: LeakInsight[],
  recentExpenses: Expense[],
  now: Date,
) {
  const dailyPenalty =
    todayTotalBaht > budget.dailyBudgetBaht ? 12 : 0;
  const monthlyPenalty =
    monthTotalBaht > budget.monthlyBudgetBaht ? 18 : 0;
  const leakPenalty = leakInsights.reduce((sum, insight) => {
    if (insight.severity === "high") return sum + 12;
    if (insight.severity === "medium") return sum + 7;

    return sum + 4;
  }, 0);
  const recentKeys = getRecentBangkokDateKeys(3, now);
  const hasTrackedRecently = recentKeys.every((dateKey) =>
    recentExpenses.some((expense) => isSameBangkokDay(expense, dateKey)),
  );
  const consistencyBonus = hasTrackedRecently ? 8 : 0;

  return clamp(
    100 - dailyPenalty - monthlyPenalty - leakPenalty + consistencyBonus,
    0,
    100,
  );
}

export function buildDashboardSummary({
  expenses,
  budget,
  dataMode,
  now = new Date(),
}: {
  expenses: Expense[];
  budget: UserBudget;
  dataMode: DashboardSummary["dataMode"];
  now?: Date;
}): DashboardSummary {
  const { todayKey, monthKey, dayOfMonth, daysInMonth } =
    getBangkokCalendarContext(now);
  const todayExpenses = expenses.filter((expense) =>
    isSameBangkokDay(expense, todayKey),
  );
  const monthExpenses = expenses.filter((expense) =>
    isSameBangkokMonth(expense, monthKey),
  );
  const weekDateKeys = getRecentBangkokDateKeys(7, now);
  const weekDateKeySet = new Set(weekDateKeys);
  const weekExpenses = expenses.filter((expense) =>
    weekDateKeySet.has(getBangkokDateKey(new Date(expense.spentAt))),
  );
  const todayTotalBaht = sumExpenses(todayExpenses);
  const monthTotalBaht = sumExpenses(monthExpenses);
  const weekTotalBaht = sumExpenses(weekExpenses);
  const categoryTotals = getCategoryTotals(monthExpenses, monthTotalBaht);
  const weekCategoryTotals = getCategoryTotals(weekExpenses, weekTotalBaht);
  const leakInsights = getLeakInsights(categoryTotals, monthTotalBaht);
  const recurringInsights = buildRecurringInsights(expenses);
  const recentExpenses = [...expenses]
    .sort(
      (a, b) => new Date(b.spentAt).getTime() - new Date(a.spentAt).getTime(),
    )
    .slice(0, 8);

  return {
    dataMode,
    lineUserId: budget.lineUserId,
    asOf: now.toISOString(),
    todayTotalBaht,
    monthTotalBaht,
    weekTotalBaht,
    weekAverageBaht: Math.round(weekTotalBaht / weekDateKeys.length),
    weekTopCategory: weekCategoryTotals[0] ?? null,
    dailyBudgetBaht: budget.dailyBudgetBaht,
    monthlyBudgetBaht: budget.monthlyBudgetBaht,
    dailyRemainingBaht: budget.dailyBudgetBaht - todayTotalBaht,
    monthlyRemainingBaht: budget.monthlyBudgetBaht - monthTotalBaht,
    projectedMonthTotalBaht:
      dayOfMonth > 0
        ? Math.round((monthTotalBaht / dayOfMonth) * daysInMonth)
        : 0,
    leakScore: getLeakScore(
      todayTotalBaht,
      monthTotalBaht,
      budget,
      leakInsights,
      recentExpenses,
      now,
    ),
    categoryTotals,
    dailyTrend: buildTrend(expenses, weekDateKeys),
    leakInsights,
    recurringInsights,
    recentExpenses,
  };
}
