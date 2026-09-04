import { describe, expect, it } from "vitest";
import {
  collectHistoryRows,
  EXPORT_PAGE_SIZE,
  MAX_EXPORT_ROWS,
} from "@/lib/history-export";
import type {
  HistoryCursor,
  HistoryPageData,
  HistoryRow,
} from "@/lib/transactions";

function row(index: number): HistoryRow {
  return {
    id: String(index),
    type: "expense",
    amount: index,
    description: `row-${index}`,
    transaction_date: "2026-09-04",
    source: "web",
    created_at: new Date(index).toISOString(),
    category: null,
  };
}

function hostedPageLoader(total: number, requested: number[]) {
  return async (
    cursor: HistoryCursor | undefined,
    limit: number,
  ): Promise<HistoryPageData> => {
    requested.push(limit);
    const start = cursor ? Number(cursor.id) : 0;
    // Supabase returns at most 1,000 rows even if limit + 1 asks for more.
    const fetched = Array.from(
      { length: Math.min(limit + 1, 1_000, total - start) },
      (_, offset) => row(start + offset),
    );
    const hasMore = fetched.length > limit;
    const rows = hasMore ? fetched.slice(0, limit) : fetched;
    const next = start + rows.length;
    return {
      rows,
      nextCursor: hasMore
        ? { createdAt: new Date(next).toISOString(), id: String(next) }
        : null,
    };
  };
}

describe("collectHistoryRows", () => {
  it("keeps the look-ahead row below Supabase's 1,000-row cap", async () => {
    const requested: number[] = [];
    const rows = await collectHistoryRows(hostedPageLoader(1_500, requested));

    expect(rows).toHaveLength(1_500);
    expect(requested.every((limit) => limit <= EXPORT_PAGE_SIZE)).toBe(true);
  });

  it("stops exactly at the export cap without overshooting", async () => {
    const requested: number[] = [];
    const rows = await collectHistoryRows(hostedPageLoader(6_000, requested));

    expect(rows).toHaveLength(MAX_EXPORT_ROWS);
    expect(requested.at(-1)).toBe(5);
  });
});
