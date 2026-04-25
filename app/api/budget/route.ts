import { getBudget, updateBudget } from "@/lib/expense-service";
import {
  MAX_JSON_BODY_BYTES,
  RequestBodyTooLargeError,
  getRequestAccessToken,
  getSingleUrlSearchParam,
  hasLineUserDataAccess,
  normalizeLineUserId,
  readRequestTextWithLimit,
} from "@/lib/security";
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

function toOptionalInteger(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;

  return typeof value === "number" ? value : Number(value);
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

  return NextResponse.json({ budget: await getBudget(lineUserId) });
}

export async function PATCH(request: Request) {
  const { body, response } = await readJsonBody(request);

  if (response) return response;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const lineUserId = getBodyLineUserId(body);

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
    const budget = await updateBudget(lineUserId, {
      dailyBudgetBaht: toOptionalInteger(body.dailyBudgetBaht),
      monthlyBudgetBaht: toOptionalInteger(body.monthlyBudgetBaht),
    });

    return NextResponse.json({ budget });
  } catch {
    return NextResponse.json(
      { error: "Unable to update budget from the provided input" },
      { status: 400 },
    );
  }
}
