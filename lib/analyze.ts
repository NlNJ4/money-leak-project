import { categoryConfig, categoryOrder } from "@/lib/categories";
import {
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

function getCategoryTotals(expenses: Expense[], monthTotalBaht: number) {
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
          monthTotalBaht > 0 ? (totalBaht / monthTotalBaht) * 100 : 0,
        color: categoryConfig[category].color,
      };
    })
    .filter((categoryTotal) => categoryTotal.totalBaht > 0)
    .sort((a, b) => b.totalBaht - a.totalBaht);
}

function buildTrend(expenses: Expense[], now: Date) {
  return getRecentBangkokDateKeys(7, now).map((dateKey) => {
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
  const todayTotalBaht = sumExpenses(todayExpenses);
  const monthTotalBaht = sumExpenses(monthExpenses);
  const categoryTotals = getCategoryTotals(monthExpenses, monthTotalBaht);
  const leakInsights = getLeakInsights(categoryTotals, monthTotalBaht);
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
    dailyTrend: buildTrend(monthExpenses, now),
    leakInsights,
    recentExpenses,
  };
}
