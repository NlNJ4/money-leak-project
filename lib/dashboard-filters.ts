import { categoryConfig, categoryOrder } from "@/lib/categories";
import {
  getBangkokDayStartIso,
  getBangkokMonthKey,
  getBangkokMonthStartIso,
  getRecentBangkokDateKeys,
} from "@/lib/date";
import type { SearchParamValue } from "@/lib/security";
import type { Expense, ExpenseCategory } from "@/lib/types";

export const DASHBOARD_EXPENSE_PAGE_SIZE = 20;
export const DASHBOARD_EXPENSE_MAX_VISIBLE = 100;

export const dashboardExpenseRangeOptions = [
  { value: "7d", label: "7 วันล่าสุด" },
  { value: "30d", label: "30 วันล่าสุด" },
  { value: "month", label: "เดือนนี้" },
  { value: "90d", label: "90 วันล่าสุด" },
] as const;

export type DashboardExpenseRange =
  (typeof dashboardExpenseRangeOptions)[number]["value"];
export type DashboardExpenseCategoryFilter = ExpenseCategory | "all";

export type DashboardExpenseFilters = {
  category: DashboardExpenseCategoryFilter;
  limit: number;
  query: string;
  range: DashboardExpenseRange;
};

export type DashboardExpenseFilterSearchParams = {
  category?: SearchParamValue;
  limit?: SearchParamValue;
  q?: SearchParamValue;
  range?: SearchParamValue;
};

export type DashboardExpenseResult = {
  categoryLabel: string;
  expenses: Expense[];
  hasMore: boolean;
  nextLimit: number;
  rangeLabel: string;
  totalBaht: number;
  totalCount: number;
  visibleCount: number;
};

function getSingleValue(value: SearchParamValue) {
  if (typeof value === "string") return value;

  return undefined;
}

function normalizeRange(value: SearchParamValue): DashboardExpenseRange {
  const candidate = getSingleValue(value);

  return dashboardExpenseRangeOptions.some(
    (option) => option.value === candidate,
  )
    ? (candidate as DashboardExpenseRange)
    : "30d";
}

function normalizeCategory(
  value: SearchParamValue,
): DashboardExpenseCategoryFilter {
  const candidate = getSingleValue(value);

  if (candidate === "all") return "all";

  return categoryOrder.includes(candidate as ExpenseCategory)
    ? (candidate as ExpenseCategory)
    : "all";
}

function normalizeQuery(value: SearchParamValue) {
  return getSingleValue(value)?.trim().slice(0, 80) ?? "";
}

function normalizeLimit(value: SearchParamValue) {
  const parsed = Number(getSingleValue(value));

  if (!Number.isFinite(parsed)) return DASHBOARD_EXPENSE_PAGE_SIZE;

  return Math.min(
    Math.max(Math.trunc(parsed), DASHBOARD_EXPENSE_PAGE_SIZE),
    DASHBOARD_EXPENSE_MAX_VISIBLE,
  );
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();
}

function getRangeDayCount(range: DashboardExpenseRange) {
  if (range === "7d") return 7;
  if (range === "90d") return 90;

  return 30;
}

export function getDashboardExpenseRangeLabel(range: DashboardExpenseRange) {
  return (
    dashboardExpenseRangeOptions.find((option) => option.value === range)
      ?.label ?? "30 วันล่าสุด"
  );
}

export function getDashboardExpenseCategoryLabel(
  category: DashboardExpenseCategoryFilter,
) {
  return category === "all" ? "ทุกหมวด" : categoryConfig[category].label;
}

export function normalizeDashboardExpenseFilters(
  searchParams: DashboardExpenseFilterSearchParams,
): DashboardExpenseFilters {
  return {
    category: normalizeCategory(searchParams.category),
    limit: normalizeLimit(searchParams.limit),
    query: normalizeQuery(searchParams.q),
    range: normalizeRange(searchParams.range),
  };
}

export function getDashboardExpenseSinceIso(
  range: DashboardExpenseRange,
  now = new Date(),
) {
  if (range === "month") {
    return getBangkokMonthStartIso(getBangkokMonthKey(now));
  }

  return getBangkokDayStartIso(
    getRecentBangkokDateKeys(getRangeDayCount(range), now)[0],
  );
}

export function buildDashboardExpenseResult(
  expenses: Expense[],
  filters: DashboardExpenseFilters,
): DashboardExpenseResult {
  const query = normalizeSearchText(filters.query);
  const filteredExpenses = expenses.filter((expense) => {
    const matchesCategory =
      filters.category === "all" || expense.category === filters.category;
    const matchesQuery =
      !query ||
      normalizeSearchText(`${expense.title} ${expense.category}`).includes(
        query,
      );

    return matchesCategory && matchesQuery;
  });
  const visibleExpenses = filteredExpenses.slice(0, filters.limit);
  const nextLimit = Math.min(
    filters.limit + DASHBOARD_EXPENSE_PAGE_SIZE,
    DASHBOARD_EXPENSE_MAX_VISIBLE,
  );

  return {
    categoryLabel: getDashboardExpenseCategoryLabel(filters.category),
    expenses: visibleExpenses,
    hasMore:
      visibleExpenses.length < filteredExpenses.length &&
      filters.limit < DASHBOARD_EXPENSE_MAX_VISIBLE,
    nextLimit,
    rangeLabel: getDashboardExpenseRangeLabel(filters.range),
    totalBaht: filteredExpenses.reduce(
      (sum, expense) => sum + expense.amountBaht,
      0,
    ),
    totalCount: filteredExpenses.length,
    visibleCount: visibleExpenses.length,
  };
}
