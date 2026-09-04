import { NextResponse, type NextRequest } from "next/server";
import { handleServiceError } from "@/app/api/transactions/http";
import {
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
