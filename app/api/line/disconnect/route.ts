import { NextResponse } from "next/server";
import { handleServiceError } from "@/app/api/transactions/http";
import { disconnectLine } from "@/lib/line-account";

export async function POST() {
  try {
    await disconnectLine();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleServiceError(err);
  }
}
