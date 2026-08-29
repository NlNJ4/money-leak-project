import type { NextRequest } from "next/server";
import { handleLineMessage } from "@/lib/line-bot";
import { replyToUser, verifyLineSignature, type LineWebhookBody } from "@/lib/line";

export async function POST(request: NextRequest) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  const raw = await request.text();

  if (
    !secret ||
    !verifyLineSignature(secret, raw, request.headers.get("x-line-signature"))
  ) {
    return new Response("invalid signature", { status: 401 });
  }

  let body: LineWebhookBody;
  try {
    body = JSON.parse(raw) as LineWebhookBody;
  } catch {
    return new Response("invalid body", { status: 400 });
  }

  for (const event of body.events ?? []) {
    if (
      event.type !== "message" ||
      event.message.type !== "text" ||
      !event.message.text
    ) {
      continue;
    }

    let reply: string;
    try {
      reply = await handleLineMessage(event.source.userId ?? "", event.message.text);
    } catch (err) {
      console.error("[line webhook]", err);
      reply = "เกิดข้อผิดพลาดครับ ลองใหม่อีกครั้งนะครับ";
    }

    try {
      await replyToUser(event.replyToken, reply);
    } catch (err) {
      console.error("[line reply]", err);
    }
  }

  // Always 200 so LINE does not retry-deliver already-handled events.
  return Response.json({ ok: true });
}
