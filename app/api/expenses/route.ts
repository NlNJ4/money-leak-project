import { categoryOrder } from "@/lib/categories";
import {
  DEMO_LINE_USER_ID,
  createExpense,
  listExpenses,
} from "@/lib/expense-service";
import { detectCategory, parseExpenseText } from "@/lib/parser";
import type { ExpenseCategory } from "@/lib/types";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return (
    typeof value === "string" &&
    categoryOrder.includes(value as ExpenseCategory)
  );
}

export function GET(request: NextRequest) {
  const lineUserId =
    request.nextUrl.searchParams.get("lineUserId") ?? DEMO_LINE_USER_ID;

  return NextResponse.json({
    dataMode: lineUserId === DEMO_LINE_USER_ID ? "demo" : "user",
    expenses: listExpenses(lineUserId),
  });
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const lineUserId =
    typeof body.lineUserId === "string" && body.lineUserId.trim()
      ? body.lineUserId.trim()
      : DEMO_LINE_USER_ID;

  try {
    if (typeof body.text === "string") {
      const parsed = parseExpenseText(body.text);

      if (!parsed) {
        return NextResponse.json(
          { error: "Text must match an expense format such as 'ชานม 45'" },
          { status: 400 },
        );
      }

      const expense = createExpense({ lineUserId, ...parsed });

      return NextResponse.json({ expense }, { status: 201 });
    }

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const amountBaht =
      typeof body.amountBaht === "number"
        ? body.amountBaht
        : Number(body.amountBaht);
    const category = isExpenseCategory(body.category)
      ? body.category
      : detectCategory(title);
    const expense = createExpense({
      lineUserId,
      title,
      amountBaht,
      category,
    });

    return NextResponse.json({ expense }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Unable to create expense from the provided input" },
      { status: 400 },
    );
  }
}
