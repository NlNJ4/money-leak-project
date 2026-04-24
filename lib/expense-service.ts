import { buildDashboardSummary } from "@/lib/analyze";
import { getBangkokDateKey, toBangkokIso } from "@/lib/date";
import { detectCategory } from "@/lib/parser";
import type {
  DashboardSummary,
  Expense,
  ExpenseCategory,
  UserBudget,
} from "@/lib/types";

export const DEMO_LINE_USER_ID = "demo-line-user";

type ExpenseInput = {
  lineUserId: string;
  title: string;
  amountBaht: number;
  category?: ExpenseCategory;
  isNeed?: boolean;
  spentAt?: string;
};

type MoneyLeakStore = {
  expenses: Expense[];
  budgets: Map<string, UserBudget>;
};

const globalForMoneyLeak = globalThis as typeof globalThis & {
  __moneyLeakStore?: MoneyLeakStore;
};

function shiftDateKey(todayKey: string, dayOffset: number) {
  return new Date(
    Date.UTC(
      Number(todayKey.slice(0, 4)),
      Number(todayKey.slice(5, 7)) - 1,
      Number(todayKey.slice(8, 10)) + dayOffset,
    ),
  )
    .toISOString()
    .slice(0, 10);
}

function createDemoExpenses(now = new Date()): Expense[] {
  const todayKey = getBangkokDateKey(now);
  const rows = [
    { day: 0, title: "ข้าวกะเพรา", amountBaht: 55, hour: 12, minute: 20 },
    { day: 0, title: "ชานม", amountBaht: 45, hour: 15, minute: 10 },
    { day: 0, title: "BTS", amountBaht: 32, hour: 18, minute: 45 },
    { day: -1, title: "กาแฟลาเต้", amountBaht: 65, hour: 9, minute: 5 },
    { day: -1, title: "ค่าส่ง LINE MAN", amountBaht: 49, hour: 19, minute: 30 },
    { day: -2, title: "ข้าวมันไก่", amountBaht: 60, hour: 12, minute: 40 },
    { day: -2, title: "ชานม", amountBaht: 45, hour: 16, minute: 0 },
    { day: -3, title: "Grab delivery", amountBaht: 129, hour: 20, minute: 15 },
    { day: -3, title: "ขนม", amountBaht: 35, hour: 14, minute: 20 },
    { day: -4, title: "MRT", amountBaht: 28, hour: 8, minute: 15 },
    { day: -4, title: "กาแฟ", amountBaht: 55, hour: 10, minute: 30 },
    { day: -5, title: "Netflix", amountBaht: 419, hour: 7, minute: 0 },
    { day: -6, title: "ชานม", amountBaht: 45, hour: 13, minute: 25 },
    { day: -7, title: "ข้าวเย็น", amountBaht: 70, hour: 18, minute: 10 },
    { day: -8, title: "Shopee ของใช้", amountBaht: 249, hour: 21, minute: 10 },
    { day: -10, title: "กาแฟ", amountBaht: 55, hour: 9, minute: 50 },
    { day: -12, title: "ค่าส่งอาหาร", amountBaht: 39, hour: 19, minute: 45 },
  ];

  return rows.map((row, index) => {
    const dateKey = shiftDateKey(todayKey, row.day);

    return {
      id: `demo-${index + 1}`,
      lineUserId: DEMO_LINE_USER_ID,
      title: row.title,
      amountBaht: row.amountBaht,
      category: detectCategory(row.title),
      isNeed: ["ข้าว", "BTS", "MRT"].some((keyword) =>
        row.title.includes(keyword),
      ),
      spentAt: toBangkokIso(dateKey, row.hour, row.minute),
      createdAt: toBangkokIso(dateKey, row.hour, row.minute),
    };
  });
}

function getStore() {
  if (!globalForMoneyLeak.__moneyLeakStore) {
    globalForMoneyLeak.__moneyLeakStore = {
      expenses: createDemoExpenses(),
      budgets: new Map([
        [
          DEMO_LINE_USER_ID,
          {
            lineUserId: DEMO_LINE_USER_ID,
            dailyBudgetBaht: 200,
            monthlyBudgetBaht: 6000,
          },
        ],
      ]),
    };
  }

  return globalForMoneyLeak.__moneyLeakStore;
}

export function getBudget(lineUserId = DEMO_LINE_USER_ID): UserBudget {
  const store = getStore();
  const existingBudget = store.budgets.get(lineUserId);

  if (existingBudget) return existingBudget;

  const budget = {
    lineUserId,
    dailyBudgetBaht: 200,
    monthlyBudgetBaht: 6000,
  };

  store.budgets.set(lineUserId, budget);

  return budget;
}

export function updateDailyBudget(lineUserId: string, dailyBudgetBaht: number) {
  const store = getStore();
  const currentBudget = getBudget(lineUserId);
  const nextBudget = {
    ...currentBudget,
    dailyBudgetBaht,
  };

  store.budgets.set(lineUserId, nextBudget);

  return nextBudget;
}

export function listExpenses(lineUserId = DEMO_LINE_USER_ID) {
  return getStore()
    .expenses.filter((expense) => expense.lineUserId === lineUserId)
    .sort(
      (a, b) => new Date(b.spentAt).getTime() - new Date(a.spentAt).getTime(),
    );
}

export function createExpense(input: ExpenseInput) {
  const title = input.title.trim();

  if (!title) {
    throw new Error("Expense title is required");
  }

  if (!Number.isInteger(input.amountBaht) || input.amountBaht <= 0) {
    throw new Error("Expense amount must be a positive integer baht amount");
  }

  const expense: Expense = {
    id: crypto.randomUUID(),
    lineUserId: input.lineUserId,
    title,
    amountBaht: input.amountBaht,
    category: input.category ?? detectCategory(title),
    isNeed: input.isNeed ?? false,
    spentAt: input.spentAt ?? new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  getStore().expenses.push(expense);

  return expense;
}

export function getDashboardSummary(
  lineUserId = DEMO_LINE_USER_ID,
  now = new Date(),
): DashboardSummary {
  const isDemo = lineUserId === DEMO_LINE_USER_ID;

  return buildDashboardSummary({
    expenses: listExpenses(lineUserId),
    budget: getBudget(lineUserId),
    dataMode: isDemo ? "demo" : "user",
    now,
  });
}
