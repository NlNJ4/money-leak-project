import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTransaction } from "@/lib/ai/pipeline";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function geminiBody(text: string) {
  return {
    candidates: [{ content: { parts: [{ text }] } }],
  };
}

function stubFetchSequence(responses: Array<{ status: number; body?: unknown }>) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift() ?? { status: 500, body: { error: "unreachable" } };
    return jsonResponse(next.status, next.body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseTransaction pipeline (rule parser → Gemini)", () => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("GEMINI_MODEL", "gemini-3.7-flash");
  vi.stubEnv("GEMINI_FALLBACK_MODEL", "gemini-3.6-flash");
  // Keep the metrics logging out of test output.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});

  it("uses the rule parser alone for a confident shorthand message", async () => {
    const fetchMock = stubFetchSequence([]);

    const result = await parseTransaction("กินข้าว 120");

    expect(result).toEqual({
      type: "expense",
      amount: 120,
      category: "food",
      description: "กินข้าว",
      date: expect.any(String),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("escalates to Gemini when the rules cannot classify the text", async () => {
    const fetchMock = stubFetchSequence([
      {
        status: 200,
        body: geminiBody(
          '{"kind":"transaction","type":"expense","amount":500,"category":"food","description":"กินข้าว","date":"2026-08-27"}',
        ),
      },
    ]);

    // Explicit relative dates are capped below the threshold on purpose.
    const result = await parseTransaction("เมื่อสัปดาห์ก่อนกินข้าว 500");

    expect(result).toEqual({
      type: "expense",
      amount: 500,
      category: "food",
      description: "กินข้าว",
      date: "2026-08-27",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("escalates a bare amount so Gemini decides whether it is a transaction", async () => {
    const fetchMock = stubFetchSequence([
      {
        status: 200,
        body: geminiBody('{"kind":"unknown"}'),
      },
    ]);

    const result = await parseTransaction("120");

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates Gemini failures so the durable job can retry", async () => {
    stubFetchSequence([
      { status: 503, body: {} },
      { status: 503, body: {} },
      { status: 503, body: {} },
      { status: 503, body: {} },
      { status: 503, body: {} },
      { status: 503, body: {} },
    ]);

    await expect(parseTransaction("สวัสดีครับ")).rejects.toThrow();
  });

  it("still parses the roadmap corpus when Gemini is completely unavailable", async () => {
    const fetchMock = stubFetchSequence([]);

    for (const text of [
      "กินข้าว 60",
      "ซื้อโกโก้ปั่น 60 บาท",
      "เติมน้ำมัน 800",
      "จ่ายค่าไฟ 1250",
      "ได้เงินเดือน 30000",
      "ได้เงินคืน 450",
      "เมื่อวานกินข้าว 83",
    ]) {
      const result = await parseTransaction(text);
      expect(result, `corpus message: ${text}`).not.toBeNull();
      expect(result?.amount).toBeGreaterThan(0);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
