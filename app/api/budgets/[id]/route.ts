import { NextResponse, type NextRequest } from "next/server";
import { handleServiceError } from "@/app/api/transactions/http";
import { deleteBudget } from "@/lib/budgets";
import { idParamSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!idParamSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  try {
    await deleteBudget(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleServiceError(err);
  }
}
