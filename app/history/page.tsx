import { HistoryView } from "@/components/history/history-view";
import { yearAgoRange } from "@/lib/date";
import { getAuthContext } from "@/lib/supabase/server";
import { listCategories, listHistory, parseHistoryCursor } from "@/lib/transactions";
import { historyFilterSchema } from "@/lib/validation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const defaults = yearAgoRange();

  const parsed = historyFilterSchema.safeParse({
    from: one("from") ?? defaults.from,
    to: one("to") ?? defaults.to,
    type: one("type") || undefined,
    category: one("category") || undefined,
    source: one("source") || undefined,
    q: one("q") || undefined,
  });

  const filters = parsed.success
    ? parsed.data
    : { from: defaults.from, to: defaults.to };

  const cursor = parseHistoryCursor(one("cursor"));

  const [auth, categories, page] = await Promise.all([
    getAuthContext(),
    listCategories(),
    listHistory(
      {
        range: { from: filters.from, to: filters.to },
        type: parsed.success ? filters.type : undefined,
        category: parsed.success ? filters.category : undefined,
        source: parsed.success ? filters.source : undefined,
        q: parsed.success ? filters.q : undefined,
      },
      cursor,
      20,
    ),
  ]);

  return (
    <HistoryView
      rows={page.rows}
      nextCursor={page.nextCursor}
      categories={categories}
      filters={{
        from: filters.from,
        to: filters.to,
        type: parsed.success ? filters.type : undefined,
        category: parsed.success ? filters.category : undefined,
        source: parsed.success ? filters.source : undefined,
        q: parsed.success ? filters.q : undefined,
      }}
      displayName={auth?.displayName ?? ""}
    />
  );
}
