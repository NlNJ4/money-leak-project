import { NextResponse, type NextRequest } from "next/server";
import { handleServiceError } from "@/app/api/transactions/http";
import {
  deleteTransaction,
  updateTransaction,
} from "@/lib/transactions";
import { idParamSchema, updateTransactionSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  if (!idParamSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = updateTransactionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const data = await updateTransaction(id, parsed.data);
    return NextResponse.json({ data });
  } catch (err) {
    return handleServiceError(err);
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  if (!idParamSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  try {
    await deleteTransaction(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleServiceError(err);
  }
}
