import { getDashboardSummary } from "@/lib/expense-service";
import {
  getRequestAccessToken,
  getSingleUrlSearchParam,
  hasLineUserDataAccess,
  normalizeLineUserId,
} from "@/lib/security";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

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

  return NextResponse.json({
    summary: await getDashboardSummary(lineUserId),
  });
}
