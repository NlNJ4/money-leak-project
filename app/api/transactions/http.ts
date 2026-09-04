import { NextResponse } from "next/server";
import { ServiceError } from "@/lib/transactions";

// Shared by /api/transactions and /api/transactions/[id].
export function handleServiceError(err: unknown) {
  if (err instanceof ServiceError) {
    if (err.code === "unauthorized") {
      return NextResponse.json({ error: err.code }, { status: 401 });
    }
    if (err.code === "not_found") {
      return NextResponse.json({ error: err.code }, { status: 404 });
    }
    const status =
      err.code.startsWith("category") ||
      err.code === "insert_failed" ||
      err.code === "update_failed"
        ? 400
        : 500;
    return NextResponse.json({ error: err.code }, { status });
  }
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}
