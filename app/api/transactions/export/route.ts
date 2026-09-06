import { NextResponse, type NextRequest } from "next/server";
import { handleServiceError } from "@/app/api/transactions/http";
import {
  listHistory,
  parseHistoryCursor,
} from "@/lib/transactions";
import { getAuthContext } from "@/lib/supabase/server";
import { ServiceError } from "@/lib/transactions";
import { historyFilterSchema } from "@/lib/validation";

// CSV export, STREAMED: rows are fetched cursor-page by cursor-page and
// encoded incrementally, so a 50k-row export never buffers the whole
// payload in memory. Pages stay BELOW Supabase's 1,000-row response cap so
// listHistory's look-ahead row survives and cursors keep flowing — a
// 1,000-row page silently drops the look-ahead and truncates at 1,000.

const MAX_EXPORT_ROWS = 50_000;
const PAGE_SIZE = 999;

function csvCell(value: string | number | null | undefined): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = historyFilterSchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_range", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const auth = await getAuthContext();
    if (!auth) throw new ServiceError("unauthorized");

    const filters = {
      range: { from: parsed.data.from, to: parsed.data.to },
      type: parsed.data.type,
      category: parsed.data.category,
      source: parsed.data.source,
      q: parsed.data.q,
    };

    // Exact count up front so the truncation header is accurate even
    // though headers are sent before the body streams.
    const { count } = await auth.supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", auth.userId)
      .gte("transaction_date", filters.range.from)
      .lte("transaction_date", filters.range.to);
    const truncated = (count ?? 0) > MAX_EXPORT_ROWS;

    const filename = `transactions-${filters.range.from}_${filters.range.to}.csv`;
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          // UTF-8 BOM so Excel renders Thai text correctly.
          controller.enqueue(
            encoder.encode(
              `\uFEFFdate,type,category,description,amount,source\r\n`,
            ),
          );

          let emitted = 0;
          let cursor = parseHistoryCursor(params.cursor);

          while (emitted < MAX_EXPORT_ROWS) {
            const page = await listHistory(
              filters,
              cursor,
              Math.min(PAGE_SIZE, MAX_EXPORT_ROWS - emitted),
            );

            let chunk = "";
            for (const row of page.rows) {
              chunk += [
                row.transaction_date,
                row.type,
                row.category?.slug ?? "",
                row.description,
                Number(row.amount),
                row.source,
              ]
                .map(csvCell)
                .join(",");
              chunk += "\r\n";
              emitted += 1;
            }
            if (chunk) controller.enqueue(encoder.encode(chunk));

            if (!page.nextCursor) {
              break;
            }
            cursor = page.nextCursor;
            if (emitted >= MAX_EXPORT_ROWS) break;
          }

          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Rows-Truncated": truncated ? "1" : "0",
      },
    });
  } catch (err) {
    return handleServiceError(err);
  }
}
