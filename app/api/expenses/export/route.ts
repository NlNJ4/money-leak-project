import {
  buildExpensesCsv,
  getExpensesCsvFilename,
} from "@/lib/csv-export";
import { listExpenses } from "@/lib/expense-service";
import {
  getRequestAccessToken,
  getSingleUrlSearchParam,
  hasLineUserDataAccess,
  normalizeLineUserId,
} from "@/lib/security";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const EXPORT_EXPENSE_LIMIT = 1_000;

export async function GET(request: NextRequest) {
  const lineUserIdParam = getSingleUrlSearchParam(
    request.nextUrl.searchParams,
    "lineUserId",
  );

  if (lineUserIdParam === null) {
    return NextResponse.json({ error: "Invalid lineUserId" }, { status: 400 });
  }

  const lineUserId = normalizeLineUserId(lineUserIdParam);

  if (!lineUserId) {
    return NextResponse.json({ error: "Invalid lineUserId" }, { status: 400 });
  }

  if (
    !hasLineUserDataAccess({
      lineUserId,
      accessToken: getRequestAccessToken(request),
    })
  ) {
    return NextResponse.json(
      { error: "Private dashboard access token is required" },
      { status: 401 },
    );
  }

  const expenses = await listExpenses(lineUserId, {
    limit: EXPORT_EXPENSE_LIMIT,
  });
  const filename = getExpensesCsvFilename(lineUserId);

  return new NextResponse(`\uFEFF${buildExpensesCsv(expenses)}`, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/csv; charset=utf-8",
      Pragma: "no-cache",
    },
  });
}
