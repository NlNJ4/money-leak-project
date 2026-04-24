import {
  DEMO_LINE_USER_ID,
  getDashboardSummary,
} from "@/lib/expense-service";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const lineUserId =
    request.nextUrl.searchParams.get("lineUserId") ?? DEMO_LINE_USER_ID;

  return NextResponse.json({
    summary: await getDashboardSummary(lineUserId),
  });
}
