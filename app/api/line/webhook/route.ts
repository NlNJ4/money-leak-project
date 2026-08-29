import { after } from "next/server";
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

  const webhookEventId = body.webhookEventId ?? "no-id";

  // Acknowledge immediately and process after responding: LINE recommends
  // async webhook handling, and reply tokens expire quickly (audit item 8).
  const jobs = (body.events ?? []).map((event, index) => async () => {
    if (
      event.type !== "message" ||
      event.message.type !== "text" ||
      !event.message.text
    ) {
      return;
    }

    // Per-event dedup key: LINE recommends using the event id to detect
    // redelivered webhooks (audit item 4).
    const eventKey = `${webhookEventId}:${event.id ?? index}`;

    let reply: string;
    try {
      reply = await handleLineMessage(
        event.source.userId ?? "",
        event.message.text,
        eventKey,
      );
    } catch (err) {
      console.error("[line webhook]", err);
      reply = "เกิดข้อผิดพลาดครับ ลองใหม่อีกครั้งนะครับ";
    }

    try {
      await replyToUser(event.replyToken, reply);
    } catch (err) {
      console.error("[line reply]", err);
    }
  });

  after(async () => {
    for (const job of jobs) {
      await job();
    }
  });

  // Always 200 so LINE does not retry-deliver already-handled events.
  return Response.json({ ok: true });
}
