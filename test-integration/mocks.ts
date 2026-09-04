import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";

// Programmable HTTP mock for the LINE and Gemini APIs. Each request pops
// the next queued behavior (or the default); requests are recorded so
// tests can assert paths, headers (retry keys), and bodies. No test ever
// touches the real APIs.

export type MockRequest = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
};

export type MockBehavior =
  | { status: number; body?: unknown }
  | { hang: true };

export function startMock(name: string, defaultBehavior: MockBehavior = { status: 200, body: {} }) {
  const requests: MockRequest[] = [];
  const queue: MockBehavior[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body: unknown = raw;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        /* keep raw */
      }
      requests.push({
        method: req.method ?? "POST",
        path: req.url ?? "/",
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v ?? ""]),
        ),
        body,
      });

      const next = queue.shift() ?? defaultBehavior;
      if ("hang" in next) return; // never respond: client aborts on timeout
      res.statusCode = next.status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(next.body ?? {}));
    });
  });

  return new Promise<{
    url: string;
    requests: MockRequest[];
    queue: (b: MockBehavior) => void;
    reset: () => void;
    close: () => Promise<void>;
  }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        queue: (b) => queue.push(b),
        reset: () => {
          queue.length = 0;
          requests.length = 0;
        },
        close: () =>
          new Promise((done) => {
            server.close(() => done());
            // Sockets from hung requests would keep the server open.
            server.closeAllConnections?.();
          }),
      });
    });
    server.on("error", (err) => {
      throw new Error(`${name} mock failed to start: ${(err as Error).message}`);
    });
  });
}

export function geminiOk(payload: Record<string, unknown>) {
  return {
    status: 200,
    body: { candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] },
  } satisfies MockBehavior;
}
