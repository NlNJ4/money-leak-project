import { randomUUID } from "node:crypto";
import { buildDashboardSummary } from "@/lib/analyze";
import { categoryOrder } from "@/lib/categories";
import { DEMO_LINE_USER_ID } from "@/lib/constants";
import {
  getBangkokDateKey,
  getBangkokDayStartIso,
  getRecentBangkokDateKeys,
  toBangkokIso,
} from "@/lib/date";
import { detectCategory } from "@/lib/parser";
import {
  MAX_BUDGET_AMOUNT_BAHT,
  MAX_EXPENSE_AMOUNT_BAHT,
  MAX_EXPENSE_TITLE_LENGTH,
  normalizeLineUserId,
} from "@/lib/security";
import {
  getSupabaseAdminClient,
  isSupabaseConfigured,
} from "@/lib/supabase/admin";
import type {
  DashboardSummary,
  Expense,
  ExpenseCategory,
  UserBudget,
} from "@/lib/types";
import type { Database } from "@/types/database.types";

export { DEMO_LINE_USER_ID };

type ExpenseInput = {
  lineUserId: string;
  lineWebhookEventId?: string | null;
  title: string;
  amountBaht: number;
  category?: ExpenseCategory;
  isNeed?: boolean;
  spentAt?: string;
};

type ExpenseUpdateInput = {
  title: string;
  amountBaht: number;
  category?: ExpenseCategory;
  isNeed?: boolean;
};

type BudgetUpdateInput = {
  dailyBudgetBaht?: number;
  monthlyBudgetBaht?: number;
};

type MoneyLeakStore = {
  expenses: Expense[];
  budgets: Map<string, UserBudget>;
};

type ExpenseRow = Database["public"]["Tables"]["expenses"]["Row"];
type LineUserRow = Database["public"]["Tables"]["line_users"]["Row"];
type LineUserUpdate = Database["public"]["Tables"]["line_users"]["Update"];

const globalForMoneyLeak = globalThis as typeof globalThis & {
  __moneyLeakStore?: MoneyLeakStore;
};

const DEFAULT_EXPENSE_QUERY_LIMIT = 100;
const DASHBOARD_EXPENSE_QUERY_LIMIT = 1_000;
const DASHBOARD_INSIGHT_LOOKBACK_DAYS = 90;
const MAX_EXPENSE_QUERY_LIMIT = 1_000;
const MAX_LINE_WEBHOOK_EVENT_ID_LENGTH = 128;

export function getDefaultLineUserId() {
  return (
    normalizeLineUserId(process.env.DEFAULT_LINE_USER_ID, DEMO_LINE_USER_ID) ??
    DEMO_LINE_USER_ID
  );
}

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

