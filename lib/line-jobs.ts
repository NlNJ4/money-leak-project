import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleLineMessage } from "@/lib/line-bot";
import { pushToUser, replyToUser } from "@/lib/line";

// Durable LINE message processing. The webhook persists jobs BEFORE
// acknowledging LINE (see app/api/line/webhook/route.ts); this module claims
// and runs everything due. Retries happen on the next webhook AND on the
// pg_cron-scheduled worker (app/api/line/worker/route.ts), which also owns
// retention cleanup.

const MAX_ATTEMPTS = 5;
const RETENTION_DAYS = 7;
const DEAD_RETENTION_DAYS = 2;
// attempts² × 30s, capped: 30s, 2m, 4.5m, 8m → dead.
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 15 * 60 * 1000;

type LineJobRow = {
  id: string;
  line_user_id: string;
  reply_token: string | null;
  text: string | null;
  attempts: number;
  reply_text: string | null;
};

export type EnqueueableEvent = {
  eventKey: string;
  lineUserId: string;
  replyToken: string;
  text: string;
};

// Durably persist events before the webhook responds. ON CONFLICT DO
// NOTHING makes redeliveries (same webhookEventId) and mixed batches
// containing already-seen events succeed silently — a duplicate must never
// 500-loop the webhook or block new events in the same batch.
export async function enqueueLineJobs(
  events: EnqueueableEvent[],
): Promise<void> {
  if (events.length === 0) return;

  const admin = createAdminClient();
  const { error } = await admin.from("line_jobs").upsert(
    events.map((event) => ({
      id: event.eventKey,
      line_user_id: event.lineUserId,
      reply_token: event.replyToken,
      text: event.text,
    })),
    { onConflict: "id", ignoreDuplicates: true },
  );

  if (error) {
    throw new Error(`line_jobs enqueue failed: ${error.message}`);
  }
}

// Claim and process every due job: fresh rows from this webhook plus any
// retries whose backoff has elapsed (and rows abandoned in 'processing' by
// a dead worker — the claim RPC re-claims those after 10 minutes). One
// job's failure never stops the others. Retention cleanup is deliberately
// NOT run here — only the scheduled worker pays for it.
export async function processDueLineJobs(limit = 20): Promise<number> {
  const admin = createAdminClient();

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

  // Delivery-only retries reuse the stored reply; processing never runs
  // twice for the same job (so summaries are not re-queried and replies
  // are not recomputed after a failed send).
  let reply = job.reply_text;

  if (reply === null) {
    try {
      reply = await handleLineMessage(job.line_user_id, job.text ?? "", job.id);
    } catch (err) {
      console.error("[line-jobs] processing failed:", job.id, err);
      await markRetry(job, "processing", err);
      return;
    }

    // Persist the reply before delivering: a crash mid-delivery re-claims
    // the job into the delivery-only path above. Even if processing were
    // somehow re-run, the save_line_transaction marker prevents a double
    // save.
    const { error: replyError } = await admin
      .from("line_jobs")
      .update({ reply_text: reply })
      .eq("id", job.id);
    if (replyError) {
      console.error("[line-jobs] reply persist failed:", job.id, replyError.message);
    }
  }

  try {
    if (job.attempts <= 1 && job.reply_token) {
      await replyToUser(job.reply_token, reply);
    } else {
      // Retry-time replies push instead: the reply token is single-use and
      // long expired by now.
      await pushToUser(job.line_user_id, reply);
    }
  } catch (err) {
    console.error("[line-jobs] delivery failed:", job.id, err);
    await markRetry(job, "delivery", err);
    return;
  }

  // Completed: clear the sensitive payload immediately — message text and
  // tokens must not linger in the queue table.
  const { error } = await admin
    .from("line_jobs")
    .update({
      status: "completed",
      processed_at: new Date().toISOString(),
      text: null,
      reply_token: null,
    })
    .eq("id", job.id);

  if (error) {
    console.error("[line-jobs] complete update failed:", job.id, error.message);
  }
}

async function markRetry(
  job: LineJobRow,
  phase: "processing" | "delivery",
  err: unknown,
): Promise<void> {
  const admin = createAdminClient();
  const detail = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  const message = `${phase}: ${detail}`;

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
      `[line-jobs] job ${job.id} dead-lettered after ${job.attempts} attempts (${phase})`,
      error?.message ?? "",
    );

    // A processing failure means the user never heard anything back — send
    // one best-effort apology so they are not left silent. Delivery
    // failures already produced their reply content elsewhere.
    if (phase === "processing") {
      try {
        await pushToUser(
          job.line_user_id,
          "เกิดข้อผิดพลาดในการบันทึกครับ ลองส่งข้อความนี้อีกครั้งนะครับ",
        );
      } catch (pushErr) {
        console.error("[line-jobs] dead-letter notice push failed:", job.id, pushErr);
      }
    }
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

// Scheduled-worker retention only: completed history after RETENTION_DAYS,
// dead-letter payloads (kept briefly for inspection) after
// DEAD_RETENTION_DAYS, and the webhook_events dedup markers that
// save_line_transaction no longer cleans up inline.
export async function cleanupOldJobs(): Promise<void> {
  const admin = createAdminClient();
  const now = Date.now();
  const completedCutoff = new Date(
    now - RETENTION_DAYS * 86_400_000,
  ).toISOString();
  const deadCutoff = new Date(
    now - DEAD_RETENTION_DAYS * 86_400_000,
  ).toISOString();

  const { error: jobsError } = await admin
    .from("line_jobs")
    .delete()
    .or(
      `and(status.eq.completed,received_at.lt.${completedCutoff}),and(status.eq.dead,received_at.lt.${deadCutoff})`,
    );

  if (jobsError) {
    console.error("[line-jobs] job cleanup failed:", jobsError.message);
  }

  const { error: eventsError } = await admin
    .from("webhook_events")
    .delete()
    .lt("received_at", completedCutoff);

  if (eventsError) {
    console.error("[line-jobs] webhook_events cleanup failed:", eventsError.message);
  }
}

// Worker authentication: the token lives in a service-role-only table and
// is generated in-database, so it never appears in code or env files.
export async function isValidWorkerToken(token: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("line_worker_tokens")
    .select("token")
    .eq("token", token)
    .maybeSingle();
  return Boolean(data);
}
