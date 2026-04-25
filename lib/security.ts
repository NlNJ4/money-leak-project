import { createHmac, timingSafeEqual } from "node:crypto";
import { DEMO_LINE_USER_ID } from "@/lib/constants";

export const MAX_EXPENSE_AMOUNT_BAHT = 1_000_000;
export const MAX_EXPENSE_TITLE_LENGTH = 100;
export const MAX_JSON_BODY_BYTES = 16 * 1024;
export const MAX_LINE_EVENTS = 20;
export const MAX_LINE_TEXT_LENGTH = 500;
export const MAX_LINE_WEBHOOK_BODY_BYTES = 64 * 1024;

const MAX_RATE_LIMIT_KEYS = 5_000;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60_000;
const LINE_USER_ID_PATTERN = /^U[a-f0-9]{32}$/i;
const DASHBOARD_ACCESS_TOKEN_PARAM = "accessToken";
const DASHBOARD_TOKEN_VERSION = "v2";
const DASHBOARD_ACCESS_TOKEN_DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export type SearchParamValue = string | string[] | undefined;

const globalForSecurity = globalThis as typeof globalThis & {
  __moneyLeakLastRateLimitCleanupAt?: number;
  __moneyLeakRateLimits?: Map<string, RateLimitEntry>;
};

export class RequestBodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body must be ${maxBytes} bytes or smaller`);
  }
}

export function isValidLineUserId(lineUserId: string) {
  return (
    lineUserId === DEMO_LINE_USER_ID || LINE_USER_ID_PATTERN.test(lineUserId)
  );
}

export function normalizeLineUserId(
  value: string | null | undefined,
  fallback = DEMO_LINE_USER_ID,
) {
  const candidate = value?.trim();

  if (!candidate) return fallback;

  return isValidLineUserId(candidate) ? candidate : null;
}

export function getDashboardAccessSecret() {
  return process.env.DASHBOARD_ACCESS_TOKEN?.trim() || null;
}

function getDashboardAccessTokenTtlSeconds() {
  const value = Number(process.env.DASHBOARD_ACCESS_TOKEN_TTL_SECONDS);

  if (!Number.isFinite(value) || value <= 0) {
    return DASHBOARD_ACCESS_TOKEN_DEFAULT_TTL_SECONDS;
  }

  return Math.min(Math.trunc(value), DASHBOARD_ACCESS_TOKEN_DEFAULT_TTL_SECONDS);
}

export function getSingleSearchParam(value: SearchParamValue) {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;

  return null;
}

export function getSingleUrlSearchParam(
  searchParams: URLSearchParams,
  key: string,
) {
  const values = searchParams.getAll(key);

  if (values.length === 0) return undefined;
  if (values.length === 1) return values[0];

  return null;
}

export function getRequestAccessToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim();

  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice("bearer ".length).trim();
    if (token) return token;
  }

  const headerToken = request.headers
    .get("x-money-leak-access-token")
    ?.trim();

  if (headerToken) return headerToken;

  try {
    const accessToken = getSingleUrlSearchParam(
      new URL(request.url).searchParams,
      DASHBOARD_ACCESS_TOKEN_PARAM,
    );

    return accessToken ?? null;
  } catch {
    return null;
  }
}

export function createDashboardAccessToken(lineUserId: string) {
  const secret = getDashboardAccessSecret();

  if (!secret || !isValidLineUserId(lineUserId)) return null;

  const expiresAt =
    Math.floor(Date.now() / 1000) + getDashboardAccessTokenTtlSeconds();
  const payload = `${DASHBOARD_TOKEN_VERSION}:${lineUserId}:${expiresAt}`;
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  return `${DASHBOARD_TOKEN_VERSION}.${expiresAt}.${signature}`;
}

export function appendDashboardAccessToken(url: URL, lineUserId: string) {
  const accessToken = createDashboardAccessToken(lineUserId);

  if (accessToken) {
    url.searchParams.set(DASHBOARD_ACCESS_TOKEN_PARAM, accessToken);
  }
}

export function hasLineUserDataAccess({
  lineUserId,
  accessToken,
}: {
  lineUserId: string;
  accessToken: string | null | undefined;
}) {
  if (lineUserId === DEMO_LINE_USER_ID) return true;

  const secret = getDashboardAccessSecret();

  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }

  if (!accessToken) return false;

  return verifyDashboardAccessToken(lineUserId, accessToken);
}

export function isRateLimited(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
) {
  const now = Date.now();
  const store = getRateLimitStore();
  pruneRateLimitStore(store, now);

  const current = store.get(key);

  if (!current || current.resetAt <= now) {
    if (store.size >= MAX_RATE_LIMIT_KEYS) return true;

    store.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  current.count += 1;

  return current.count > limit;
}

export async function readRequestTextWithLimit(
  request: Request,
  maxBytes: number,
) {
  const contentLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestBodyTooLargeError(maxBytes);
  }

  if (!request.body) {
    const text = await request.text();

    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes);
    }

    return text;
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    bytesRead += value.byteLength;

    if (bytesRead > maxBytes) {
      await reader.cancel();
      throw new RequestBodyTooLargeError(maxBytes);
    }

    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function getRateLimitStore() {
  if (!globalForSecurity.__moneyLeakRateLimits) {
    globalForSecurity.__moneyLeakRateLimits = new Map();
  }

  return globalForSecurity.__moneyLeakRateLimits;
}

function pruneRateLimitStore(store: Map<string, RateLimitEntry>, now: number) {
  const lastCleanupAt = globalForSecurity.__moneyLeakLastRateLimitCleanupAt ?? 0;

  if (now - lastCleanupAt < RATE_LIMIT_CLEANUP_INTERVAL_MS) return;

  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }

  globalForSecurity.__moneyLeakLastRateLimitCleanupAt = now;
}

function verifyDashboardAccessToken(lineUserId: string, accessToken: string) {
  const secret = getDashboardAccessSecret();
  const tokenParts = accessToken.split(".");

  if (tokenParts.length !== 3) return false;

  const [version, expiresAtValue, receivedSignature] = tokenParts;
  const expiresAt = Number(expiresAtValue);

  if (
    !secret ||
    version !== DASHBOARD_TOKEN_VERSION ||
    !Number.isInteger(expiresAt) ||
    expiresAt <= Math.floor(Date.now() / 1000) ||
    !receivedSignature
  ) {
    return false;
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(`${DASHBOARD_TOKEN_VERSION}:${lineUserId}:${expiresAt}`)
    .digest("base64url");

  return safeEqual(receivedSignature, expectedSignature);
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) return false;

  return timingSafeEqual(leftBuffer, rightBuffer);
}
