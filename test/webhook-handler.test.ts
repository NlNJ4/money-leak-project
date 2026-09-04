import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

// The webhook handler is thin by design: verify signature, enqueue
// durably, defer processing. Those three collaborators are mocked here;
// the real chain lives in test-integration/line-flow.test.ts.

const flushAfter = vi.fn();
vi.mock("next/server", () => ({
  after: (fn: () => Promise<void>) => {
    flushAfter.mockImplementation(() => fn());
  },
}));

const enqueueLineJobs = vi.fn();
const processDueLineJobs = vi.fn();
vi.mock("@/lib/line-jobs", () => ({
  enqueueLineJobs: (...args: unknown[]) => enqueueLineJobs(...args),
  processDueLineJobs: (...args: unknown[]) => processDueLineJobs(...args),
}));

import { POST } from "@/app/api/line/webhook/route";

const SECRET = "webhook-unit-secret";

function signedRequest(body: unknown, secret = SECRET, signatureOverride?: string) {
  const raw = JSON.stringify(body);
  const signature =
    signatureOverride ??
    createHmac("sha256", secret).update(raw).digest("base64");
  return new Request("http://localhost/api/line/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-line-signature": signature,
    },
    body: raw,
  }) as unknown as Parameters<typeof POST>[0];
}

const textEvent = (id: string, text: string, timestamp = 1_700_000_000_000) => ({
  type: "message",
  webhookEventId: id,
  replyToken: "tok",
  timestamp,
  source: { userId: "U-unit" },
  message: { type: "text", id: `msg-${id}`, text },
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/line/webhook", () => {
  vi.stubEnv("LINE_CHANNEL_SECRET", SECRET);

  it("rejects an invalid signature with 401 before enqueueing", async () => {
    const response = await POST(
      signedRequest({ events: [textEvent("evt-1", "กินข้าว 120")] }, SECRET, "bogus=="),
    );
    expect(response.status).toBe(401);
    expect(enqueueLineJobs).not.toHaveBeenCalled();
  });

  it("enqueues text events with ordering data and acknowledges 200", async () => {
    const response = await POST(
      signedRequest({
        events: [textEvent("evt-2", "กินข้าว 120", 123), textEvent("evt-3", "ลบล่าสุด", 456)],
      }),
    );
    expect(response.status).toBe(200);
    expect(enqueueLineJobs).toHaveBeenCalledTimes(1);

    const events = enqueueLineJobs.mock.calls[0][0];
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      eventKey: "evt-2",
      lineUserId: "U-unit",
      lineTimestamp: 123,
      batchSeq: 0,
      text: "กินข้าว 120",
    });
    expect(events[1]).toMatchObject({ eventKey: "evt-3", batchSeq: 1 });

    // Processing is deferred until after the response.
    expect(processDueLineJobs).not.toHaveBeenCalled();
    await flushAfter();
    expect(processDueLineJobs).toHaveBeenCalledTimes(1);
  });

  it("skips non-text events entirely", async () => {
    const response = await POST(
      signedRequest({
        events: [
          {
            type: "message",
            replyToken: "tok",
            source: { userId: "U-unit" },
            message: { type: "image", id: "img-1" },
          },
        ],
      }),
    );
    expect(response.status).toBe(200);
    expect(enqueueLineJobs).toHaveBeenCalledWith([]);
  });

  it("returns 500 on enqueue failure so LINE redelivers", async () => {
    enqueueLineJobs.mockRejectedValueOnce(new Error("db down"));
    const response = await POST(
      signedRequest({ events: [textEvent("evt-4", "กินข้าว 120")] }),
    );
    expect(response.status).toBe(500);
  });

  it("rejects an unparseable body with 400", async () => {
    const raw = "not json{";
    const signature = createHmac("sha256", SECRET).update(raw).digest("base64");
    const response = await POST(
      new Request("http://localhost/api/line/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-line-signature": signature },
        body: raw,
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(response.status).toBe(400);
  });
});