function toExpenseCategory(category: string): ExpenseCategory {
  return categoryOrder.includes(category as ExpenseCategory)
    ? (category as ExpenseCategory)
    : "other";
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
    { day: -35, title: "Netflix", amountBaht: 419, hour: 7, minute: 0 },
    { day: -26, title: "Spotify", amountBaht: 129, hour: 7, minute: 0 },
    { day: -56, title: "Spotify", amountBaht: 129, hour: 7, minute: 0 },
  ];

  return rows.map((row, index) => {
    const dateKey = shiftDateKey(todayKey, row.day);

    return {
      id: `demo-${index + 1}`,
      lineUserId: DEMO_LINE_USER_ID,
      lineWebhookEventId: null,
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

function mapExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    lineUserId: row.line_user_id,
    lineWebhookEventId: row.line_webhook_event_id,
    title: row.title,
    amountBaht: row.amount_baht,
    category: toExpenseCategory(row.category),
    isNeed: row.is_need,
    spentAt: row.spent_at,
    createdAt: row.created_at,
  };
}

function mapBudget(row: LineUserRow): UserBudget {
  return {
    lineUserId: row.line_user_id,
    dailyBudgetBaht: row.daily_budget_baht,
    monthlyBudgetBaht: row.monthly_budget_baht,
  };
}

function getMemoryBudget(lineUserId = DEMO_LINE_USER_ID): UserBudget {
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

function updateMemoryBudget(lineUserId: string, input: BudgetUpdateInput) {
  const store = getStore();
  const currentBudget = getMemoryBudget(lineUserId);
  const nextBudget = {
    ...currentBudget,
    ...input,
  };

  store.budgets.set(lineUserId, nextBudget);

  return nextBudget;
}

function listMemoryExpenses(lineUserId = DEMO_LINE_USER_ID) {
  return getStore()
    .expenses.filter((expense) => expense.lineUserId === lineUserId)
    .sort(
      (a, b) => new Date(b.spentAt).getTime() - new Date(a.spentAt).getTime(),
    );
}

function filterAndLimitExpenses(
  expenses: Expense[],
  { limit, since }: { limit: number; since?: string },
) {
  return (since
    ? expenses.filter((expense) => expense.spentAt >= since)
    : expenses
  ).slice(0, limit);
}

function createMemoryExpense(input: ExpenseInput) {
  const lineWebhookEventId = normalizeLineWebhookEventId(
    input.lineWebhookEventId,
  );
  const existingExpense =
    lineWebhookEventId === null
      ? null
      : getStore().expenses.find(
          (expense) => expense.lineWebhookEventId === lineWebhookEventId,
        );

  if (existingExpense) return existingExpense;

  const expense: Expense = {
    id: randomUUID(),
    lineUserId: input.lineUserId,
    lineWebhookEventId,
    title: input.title.trim(),
    amountBaht: input.amountBaht,
    category: toExpenseCategory(input.category ?? detectCategory(input.title)),
    isNeed: input.isNeed ?? false,
    spentAt: input.spentAt ?? new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  getStore().expenses.push(expense);

  return expense;
}

function updateMemoryExpense(
  lineUserId: string,
  expenseId: string,
  input: ExpenseUpdateInput,
) {
  const store = getStore();
  const expenseIndex = store.expenses.findIndex(
    (expense) => expense.lineUserId === lineUserId && expense.id === expenseId,
  );

  if (expenseIndex === -1) {
    throw new Error("Expense not found");
  }

  const currentExpense = store.expenses[expenseIndex];
  const nextExpense = {
    ...currentExpense,
    title: input.title.trim(),
    amountBaht: input.amountBaht,
    category: toExpenseCategory(input.category ?? detectCategory(input.title)),
    isNeed: input.isNeed ?? currentExpense.isNeed,
  };

  store.expenses[expenseIndex] = nextExpense;

  return nextExpense;
}

function deleteMemoryExpense(lineUserId: string, expenseId: string) {
  const store = getStore();
  const beforeCount = store.expenses.length;

  store.expenses = store.expenses.filter(
    (expense) => expense.lineUserId !== lineUserId || expense.id !== expenseId,
  );

  return store.expenses.length < beforeCount;
}

function normalizeLineWebhookEventId(value: string | null | undefined) {
  if (typeof value !== "string") return null;

  const candidate = value.trim();

  if (!candidate || candidate.length > MAX_LINE_WEBHOOK_EVENT_ID_LENGTH) {
    return null;
  }

  return candidate;
}

function normalizeExpenseQueryLimit(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_EXPENSE_QUERY_LIMIT;

  return Math.min(Math.max(Math.trunc(value), 1), MAX_EXPENSE_QUERY_LIMIT);
}

function validateBudgetAmount(value: number, label: string) {
  if (
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_BUDGET_AMOUNT_BAHT
  ) {
    throw new Error(`${label} must be a positive integer baht amount`);
  }
}

function validateExpenseInput(input: ExpenseInput) {
  const lineUserId = normalizeLineUserId(input.lineUserId, "");

  if (!lineUserId) {
    throw new Error("Line user id is required");
  }

  const title = input.title.trim();

  if (!title) {
    throw new Error("Expense title is required");
  }

  if (title.length > MAX_EXPENSE_TITLE_LENGTH) {
    throw new Error("Expense title is too long");
  }

  if (
    !Number.isInteger(input.amountBaht) ||
    input.amountBaht <= 0 ||
    input.amountBaht > MAX_EXPENSE_AMOUNT_BAHT
  ) {
    throw new Error("Expense amount must be a positive integer baht amount");
  }
}

function validateExpenseUpdateInput(input: ExpenseUpdateInput) {
  validateExpenseInput({
    lineUserId: DEMO_LINE_USER_ID,
    title: input.title,
    amountBaht: input.amountBaht,
    category: input.category,
    isNeed: input.isNeed,
  });
}

async function getExpenseByLineWebhookEventId(
  lineUserId: string,
  lineWebhookEventId: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .eq("line_user_id", lineUserId)
    .eq("line_webhook_event_id", lineWebhookEventId)
    .maybeSingle();

  if (error) {
    console.error("Supabase duplicate expense lookup failed", {
      code: error.code,
      message: error.message,
    });
    throw new Error("Unable to load existing expense");
  }

  return data ? mapExpense(data) : null;
}

async function ensureLineUser(lineUserId: string) {
  const supabase = getSupabaseAdminClient();

  if (!supabase) return getMemoryBudget(lineUserId);

  const { data: existingUser, error: selectError } = await supabase
    .from("line_users")
    .select("*")
    .eq("line_user_id", lineUserId)
    .maybeSingle();

  if (selectError) {
    console.error("Supabase line_users select failed", {
      code: selectError.code,
      message: selectError.message,
    });
    throw new Error("Unable to load user budget");
  }

  if (existingUser) return mapBudget(existingUser);

  const { data: insertedUser, error: insertError } = await supabase
    .from("line_users")
    .upsert(
      { line_user_id: lineUserId },
      { onConflict: "line_user_id", ignoreDuplicates: false },
    )
    .select("*")
    .single();

  if (insertError || !insertedUser) {
    console.error("Supabase line_users upsert failed", {
      code: insertError?.code,
      message: insertError?.message,
    });
    throw new Error("Unable to create LINE user");
  }

  return mapBudget(insertedUser);
}

function shouldUseMemory(lineUserId: string) {
  return lineUserId === DEMO_LINE_USER_ID || !isSupabaseConfigured();
}

export async function getBudget(lineUserId = DEMO_LINE_USER_ID) {
  if (shouldUseMemory(lineUserId)) return getMemoryBudget(lineUserId);

  return ensureLineUser(lineUserId);
}

export async function updateDailyBudget(
  lineUserId: string,
  dailyBudgetBaht: number,
) {
  return updateBudget(lineUserId, { dailyBudgetBaht });
}

export async function updateMonthlyBudget(
  lineUserId: string,
  monthlyBudgetBaht: number,
) {
  return updateBudget(lineUserId, { monthlyBudgetBaht });
}

export async function updateBudget(lineUserId: string, input: BudgetUpdateInput) {
  const normalizedLineUserId = normalizeLineUserId(lineUserId, "");

  if (!normalizedLineUserId) {
    throw new Error("Line user id is required");
  }

  if (
    input.dailyBudgetBaht === undefined &&
    input.monthlyBudgetBaht === undefined
  ) {
    throw new Error("At least one budget value is required");
  }

  if (input.dailyBudgetBaht !== undefined) {
    validateBudgetAmount(input.dailyBudgetBaht, "Daily budget");
  }

  if (input.monthlyBudgetBaht !== undefined) {
    validateBudgetAmount(input.monthlyBudgetBaht, "Monthly budget");
  }

  if (shouldUseMemory(normalizedLineUserId)) {
    return updateMemoryBudget(normalizedLineUserId, input);
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) return updateMemoryBudget(normalizedLineUserId, input);

  await ensureLineUser(normalizedLineUserId);

  const updateValues: LineUserUpdate = {
    updated_at: new Date().toISOString(),
  };

  if (input.dailyBudgetBaht !== undefined) {
    updateValues.daily_budget_baht = input.dailyBudgetBaht;
  }

  if (input.monthlyBudgetBaht !== undefined) {
    updateValues.monthly_budget_baht = input.monthlyBudgetBaht;
  }

  const { data, error } = await supabase
    .from("line_users")
    .update(updateValues)
    .eq("line_user_id", normalizedLineUserId)
    .select("*")
    .single();

  if (error || !data) {
    console.error("Supabase line_users update failed", {
      code: error?.code,
      message: error?.message,
    });
    throw new Error("Unable to update daily budget");
  }

  return mapBudget(data);
}

export async function listExpenses(
  lineUserId = DEMO_LINE_USER_ID,
  {
    limit = DEFAULT_EXPENSE_QUERY_LIMIT,
    since,
  }: {
    limit?: number;
    since?: string;
  } = {},
) {
  const safeLimit = normalizeExpenseQueryLimit(limit);

  if (shouldUseMemory(lineUserId)) {
    return filterAndLimitExpenses(listMemoryExpenses(lineUserId), {
      limit: safeLimit,
      since,
    });
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return filterAndLimitExpenses(listMemoryExpenses(lineUserId), {
      limit: safeLimit,
      since,
    });
  }

  let query = supabase
    .from("expenses")
    .select("*")
    .eq("line_user_id", lineUserId)
    .order("spent_at", { ascending: false })
    .limit(safeLimit);

  if (since) {
    query = query.gte("spent_at", since);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Supabase expenses select failed", {
      code: error.code,
      message: error.message,
    });
    throw new Error("Unable to load expenses");
  }

  return data.map(mapExpense);
}

export async function createExpense(input: ExpenseInput) {
  validateExpenseInput(input);

  const normalizedInput = {
    ...input,
    title: input.title.trim(),
    lineUserId: normalizeLineUserId(input.lineUserId, "") ?? input.lineUserId,
    lineWebhookEventId: normalizeLineWebhookEventId(input.lineWebhookEventId),
    category: toExpenseCategory(input.category ?? detectCategory(input.title)),
  };

  if (shouldUseMemory(normalizedInput.lineUserId)) {
    return createMemoryExpense(normalizedInput);
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) return createMemoryExpense(normalizedInput);

  await ensureLineUser(normalizedInput.lineUserId);

  const { data, error } = await supabase
    .from("expenses")
    .insert({
      line_user_id: normalizedInput.lineUserId,
      title: normalizedInput.title,
      amount_baht: input.amountBaht,
      category: normalizedInput.category,
      is_need: input.isNeed ?? false,
      line_webhook_event_id: normalizedInput.lineWebhookEventId,
      spent_at: input.spentAt ?? new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error?.code === "23505" && normalizedInput.lineWebhookEventId) {
    const existingExpense = await getExpenseByLineWebhookEventId(
      normalizedInput.lineUserId,
      normalizedInput.lineWebhookEventId,
    );

    if (existingExpense) return existingExpense;
  }

  if (error || !data) {
    console.error("Supabase expenses insert failed", {
      code: error?.code,
      message: error?.message,
    });
    throw new Error("Unable to create expense");
  }

  return mapExpense(data);
}

export async function updateExpense(
  lineUserId: string,
  expenseId: string,
  input: ExpenseUpdateInput,
) {
  const normalizedLineUserId = normalizeLineUserId(lineUserId, "");

  if (!normalizedLineUserId) {
    throw new Error("Line user id is required");
  }

  const normalizedExpenseId = expenseId.trim();

  if (!normalizedExpenseId) {
    throw new Error("Expense id is required");
  }

  validateExpenseUpdateInput(input);

  const normalizedInput = {
    ...input,
    title: input.title.trim(),
    category: toExpenseCategory(input.category ?? detectCategory(input.title)),
  };

  if (shouldUseMemory(normalizedLineUserId)) {
    return updateMemoryExpense(
      normalizedLineUserId,
      normalizedExpenseId,
      normalizedInput,
    );
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return updateMemoryExpense(
      normalizedLineUserId,
      normalizedExpenseId,
      normalizedInput,
    );
  }

  const { data, error } = await supabase
    .from("expenses")
    .update({
      title: normalizedInput.title,
      amount_baht: normalizedInput.amountBaht,
      category: normalizedInput.category,
      is_need: normalizedInput.isNeed ?? false,
    })
    .eq("line_user_id", normalizedLineUserId)
    .eq("id", normalizedExpenseId)
    .select("*")
    .maybeSingle();

  if (error || !data) {
    console.error("Supabase expenses update failed", {
      code: error?.code,
      message: error?.message,
    });
    throw new Error("Unable to update expense");
  }

  return mapExpense(data);
}

export async function deleteExpense(lineUserId: string, expenseId: string) {
  const normalizedLineUserId = normalizeLineUserId(lineUserId, "");

  if (!normalizedLineUserId) {
    throw new Error("Line user id is required");
  }

  const normalizedExpenseId = expenseId.trim();

  if (!normalizedExpenseId) {
    throw new Error("Expense id is required");
  }

  if (shouldUseMemory(normalizedLineUserId)) {
    if (!deleteMemoryExpense(normalizedLineUserId, normalizedExpenseId)) {
      throw new Error("Expense not found");
    }

    return;
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    if (!deleteMemoryExpense(normalizedLineUserId, normalizedExpenseId)) {
      throw new Error("Expense not found");
    }

    return;
  }

  const { data, error } = await supabase
    .from("expenses")
    .delete()
    .eq("line_user_id", normalizedLineUserId)
    .eq("id", normalizedExpenseId)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.error("Supabase expenses delete failed", {
      code: error?.code,
      message: error?.message,
    });
    throw new Error("Unable to delete expense");
  }
}

export async function getDashboardSummary(
  lineUserId = DEMO_LINE_USER_ID,
  now = new Date(),
): Promise<DashboardSummary> {
  const budget = await getBudget(lineUserId);
  const insightStartKey = getRecentBangkokDateKeys(
    DASHBOARD_INSIGHT_LOOKBACK_DAYS,
    now,
  )[0];
  const insightStartIso = getBangkokDayStartIso(insightStartKey);
  const expenses = await listExpenses(lineUserId, {
    limit: DASHBOARD_EXPENSE_QUERY_LIMIT,
    since: insightStartIso,
  });

  return buildDashboardSummary({
    expenses,
    budget,
    dataMode: shouldUseMemory(lineUserId) ? "demo" : "user",
    now,
  });
}
