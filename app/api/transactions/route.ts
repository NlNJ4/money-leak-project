import { NextResponse, type NextRequest } from "next/server";
import {
  ServiceError,
  createTransaction,
  listTransactions,
} from "@/lib/transactions";
import {
  createTransactionSchema,
  transactionFilterSchema,
} from "@/lib/validation";

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams);

  const parsed = transactionFilterSchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_range", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const data = await listTransactions(parsed.data);
    return NextResponse.json({ data });
  } catch (err) {
    return handleServiceError(err);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = createTransactionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const data = await createTransaction(parsed.data);
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return handleServiceError(err);
  }
}

function handleServiceError(err: unknown) {
  if (err instanceof ServiceError) {
    if (err.code === "unauthorized") {
      return NextResponse.json({ error: err.code }, { status: 401 });
    }
    const status = err.code.startsWith("category") || err.code === "insert_failed"
      ? 400
      : 500;
    return NextResponse.json({ error: err.code }, { status });
  }
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}
