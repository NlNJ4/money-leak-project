import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiParser } from "@/lib/ai/gemini";

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

describe("GeminiParser.parseTransaction", () => {
  const env = {
    GEMINI_API_KEY: "test-key",
    GEMINI_MODEL: "gemini-3.7-flash",
    GEMINI_FALLBACK_MODEL: "gemini-3.6-flash",
  };

  vi.stubEnv("GEMINI_API_KEY", env.GEMINI_API_KEY);
  vi.stubEnv("GEMINI_MODEL", env.GEMINI_MODEL);
  vi.stubEnv("GEMINI_FALLBACK_MODEL", env.GEMINI_FALLBACK_MODEL);

  it("parses a valid structured response", async () => {
    stubFetchSequence([
      {
        status: 200,
        body: geminiBody(
          '{"kind":"transaction","type":"expense","amount":120,"category":"food","description":"กินข้าว","date":"2026-08-29"}',
        ),
      },
    ]);

    const result = await new GeminiParser().parseTransaction("กินข้าว 120");
    expect(result).toEqual({
      type: "expense",
      amount: 120,
      category: "food",
      description: "กินข้าว",
      date: "2026-08-29",
    });
  });

  it("returns null when the model says unknown", async () => {
    stubFetchSequence([{ status: 200, body: geminiBody('{"kind":"unknown"}') }]);
    expect(await new GeminiParser().parseTransaction("สวัสดี")).toBeNull();
  });

  it("falls back when a model returns an incomplete transaction", async () => {
    stubFetchSequence([
      { status: 200, body: geminiBody('{"kind":"transaction","amount":"lots"}') },
      {
        status: 200,
        body: geminiBody(
          '{"kind":"transaction","type":"expense","amount":120,"category":"food","description":"กินข้าว","date":"2026-08-29"}',
        ),
      },
    ]);
    expect(await new GeminiParser().parseTransaction("กินข้าว 120")).toEqual({
      type: "expense",
      amount: 120,
      category: "food",
      description: "กินข้าว",
      date: "2026-08-29",
    });
  });

  it("falls back to the secondary model when the primary is overloaded (503)", async () => {
    const fetchMock = stubFetchSequence([
      { status: 503, body: { error: "high demand" } },
      { status: 503, body: { error: "high demand" } },
      {
        status: 200,
        body: geminiBody(
          '{"kind":"transaction","type":"income","amount":2000,"category":"other_income","description":"ได้เงิน","date":"2026-08-29"}',
        ),
      },
    ]);

    const result = await new GeminiParser().parseTransaction("ได้เงิน 2000");
    expect(result?.type).toBe("income");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const secondCallModel = (fetchMock.mock.calls[2] as unknown as [string])[0];
    expect(secondCallModel).toContain("gemini-3.6-flash");
  });

  it("throws after all models exhaust their retries", async () => {
    stubFetchSequence([
      { status: 503, body: {} },
      { status: 503, body: {} },
      { status: 503, body: {} },
      { status: 503, body: {} },
      { status: 503, body: {} },
      { status: 503, body: {} },
    ]);
    await expect(new GeminiParser().parseTransaction("กินข้าว 120")).rejects.toThrow();
  });

  it("moves to the next model immediately when free-tier quota returns 429", async () => {
    const fetchMock = stubFetchSequence([
      { status: 429, body: { error: "quota" } },
      {
        status: 200,
        body: geminiBody(
          '{"kind":"transaction","type":"expense","amount":60,"category":"food","description":"กินข้าวเช้า","date":"2026-09-04"}',
        ),
      },
    ]);

    const result = await new GeminiParser().parseTransaction("กินข้าวเช้า 60");
    expect(result?.amount).toBe(60);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects model output that violates app validation, trying the next model", async () => {
    const fetchMock = stubFetchSequence([
      {
        status: 200,
        // Amount over the app maximum and a fake calendar date.
        body: geminiBody(
          '{"kind":"transaction","type":"expense","amount":1000000000,"category":"food","description":"x","date":"2026-02-30"}',
        ),
      },
      {
        status: 200,
        body: geminiBody(
          '{"kind":"transaction","type":"expense","amount":120,"category":"food","description":"กินข้าว","date":"2026-08-29"}',
        ),
      },
    ]);

    const result = await new GeminiParser().parseTransaction("กินข้าว 120");
    expect(result?.amount).toBe(120);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not send the removed temperature parameter to gemini-3 models", async () => {
    const fetchMock = stubFetchSequence([
      {
        status: 200,
        body: geminiBody('{"kind":"unknown"}'),
      },
    ]);
    await new GeminiParser().parseTransaction("สวัสดี");
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.generationConfig.temperature).toBeUndefined();
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema.required).toEqual([
      "kind",
      "type",
      "amount",
      "category",
      "description",
      "date",
    ]);
  });
});
