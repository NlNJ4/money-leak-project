import { NextResponse } from "next/server";
import { handleServiceError } from "@/app/api/transactions/http";
import { exportMyData } from "@/lib/account";

// Personal-data export: everything the account owns as one JSON file.
export async function GET() {
  try {
    const data = await exportMyData();
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="my-finance-data.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleServiceError(err);
  }
}
