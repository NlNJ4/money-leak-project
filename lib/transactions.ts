import "server-only";
import { todayISO } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";
import type {
  CreateTransactionInput,
  TransactionFilterRange,
} from "@/lib/validation";

export class ServiceError extends Error {
  constructor(
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export type TransactionRow = {
  id: string;
  type: string;
  amount: number;
  description: string;
  transaction_date: string;
  category: {
    slug: string;
    name_th: string;
    name_en: string;
    icon: string;
  } | null;
};

export type CategoryTotal = {
  slug: string;
  icon: string;
  name_th: string;
  name_en: string;
  type: string;
  total: number;
};

export type DashboardData = {
  totals: { income: number; expense: number; net: number };
  byCategory: CategoryTotal[];
  dailyTotals: { date: string; expense: number }[];
  recent: TransactionRow[];
};

async function requireClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new ServiceError("unauthorized");
  }
  return { supabase, userId: user.id };
}

const transactionSelect = `
  id, type, amount, description, transaction_date,
  category:categories (slug, name_th, name_en, icon)
`;

export type Category = {
  id: string;
  slug: string;
  name_th: string;
  name_en: string;
  icon: string;
  type: string;
};

export async function listCategories(): Promise<Category[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("categories")
    .select("id, slug, name_th, name_en, icon, type")
    .order("type")
    .order("sort_order");

  if (error) {
    throw new ServiceError("query_failed", error.message);
  }

  return (data ?? []) as Category[];
}

export async function listTransactions(
  range: TransactionFilterRange,
  limit = 100,
): Promise<TransactionRow[]> {
  const { supabase, userId } = await requireClient();

  const { data, error } = await supabase
    .from("transactions")
    .select(transactionSelect)
    .eq("user_id", userId)
    .gte("transaction_date", range.from)
    .lte("transaction_date", range.to)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new ServiceError("query_failed", error.message);
  }

  return (data ?? []) as unknown as TransactionRow[];
}

// Totals + breakdown come from a PostgreSQL aggregate (dashboard_summary)
// so results are exact at any volume; the recent list is a small paged query.
export async function getDashboardData(
  range: TransactionFilterRange,
): Promise<DashboardData> {
  const { supabase } = await requireClient();

  const { data: summary, error: summaryError } = await supabase.rpc(
    "dashboard_summary",
    { p_from: range.from, p_to: range.to },
  );

  if (summaryError) {
    throw new ServiceError("query_failed", summaryError.message);
  }

  // Scalar-return functions come back unwrapped; be tolerant of either shape.
  const value = Array.isArray(summary) ? summary[0] : summary;
  const parsed = value as unknown as {
    totals: { income: number; expense: number; net: number };
    byCategory: CategoryTotal[];
    dailyTotals: { date: string; expense: number }[];
  } | null;

  const recent = await listTransactions(range, 10);

  return {
    totals: parsed?.totals ?? { income: 0, expense: 0, net: 0 },
    byCategory: parsed?.byCategory ?? [],
    dailyTotals: parsed?.dailyTotals ?? [],
    recent,
  };
}

export async function createTransaction(input: CreateTransactionInput) {
  const { supabase, userId } = await requireClient();

  const { data: category } = await supabase
    .from("categories")
    .select("id, type")
    .eq("slug", input.category)
    .single();

  if (!category) {
    throw new ServiceError("category_not_found");
  }
  if (category.type !== input.type) {
    throw new ServiceError("category_type_mismatch");
  }

  const { data, error } = await supabase
    .from("transactions")
    .insert({
      user_id: userId,
      type: input.type,
      amount: input.amount,
      category_id: category.id,
      description: input.description,
      transaction_date: input.date ?? todayISO(),
      source: "web",
    })
    .select(transactionSelect)
    .single();

  if (error) {
    throw new ServiceError("insert_failed", error.message);
  }

  return data as unknown as TransactionRow;
}
