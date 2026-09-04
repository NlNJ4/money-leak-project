import { NextResponse, type NextRequest } from "next/server";
import { handleServiceError } from "@/app/api/transactions/http";
import {
  listHistory,
  parseHistoryCursor,
} from "@/lib/transactions";
import { historyFilterSchema } from "@/lib/validation";

// Cursor-paginated, faceted listing for the history page's "load more".
// GET /api/transactions?from&to&type&category&source&q&cursor
export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams);

  const parsed = historyFilterSchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_range", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const cursor = parseHistoryCursor(params.cursor);
  if (params.cursor && !cursor) {
    return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
  }

  try {
    const page = await listHistory(
      {
        range: { from: parsed.data.from, to: parsed.data.to },
        type: parsed.data.type,
        category: parsed.data.category,
        source: parsed.data.source,
        q: parsed.data.q,
      },
      cursor,
    );
    return NextResponse.json({ data: page.rows, nextCursor: page.nextCursor });
  } catch (err) {
    return handleServiceError(err);
  }
}
