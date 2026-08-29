import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const LINE_API_BASE = "https://api.line.me/v2/bot";

export type LineMessageEvent = {
  type: "message";
  replyToken: string;
  source: { userId?: string };
  message: { type: string; text?: string };
};

export type LineWebhookBody = {
  destination?: string;
  events: LineMessageEvent[];
};

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
): Promise<void> {
  await postToLine("/message/reply", {
    replyToken,
    messages: [{ type: "text", text }],
  });
}

export async function pushToUser(
  userId: string,
  text: string,
): Promise<void> {
  await postToLine("/message/push", {
    to: userId,
    messages: [{ type: "text", text }],
  });
}

async function postToLine(path: string, payload: unknown): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not configured");
  }

  const response = await fetch(`${LINE_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`LINE API ${path} failed: ${response.status} ${detail}`);
  }
}
