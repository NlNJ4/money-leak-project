import { after } from "next/server";
import type { NextRequest } from "next/server";
import {
  buildEventKey,
  verifyLineSignature,
  type LineWebhookBody,
} from "@/lib/line";
import { enqueueLineJobs, processDueLineJobs } from "@/lib/line-jobs";

// after() processing must also fit the function budget (see line-jobs
// SWEEP_BUDGET_MS).
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  const raw = await request.text();

  // Reject unsigned/invalid requests before touching the body.
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

  const events = (body.events ?? [])
    .filter(
      (event) =>
        event.type === "message" &&
        event.message.type === "text" &&
        Boolean(event.message.text),
    )
    .map((event, index) => ({
      eventKey: buildEventKey(event, index),
      lineUserId: event.source.userId ?? "",
      replyToken: event.replyToken,
      text: event.message.text ?? "",
      // Ordering data: the queue never lets a later message from the same
      // user run ahead of this one.
      lineTimestamp: event.timestamp ?? 0,
      batchSeq: index,
    }));

  // Persist durably BEFORE acknowledging. If this write fails we answer 500
  // so LINE redelivers instead of the message being silently lost; the
  // insert dedupes on the event key, so redeliveries are safe.
  try {
    await enqueueLineJobs(events);
  } catch (err) {
    console.error("[line webhook] enqueue failed:", err);
    return new Response("enqueue failed", { status: 500 });
  }

  // Process after responding (reply tokens expire quickly). This pass also
  // sweeps any due retries — every webhook doubles as the retry heartbeat.
  after(async () => {
    try {
      await processDueLineJobs();
    } catch (err) {
      // Jobs stay claimed/pending in the queue; a later webhook recovers them.
      console.error("[line webhook] job processing failed:", err);
    }
  });

  return Response.json({ ok: true });
}
