import { NextResponse, type NextRequest } from "next/server";
import { handleServiceError } from "@/app/api/transactions/http";
import { budgetSchema, getBudgetProgress, upsertBudget } from "@/lib/budgets";
import { monthRange } from "@/lib/date";

export async function GET(request: NextRequest) {
  const month = request.nextUrl.searchParams.get("month");
  try {
    const data = await getBudgetProgress(month ?? monthRange().from);
    return NextResponse.json({ data });
  } catch (err) {
    return handleServiceError(err);
  }
}

export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = budgetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    await upsertBudget(parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleServiceError(err);
  }
}
