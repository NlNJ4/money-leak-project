import { NextResponse, type NextRequest } from "next/server";
import { handleServiceError } from "@/app/api/transactions/http";
import {
  createCustomCategory,
  customCategorySchema,
} from "@/lib/custom-categories";
import { listCategories } from "@/lib/transactions";

export async function GET() {
  try {
    const data = await listCategories();
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

  const parsed = customCategorySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    await createCustomCategory(parsed.data);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return handleServiceError(err);
  }
}
