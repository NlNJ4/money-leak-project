import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { lineRetryKey, pushToUser } from "@/lib/line";

// Worker observability: daily metric counters, queue health, structured
// job logs, and owner LINE alerts. Metrics keys are enum-like strings —
// never message text, tokens, ids, or amounts.

export async function recordMetrics(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await createAdminClient().rpc("bump_metrics", { p_keys: keys });
  } catch (err) {
    // Best-effort by design: metrics must never break processing.
    console.error("[observability] bump_metrics failed:", (err as Error).message);
  }
}

export async function hasMetricToday(key: string): Promise<boolean> {
  try {
    const { data } = await createAdminClient()
      .from("line_metrics")
      .select("count")
      .eq("day", new Date().toISOString().slice(0, 10))
      .eq("key", key)
      .maybeSingle();
    return Boolean(data);
  } catch {
    return false;
  }
}

export type QueueHealth = {
  depth: Record<string, number>;
  oldestPendingSeconds: number | null;
  heartbeatAgeSeconds: number | null;
};

export async function queueHealth(): Promise<QueueHealth> {
  const admin = createAdminClient();

  const [{ data: statusRows }, { data: heartbeat }, { data: oldest }] =
    await Promise.all([
      admin.from("line_jobs").select("status"),
      admin.from("worker_heartbeat").select("last_run_at").eq("id", 1).maybeSingle(),
      admin
        .from("line_jobs")
        .select("received_at")
        .in("status", ["pending", "retry", "processing"])
        .order("received_at", { ascending: true })
        .limit(1),
    ]);

  const depth: Record<string, number> = {};
  for (const row of statusRows ?? []) {
    depth[row.status] = (depth[row.status] ?? 0) + 1;
  }

  const oldestAt = oldest?.[0]?.received_at;
  const heartbeatAt = heartbeat?.last_run_at;

  return {
    depth,
    oldestPendingSeconds: oldestAt
      ? Math.max(0, Math.round((Date.now() - new Date(oldestAt).getTime()) / 1000))
      : null,
    heartbeatAgeSeconds: heartbeatAt
      ? Math.max(0, Math.round((Date.now() - new Date(heartbeatAt).getTime()) / 1000))
      : null,
  };
}

export async function metricsRange(days: number): Promise<
  { day: string; key: string; count: number }[]
> {
  const from = new Date(Date.now() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const { data, error } = await createAdminClient()
    .from("line_metrics")
    .select("day, key, count")
    .gte("day", from)
    .order("day", { ascending: false });
  if (error) throw new Error(`metrics query failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    day: String(row.day),
    key: row.key,
    count: Number(row.count),
  }));
}

// Structured, redacted job log line: one per phase transition, enough to
// trace a job from webhook receipt to delivery without ever containing
// message text, tokens, or financial values.
export function logJobEvent(event: {
  jobId: string;
  attempt: number;
  phase: "claimed" | "processed" | "delivered" | "processing_failed" | "delivery_failed" | "dead";
  durationMs?: number;
  via?: "reply" | "push";
}): void {
  console.log(`[job] ${JSON.stringify(event)}`);
}

// Alert the (single) owner through their linked LINE account. Deduped per
// alert key per day so a persistent condition pushes once, not every sweep.
export async function pushOwnerAlertOnce(
  alertKey: string,
  text: string,
): Promise<void> {
  const dedupeKey = `alert:${alertKey}`;
  if (await hasMetricToday(dedupeKey)) return;

  const admin = createAdminClient();
  const { data: identity } = await admin
    .from("user_identities")
    .select("provider_user_id")
    .eq("provider", "line")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!identity) return;

  try {
    await pushToUser(
      identity.provider_user_id,
      `⚠️ ${text}`,
      lineRetryKey(`${dedupeKey}:${new Date().toISOString().slice(0, 10)}`),
    );
    await recordMetrics([dedupeKey]);
  } catch (err) {
    console.error(`[observability] owner alert ${alertKey} failed:`, (err as Error).message);
  }
}
