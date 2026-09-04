import { afterEach, describe, expect, it, vi } from "vitest";
import { lineRetryKey, pushToUser, replyToUser } from "@/lib/line";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("LINE message delivery", () => {
  it("never sends the unsupported retry header to the reply endpoint", async () => {
    vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "test-token");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await replyToUser("reply-token", "hello");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith("/message/reply")).toBe(true);
    expect(new Headers(init.headers).has("X-Line-Retry-Key")).toBe(false);
  });

  it("uses a stable retry key for push retries and accepts LINE 409", async () => {
    vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "test-token");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    const retryKey = lineRetryKey("job-1");

    await expect(pushToUser("U123", "hello", retryKey)).resolves.toBeUndefined();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("X-Line-Retry-Key")).toBe(retryKey);
  });
});
