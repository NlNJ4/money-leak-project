import "server-only";
import { unstable_cache } from "next/cache";
import { todayISO } from "@/lib/date";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, getAuthContext } from "@/lib/supabase/server";
import type {
  CreateTransactionInput,
  TransactionFilterRange,
  UpdateTransactionInput,
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
  const auth = await getAuthContext();
  if (!auth) {
    throw new ServiceError("unauthorized");
  }
  return auth;
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

const getCachedCategories = unstable_cache(
  async (): Promise<Category[]> => {
    // Categories are shared, read-only reference data. The server-only client
    // lets this cache stay independent of request cookies without exposing the
    // service key or bypassing RLS for any user-owned data.
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("categories")
      .select("id, slug, name_th, name_en, icon, type")
      .order("type")
      .order("sort_order");

    if (error) {
      throw new ServiceError("query_failed", error.message);
    }

    return (data ?? []) as Category[];
  },
  ["dashboard-categories"],
  { revalidate: 3600, tags: ["categories"] },
);

export async function listCategories(): Promise<Category[]> {
  return getCachedCategories();
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

async function queryTransactions(
  supabase: ServerClient,
  userId: string,
  range: TransactionFilterRange,
  limit: number,
): Promise<TransactionRow[]> {
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

export async function listTransactions(
  range: TransactionFilterRange,
  limit = 100,
): Promise<TransactionRow[]> {
  const { supabase, userId } = await requireClient();
  return queryTransactions(supabase, userId, range, limit);
}

// Totals + breakdown come from a PostgreSQL aggregate (dashboard_summary)
// so results are exact at any volume; the recent list is a small paged query.
export async function getDashboardData(
  range: TransactionFilterRange,
): Promise<DashboardData> {
  const { supabase, userId } = await requireClient();

  const [summaryResult, recent] = await Promise.all([
    supabase.rpc("dashboard_summary", {
      p_from: range.from,
      p_to: range.to,
    }),
    queryTransactions(supabase, userId, range, 10),
  ]);

  const { data: summary, error: summaryError } = summaryResult;

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

export async function updateTransaction(
  id: string,
  input: UpdateTransactionInput,
): Promise<TransactionRow> {
  const { supabase } = await requireClient();

  // Fetch the current row first: RLS scopes it to the caller, and merging
  // lets us validate type/category consistency against the final state.
  const { data: current } = await supabase
    .from("transactions")
    .select("id, type, category:categories (slug)")
    .eq("id", id)
    .maybeSingle();

  if (!current) {
    throw new ServiceError("not_found");
  }

  const patch: {
    type?: string;
    amount?: number;
    description?: string;
    transaction_date?: string;
    category_id?: string;
  } = {};

  if (input.amount !== undefined) patch.amount = input.amount;
  if (input.description !== undefined) patch.description = input.description;
  if (input.date !== undefined) patch.transaction_date = input.date;

  const nextType = input.type ?? current.type;
  if (input.type !== undefined) patch.type = input.type;

  if (input.category !== undefined || input.type !== undefined) {
    // A type change re-validates the category; if the caller did not send
    // one, the existing category belongs to the old type and cannot carry
    // over.
    const slug = input.category ?? current.category?.slug;
    if (!slug) {
      throw new ServiceError("category_not_found");
    }

    const { data: category } = await supabase
      .from("categories")
      .select("id, type")
      .eq("slug", slug)
      .single();

    if (!category) {
      throw new ServiceError("category_not_found");
    }
    if (category.type !== nextType) {
      throw new ServiceError("category_type_mismatch");
    }

    patch.category_id = category.id;
  }

  const { data, error } = await supabase
    .from("transactions")
    .update(patch)
    .eq("id", id)
    .select(transactionSelect)
    .single();

  if (error || !data) {
    throw new ServiceError("update_failed", error?.message);
  }

  return data as unknown as TransactionRow;
}

export async function deleteTransaction(id: string): Promise<void> {
  const { supabase } = await requireClient();

  const { data, error } = await supabase
    .from("transactions")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new ServiceError("delete_failed", error.message);
  }
  if (!data) {
    throw new ServiceError("not_found");
  }
}
