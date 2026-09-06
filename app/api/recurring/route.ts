import { NextResponse, type NextRequest } from "next/server";
import { handleServiceError } from "@/app/api/transactions/http";
import {
  createRecurring,
  listRecurring,
  recurringCreateSchema,
} from "@/lib/recurring";

export async function GET() {
  try {
    const data = await listRecurring();
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

  const parsed = recurringCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    await createRecurring(parsed.data);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return handleServiceError(err);
  }
}
