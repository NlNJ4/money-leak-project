export type ExpenseCategory =
  | "food"
  | "drinks"
  | "delivery"
  | "transport"
  | "shopping"
  | "subscriptions"
  | "other";

export type Expense = {
  id: string;
  lineUserId: string;
  lineWebhookEventId: string | null;
  title: string;
  amountBaht: number;
  category: ExpenseCategory;
  isNeed: boolean;
  spentAt: string;
  createdAt: string;
};

export type UserBudget = {
  lineUserId: string;
  dailyBudgetBaht: number;
  monthlyBudgetBaht: number;
};

export type CategoryTotal = {
  category: ExpenseCategory;
  label: string;
  totalBaht: number;
  count: number;
  percentage: number;
  color: string;
};

export type DailySpending = {
  dateKey: string;
  label: string;
  totalBaht: number;
};

export type LeakSeverity = "low" | "medium" | "high";

export type LeakInsight = {
  category: ExpenseCategory;
  label: string;
  totalBaht: number;
  count: number;
  score: number;
  severity: LeakSeverity;
  message: string;
  suggestion: string;
};

export type DashboardSummary = {
  dataMode: "demo" | "user";
  lineUserId: string;
  asOf: string;
  todayTotalBaht: number;
  monthTotalBaht: number;
  weekTotalBaht: number;
  weekAverageBaht: number;
  weekTopCategory: CategoryTotal | null;
  dailyBudgetBaht: number;
  monthlyBudgetBaht: number;
  dailyRemainingBaht: number;
  monthlyRemainingBaht: number;
  projectedMonthTotalBaht: number;
  leakScore: number;
  categoryTotals: CategoryTotal[];
  dailyTrend: DailySpending[];
  leakInsights: LeakInsight[];
  recentExpenses: Expense[];
};
