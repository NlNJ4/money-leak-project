import "server-only";
import { ServiceError } from "@/lib/transactions";

// Per-user sliding-window rate limit for authenticated mutation routes.
// In-memory per server instance — sufficient to stop accidental floods and
// loose loops; a determined distributed attacker is out of scope for this
// deployment (documented in the README rotation/hardening section).

const WINDOW_MS = 60_000;
const MAX_MUTATIONS_PER_WINDOW = 30;

type Window = { hits: number[] };

const windows = new Map<string, Window>();

export function enforceMutationRateLimit(userId: string): void {
  const now = Date.now();
  const key = userId;
  let window = windows.get(key);
  if (!window) {
    window = { hits: [] };
    windows.set(key, window);
  }

  window.hits = window.hits.filter((t) => now - t < WINDOW_MS);
  if (window.hits.length >= MAX_MUTATIONS_PER_WINDOW) {
    throw new ServiceError("rate_limited");
  }
  window.hits.push(now);

  // Opportunistic eviction so the map cannot grow without bound.
  if (windows.size > 10_000) {
    for (const [k, w] of windows) {
      if (w.hits.every((t) => now - t >= WINDOW_MS)) windows.delete(k);
      if (windows.size <= 5_000) break;
    }
  }
}
