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
  recent: TransactionRow[];
  count: number;
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

// Personal-scale MVP: one range query, aggregate in JS. Move to SQL/RPC
// if a user's volume ever makes this slow.
export async function getDashboardData(
  range: TransactionFilterRange,
): Promise<DashboardData> {
  const rows = await listTransactions(range, 500);

  let income = 0;
  let expense = 0;
  const categoryTotals = new Map<string, CategoryTotal>();

  for (const row of rows) {
    const amount = Number(row.amount);
    if (row.type === "income") {
      income += amount;
    } else if (row.type === "expense") {
      expense += amount;
    }

    if (row.category && row.type !== "transfer") {
      const key = `${row.type}:${row.category.slug}`;
      const existing = categoryTotals.get(key);
      if (existing) {
        existing.total += amount;
      } else {
        categoryTotals.set(key, {
          slug: row.category.slug,
          icon: row.category.icon,
          name_th: row.category.name_th,
          name_en: row.category.name_en,
          type: row.type,
          total: amount,
        });
      }
    }
  }

  const byCategory = [...categoryTotals.values()].sort(
    (a, b) => b.total - a.total,
  );

  return {
    totals: { income, expense, net: income - expense },
    byCategory,
    recent: rows.slice(0, 10),
    count: rows.length,
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
