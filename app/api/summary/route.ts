import {
  getDashboardSummary,
} from "@/lib/expense-service";
import {
  getRequestAccessToken,
  hasLineUserDataAccess,
  normalizeLineUserId,
} from "@/lib/security";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const lineUserId = normalizeLineUserId(
    request.nextUrl.searchParams.get("lineUserId"),
  );

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
