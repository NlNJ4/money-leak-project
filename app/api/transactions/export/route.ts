import { NextResponse, type NextRequest } from "next/server";
import { handleServiceError } from "@/app/api/transactions/http";
import { listHistory } from "@/lib/transactions";
import { historyFilterSchema } from "@/lib/validation";

// CSV export of the same filtered view the history page shows. Capped to
// keep the response bounded; a personal ledger will never approach it.
const MAX_EXPORT_ROWS = 5000;

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
    const { rows } = await listHistory(
      {
        range: { from: parsed.data.from, to: parsed.data.to },
        type: parsed.data.type,
        category: parsed.data.category,
        source: parsed.data.source,
        q: parsed.data.q,
      },
      undefined,
      MAX_EXPORT_ROWS,
    );

    const header = ["date", "type", "category", "description", "amount", "source"];
    const lines = [header.join(",")];
    for (const row of rows) {
      lines.push(
        [
          row.transaction_date,
          row.type,
          row.category?.slug ?? "",
          row.description,
          Number(row.amount),
          row.source,
        ]
          .map(csvCell)
          .join(","),
      );
    }

    // UTF-8 BOM so Excel renders Thai text correctly.
    const csv = `\uFEFF${lines.join("\r\n")}`;
    const filename = `transactions-${parsed.data.from}_${parsed.data.to}.csv`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleServiceError(err);
  }
}
