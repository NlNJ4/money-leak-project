import type {
  HistoryCursor,
  HistoryPageData,
  HistoryRow,
} from "@/lib/transactions";

export const MAX_EXPORT_ROWS = 5_000;
// listHistory requests one look-ahead row. Keeping the page below Supabase's
// hosted 1,000-row response cap preserves that row and therefore nextCursor.
export const EXPORT_PAGE_SIZE = 999;

type HistoryPageLoader = (
  cursor: HistoryCursor | undefined,
  limit: number,
) => Promise<HistoryPageData>;

export type CollectHistoryResult = {
  rows: HistoryRow[];
  // True when pagination was cut short by the row cap (more data exists).
  truncated: boolean;
};

export async function collectHistoryRows(
  loadPage: HistoryPageLoader,
  maxRows = MAX_EXPORT_ROWS,
  pageSize = EXPORT_PAGE_SIZE,
): Promise<CollectHistoryResult> {
  const rows: HistoryRow[] = [];
  const seenCursors = new Set<string>();
  let cursor: HistoryCursor | undefined;
  // The most recent server answer: non-null here means more data existed
  // when we stopped, i.e. the row cap truncated the export.
  let latestNext: HistoryCursor | null = null;

  while (rows.length < maxRows) {
    const limit = Math.min(pageSize, maxRows - rows.length);
    const page = await loadPage(cursor, limit);
    rows.push(...page.rows.slice(0, limit));
    latestNext = page.nextCursor ?? null;

    if (!page.nextCursor || page.rows.length === 0) break;

    const cursorKey = `${page.nextCursor.createdAt}|${page.nextCursor.id}`;
    if (seenCursors.has(cursorKey)) break;
    seenCursors.add(cursorKey);
    cursor = page.nextCursor;
  }

  return { rows, truncated: latestNext !== null };
}
