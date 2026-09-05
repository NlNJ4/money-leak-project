import "server-only";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

// Read at call time so tests can point the client at a local mock.
function lineApiBase(): string {
  return process.env.LINE_API_BASE_URL ?? "https://api.line.me/v2/bot";
}
// Bounded so a hung LINE call cannot consume the sweep's function budget.
function lineTimeoutMs(): number {
  return Number(process.env.LINE_TIMEOUT_MS) || 10_000;
}

export type LineMessageEvent = {
  type: "message";
  // LINE puts webhookEventId on each event object, not on the request body.
  webhookEventId?: string;
  replyToken: string;
  timestamp?: number;
  source: { userId?: string };
  message: { type: string; id?: string; text?: string };
};

export type LineWebhookBody = {
  destination?: string;
  events: LineMessageEvent[];
};

// Dedup key for idempotent processing (audit item 4). Preference:
// LINE's webhookEventId → the unique message id → a random key (fail open:
// a rare missed dedup beats falsely blocking saves).
export function buildEventKey(event: LineMessageEvent, index: number): string {
  return (
    event.webhookEventId ??
    event.message.id ??
    `unidentified-${index}-${randomUUID()}`
  );
}

// Deterministic UUID-shaped retry key (LINE's X-Line-Retry-Key). A stable
// key per job means a retried push can never deliver twice: if the original
// request reached LINE, the retry gets 409 and we treat it as delivered.
export function lineRetryKey(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// Reject unsigned/invalid requests before any processing.
export function verifyLineSignature(
  channelSecret: string,
  rawBody: string,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", channelSecret)
    .update(rawBody, "utf8")
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function replyToUser(
  replyToken: string,
  text: string,
  retryKey?: string,
): Promise<void> {
  await postToLine(
    "/message/reply",
    {
      replyToken,
      messages: [{ type: "text", text }],
    },
    retryKey,
  );
}

export async function pushToUser(
  userId: string,
  text: string,
  retryKey?: string,
): Promise<void> {
  await postToLine(
    "/message/push",
    {
      to: userId,
      messages: [{ type: "text", text }],
    },
    retryKey,
  );
}

async function postToLine(
  path: string,
  payload: unknown,
  retryKey?: string,
): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not configured");
  }

  const response = await fetch(`${lineApiBase()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      // Per LINE's guidance: a stable retry key makes re-sent requests
      // idempotent on their side.
      ...(retryKey ? { "X-Line-Retry-Key": retryKey } : {}),
    },
    signal: AbortSignal.timeout(lineTimeoutMs()),
    body: JSON.stringify(payload),
  });

  // 409 with a retry key means the ORIGINAL request was accepted — the
  // message will be (or was) delivered, so this is success, not failure.
  if (response.status === 409 && retryKey) {
    return;
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LINE API ${path} failed: ${response.status} ${detail}`);
  }
}
