import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getAuthContext: mocks.auth }));
import { GET } from "@/app/api/transactions/export/route";
import { countHistory, listHistory } from "@/lib/transactions";

const ID = "1b671a64-40d5-491e-99b0-da01ff1f3341";
const calls: { url: URL; method: string }[] = [];
let failCount = false;
beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  failCount = false;
  const client = createClient("http://localhost:54321", "test-only", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (url.pathname.endsWith("/categories")) {
        return Response.json({ id: ID, type: "expense" });
      }
      if (method === "HEAD") {
        return new Response(null, {
          status: failCount ? 500 : 200,
          headers: { "Content-Range": "0-1/2" },
        });
      }
      return Response.json([]);
    } },
  });
  mocks.auth.mockResolvedValue({ userId: ID, supabase: client });
});

const filters = {
  range: { from: "2026-09-01", to: "2026-09-30" },
  type: "expense" as const, category: "my-coffee", source: "line", q: "50%_off",
};
const cursor = { createdAt: "2026-09-06T10:00:00Z", id: ID };

describe("export route regressions", () => {
  it("uses identical date, category, type, source, search and cursor filters for counts and rows", async () => {
    expect(await countHistory(filters, cursor)).toBe(2);
    await listHistory(filters, cursor, 999);
    const tx = calls.filter(({ url }) => url.pathname.endsWith("/transactions"));
    expect(tx).toHaveLength(2);
    expect(tx[0].method).toBe("HEAD");
    for (const key of ["user_id", "transaction_date", "type", "source", "description", "category_id", "or"]) {
      expect(tx[0].url.searchParams.getAll(key)).toEqual(tx[1].url.searchParams.getAll(key));
      expect(tx[0].url.searchParams.has(key)).toBe(true);
    }
    expect(tx[0].url.searchParams.get("description")).toBe("ilike.%50\\%\\_off%");
    expect(tx[1].url.searchParams.get("limit")).toBe("1000");
  });

  it("serves a filtered export with an accurate truncation header", async () => {
    const response = await GET(new NextRequest("http://localhost/api/transactions/export?from=2026-09-01&to=2026-09-30&type=expense&source=line&q=coffee"));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Rows-Truncated")).toBe("0");
    await response.text();
    const head = calls.find(({ method }) => method === "HEAD")!;
    expect(head.url.searchParams.get("type")).toBe("eq.expense");
    expect(head.url.searchParams.get("source")).toBe("eq.line");
    expect(head.url.searchParams.get("description")).toBe("ilike.%coffee%");
  });

  it("rejects malformed cursors rather than exporting from the beginning", async () => {
    const response = await GET(new NextRequest("http://localhost/api/transactions/export?from=2026-09-01&to=2026-09-30&cursor=garbage"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_cursor" });
    expect(calls).toHaveLength(0);
  });

  it("does not turn a failed count into a misleading successful export", async () => {
    failCount = true;
    const response = await GET(new NextRequest("http://localhost/api/transactions/export?from=2026-09-01&to=2026-09-30"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "query_failed" });
  });

  it("requires authentication before fetching data", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/transactions/export?from=2026-09-01&to=2026-09-30"));
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
