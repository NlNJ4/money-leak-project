import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleLineMessage } from "@/lib/line-bot";
import { pushToUser, replyToUser } from "@/lib/line";

// Durable LINE message processing. The webhook persists jobs BEFORE
// acknowledging LINE (see app/api/line/webhook/route.ts); this module claims
// and runs everything due. Each webhook invocation doubles as the retry
// heartbeat for previously failed jobs.

const MAX_ATTEMPTS = 5;
const RETENTION_DAYS = 7;
// attempts² × 30s, capped: 30s, 2m, 4.5m, 8m → dead.
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 15 * 60 * 1000;

type LineJobRow = {
  id: string;
  line_user_id: string;
  reply_token: string;
  text: string;
  attempts: number;
};

export type EnqueueableEvent = {
  eventKey: string;
  lineUserId: string;
  replyToken: string;
  text: string;
};

// Durably persist events before the webhook responds. On failure the route
// returns 500 so LINE redelivers; redeliveries share the webhookEventId, so
// the insert's primary key dedupes them.
export async function enqueueLineJobs(
  events: EnqueueableEvent[],
): Promise<void> {
  if (events.length === 0) return;

  const admin = createAdminClient();
  const { error } = await admin.from("line_jobs").insert(
    events.map((event) => ({
      id: event.eventKey,
      line_user_id: event.lineUserId,
      reply_token: event.replyToken,
      text: event.text,
    })),
  );

  if (error) {
    throw new Error(`line_jobs enqueue failed: ${error.message}`);
  }
}

// Claim and process every due job: fresh rows from this webhook plus any
// retries whose backoff has elapsed (and rows abandoned in 'processing' by
// a dead worker — the claim RPC re-claims those after 10 minutes). One
// job's failure never stops the others.
export async function processDueLineJobs(limit = 20): Promise<number> {
  const admin = createAdminClient();
  await cleanupOldJobs();

  const { data, error } = await admin.rpc("claim_due_line_jobs", {
    p_limit: limit,
  });

  if (error) {
    throw new Error(`claim_due_line_jobs failed: ${error.message}`);
  }

  for (const job of (data ?? []) as LineJobRow[]) {
    await runJob(job);
  }

  return (data ?? []).length;
}

async function runJob(job: LineJobRow): Promise<void> {
  const admin = createAdminClient();

  let reply: string;
  try {
    reply = await handleLineMessage(job.line_user_id, job.text, job.id);
  } catch (err) {
    console.error("[line-jobs] processing failed:", job.id, err);
    await markRetry(job, err);
    return;
  }

  // The work itself succeeded — deliver the reply. First attempts use the
  // reply token; by retry time it has expired, so push instead.
  try {
    if (job.attempts <= 1) {
      await replyToUser(job.reply_token, reply);
    } else {
      await pushToUser(job.line_user_id, reply);
    }
  } catch (err) {
    // A failed reply must not undo completed work: the transaction is
    // already saved, and the save_line_transaction marker prevents a
    // reprocessed job from double-saving.
    console.error("[line-jobs] reply failed (job still completes):", job.id, err);
  }

  const { error } = await admin
    .from("line_jobs")
    .update({ status: "completed", processed_at: new Date().toISOString() })
    .eq("id", job.id);

  if (error) {
    console.error("[line-jobs] complete update failed:", job.id, error.message);
  }
}

async function markRetry(job: LineJobRow, err: unknown): Promise<void> {
  const admin = createAdminClient();
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);

  if (job.attempts >= MAX_ATTEMPTS) {
    const { error } = await admin
      .from("line_jobs")
      .update({
        status: "dead",
        last_error: message,
        processed_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    console.error(
      `[line-jobs] job ${job.id} dead-lettered after ${job.attempts} attempts`,
      error?.message ?? "",
    );
    return;
  }

  const backoffMs = Math.min(job.attempts ** 2 * BACKOFF_BASE_MS, BACKOFF_CAP_MS);
  const { error } = await admin
    .from("line_jobs")
    .update({
      status: "retry",
      next_retry_at: new Date(Date.now() + backoffMs).toISOString(),
      last_error: message,
    })
    .eq("id", job.id);

  if (error) {
    console.error("[line-jobs] retry update failed:", job.id, error.message);
  }
}

async function cleanupOldJobs(): Promise<void> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();

  const { error } = await admin
    .from("line_jobs")
    .delete()
    .in("status", ["completed", "dead"])
    .lt("received_at", cutoff);

  if (error) {
    console.error("[line-jobs] cleanup failed:", error.message);
  }
}
