import { categoryOrder } from "@/lib/categories";
import {
  DEMO_LINE_USER_ID,
  createExpense,
  listExpenses,
} from "@/lib/expense-service";
import { detectCategory, parseExpenseText } from "@/lib/parser";
import {
  MAX_JSON_BODY_BYTES,
  RequestBodyTooLargeError,
  getRequestAccessToken,
  hasLineUserDataAccess,
  normalizeLineUserId,
  readRequestTextWithLimit,
} from "@/lib/security";
import type { ExpenseCategory } from "@/lib/types";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function unauthorizedResponse() {
  return NextResponse.json(
    { error: "Private dashboard access token is required" },
    { status: 401 },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return (
    typeof value === "string" &&
    categoryOrder.includes(value as ExpenseCategory)
  );
}

export async function GET(request: NextRequest) {
  const lineUserId = normalizeLineUserId(
    request.nextUrl.searchParams.get("lineUserId"),
  );

  if (!lineUserId) {
    return NextResponse.json({ error: "Invalid lineUserId" }, { status: 400 });
  }

  if (
    !hasLineUserDataAccess({
      lineUserId,
      accessToken: getRequestAccessToken(request),
    })
  ) {
    return unauthorizedResponse();
  }

  return NextResponse.json({
    dataMode: lineUserId === DEMO_LINE_USER_ID ? "demo" : "user",
    expenses: await listExpenses(lineUserId),
  });
}

export async function POST(request: Request) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json")
  ) {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 },
    );
  }

  let body: unknown;

  try {
    body = JSON.parse(
      await readRequestTextWithLimit(request, MAX_JSON_BODY_BYTES),
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { error: "Request body is too large" },
        { status: 413 },
      );
    }

    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const lineUserId = normalizeLineUserId(
    typeof body.lineUserId === "string" ? body.lineUserId : null,
  );

  if (!lineUserId) {
    return NextResponse.json({ error: "Invalid lineUserId" }, { status: 400 });
  }

  if (
    !hasLineUserDataAccess({
      lineUserId,
      accessToken: getRequestAccessToken(request),
    })
  ) {
    return unauthorizedResponse();
  }

  try {
    if (typeof body.text === "string") {
      const parsed = parseExpenseText(body.text);

      if (!parsed) {
        return NextResponse.json(
          { error: "Text must match an expense format such as 'ชานม 45'" },
          { status: 400 },
        );
      }

      const expense = await createExpense({ lineUserId, ...parsed });

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
    const expense = await createExpense({
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
