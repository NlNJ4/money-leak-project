import { categoryOrder } from "@/lib/categories";
import {
  DEMO_LINE_USER_ID,
  createExpense,
  deleteExpense,
  listExpenses,
  updateExpense,
} from "@/lib/expense-service";
import { detectCategory, parseExpenseText } from "@/lib/parser";
import {
  MAX_JSON_BODY_BYTES,
  RequestBodyTooLargeError,
  getRequestAccessToken,
  getSingleUrlSearchParam,
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

async function readJsonBody(request: Request) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json")
  ) {
    return {
      body: null,
      response: NextResponse.json(
        { error: "Content-Type must be application/json" },
        { status: 415 },
      ),
    };
  }

  try {
    const body = JSON.parse(
      await readRequestTextWithLimit(request, MAX_JSON_BODY_BYTES),
    ) as unknown;

    if (!isRecord(body)) {
      return {
        body: null,
        response: NextResponse.json(
          { error: "Invalid request body" },
          { status: 400 },
        ),
      };
    }

    return { body, response: null };
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return {
        body: null,
        response: NextResponse.json(
          { error: "Request body is too large" },
          { status: 413 },
        ),
      };
    }

    return {
      body: null,
      response: NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      ),
    };
  }
}

function getBodyLineUserId(body: Record<string, unknown>) {
  return normalizeLineUserId(
    typeof body.lineUserId === "string" ? body.lineUserId : null,
  );
}

function getBodyExpenseId(body: Record<string, unknown>) {
  return typeof body.id === "string" && body.id.trim()
    ? body.id.trim()
    : null;
}

function hasExpenseBodyAccess(request: Request, lineUserId: string) {
  return hasLineUserDataAccess({
    lineUserId,
    accessToken: getRequestAccessToken(request),
  });
}

export async function GET(request: NextRequest) {
  const lineUserIdParam = getSingleUrlSearchParam(
    request.nextUrl.searchParams,
    "lineUserId",
  );

  if (lineUserIdParam === null) {
    return NextResponse.json({ error: "Invalid lineUserId" }, { status: 400 });
  }

  const lineUserId = normalizeLineUserId(lineUserIdParam);

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
  const { body, response } = await readJsonBody(request);

  if (response) return response;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const lineUserId = getBodyLineUserId(body);

  if (!lineUserId) {
    return NextResponse.json({ error: "Invalid lineUserId" }, { status: 400 });
  }

  if (
    !hasExpenseBodyAccess(request, lineUserId)
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

export async function PATCH(request: Request) {
  const { body, response } = await readJsonBody(request);

  if (response) return response;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const lineUserId = getBodyLineUserId(body);

  if (!lineUserId) {
    return NextResponse.json({ error: "Invalid lineUserId" }, { status: 400 });
  }

  if (!hasExpenseBodyAccess(request, lineUserId)) {
    return unauthorizedResponse();
  }

  const expenseId = getBodyExpenseId(body);

  if (!expenseId) {
    return NextResponse.json({ error: "Invalid expense id" }, { status: 400 });
  }

  try {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const amountBaht =
      typeof body.amountBaht === "number"
        ? body.amountBaht
        : Number(body.amountBaht);
    const category = isExpenseCategory(body.category)
      ? body.category
      : detectCategory(title);
    const expense = await updateExpense(lineUserId, expenseId, {
      title,
      amountBaht,
      category,
      isNeed: body.isNeed === true,
    });

    return NextResponse.json({ expense });
  } catch {
    return NextResponse.json(
      { error: "Unable to update expense from the provided input" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const { body, response } = await readJsonBody(request);

  if (response) return response;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const lineUserId = getBodyLineUserId(body);

  if (!lineUserId) {
    return NextResponse.json({ error: "Invalid lineUserId" }, { status: 400 });
  }

  if (!hasExpenseBodyAccess(request, lineUserId)) {
    return unauthorizedResponse();
  }

  const expenseId = getBodyExpenseId(body);

  if (!expenseId) {
    return NextResponse.json({ error: "Invalid expense id" }, { status: 400 });
  }

  try {
    await deleteExpense(lineUserId, expenseId);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Unable to delete expense" },
      { status: 400 },
    );
  }
}
