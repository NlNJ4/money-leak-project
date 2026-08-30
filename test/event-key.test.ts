import { describe, expect, it } from "vitest";
import { buildEventKey, type LineMessageEvent } from "@/lib/line";

const baseEvent: LineMessageEvent = {
  type: "message",
  replyToken: "token",
  source: { userId: "U123" },
  message: { type: "text", text: "กินข้าว 120" },
};

describe("buildEventKey (webhook dedup)", () => {
  it("prefers the per-event LINE webhookEventId", () => {
    const key = buildEventKey(
      { ...baseEvent, webhookEventId: "webhook-event-1" },
      0,
    );
    expect(key).toBe("webhook-event-1");
  });

  it("falls back to the unique message id", () => {
    const key = buildEventKey(
      { ...baseEvent, message: { type: "text", id: "msg-42", text: "x" } },
      0,
    );
    expect(key).toBe("msg-42");
  });

  it("generates a distinct random key when neither exists (fail open)", () => {
    const a = buildEventKey(baseEvent, 0);
    const b = buildEventKey(baseEvent, 0);
    expect(a).toMatch(/^unidentified-/);
    expect(b).toMatch(/^unidentified-/);
    expect(a).not.toBe(b);
  });
});
