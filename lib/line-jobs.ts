import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleLineMessage } from "@/lib/line-bot";
import { lineRetryKey, pushToUser, replyToUser } from "@/lib/line";

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
// Process at most a few jobs per invocation, but claim only one at a time.
// A sequential worker must not burn attempts on jobs it has not started when
// an earlier Gemini request consumes the function's wall-clock budget.
const MAX_JOBS_PER_SWEEP = 3;
const SWEEP_BUDGET_MS = 40_000;

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
  // LINE event timestamp (epoch ms) + position in the webhook batch: the
  // claim RPC orders strictly by these per user, so "ลบล่าสุด" can never
  // run before the "กินข้าว 100" it is meant to undo.
  lineTimestamp: number;
  batchSeq: number;
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
      line_timestamp: event.lineTimestamp,
      batch_seq: event.batchSeq,
    })),
    { onConflict: "id", ignoreDuplicates: true },
  );

  if (error) {
    throw new Error(`line_jobs enqueue failed: ${error.message}`);
  }
}

// Claim and process due jobs in small batches under a wall-clock budget.
// Everything not claimed keeps its attempt counter untouched; the next
// sweep (every minute) picks it up.
export async function processDueLineJobs(
  limit = MAX_JOBS_PER_SWEEP,
): Promise<number> {
  const admin = createAdminClient();
  const deadline = Date.now() + SWEEP_BUDGET_MS;
  const maxJobs = Math.max(1, Math.floor(limit));
  let processed = 0;

  while (processed < maxJobs && Date.now() < deadline) {
    // Claim exactly the job we are about to run. Claiming a batch here would
    // increment attempts and mark later rows as processing even though this
    // worker executes them sequentially and may time out first.
    const { data, error } = await admin.rpc("claim_due_line_jobs", {
      p_limit: 1,
    });

    if (error) {
      throw new Error(`claim_due_line_jobs failed: ${error.message}`);
    }

    const jobs = (data ?? []) as LineJobRow[];
    if (jobs.length === 0) break;

    await runJob(jobs[0]);
    processed += 1;
  }

  return processed;
}

async function runJob(job: LineJobRow): Promise<void> {
  const admin = createAdminClient();

  // Delivery-only retries reuse the stored reply; processing never runs
  // twice for the same job. Should a crash land between a mutating command
  // and this persist, the command RPCs replay their stored result by event
  // key instead of operating on different data.
  let reply = job.reply_text;

  if (reply === null) {
    try {
      reply = await handleLineMessage(job.line_user_id, job.text ?? "", job.id);
    } catch (err) {
      console.error("[line-jobs] processing failed:", job.id, err);
      await markRetry(job, "processing", err);
      return;
    }

    const { error: replyError } = await admin
      .from("line_jobs")
      .update({ reply_text: reply })
      .eq("id", job.id);
    if (replyError) {
      console.error("[line-jobs] reply persist failed:", job.id, replyError.message);
    }
  }

  // One stable retry key per job: LINE deduplicates on it (supported on
  // both reply and push), so a re-sent delivery after an ambiguous timeout
  // cannot deliver twice (409 = already accepted).
  const retryKey = lineRetryKey(job.id);
  try {
    if (job.attempts <= 1 && job.reply_token) {
      await replyToUser(job.reply_token, reply, retryKey);
    } else {
      // Retry-time replies push instead: the reply token is single-use and
      // long expired by now.
      await pushToUser(job.line_user_id, reply, retryKey);
    }
  } catch (err) {
    console.error("[line-jobs] delivery failed:", job.id, err);
    await markRetry(job, "delivery", err);
    return;
  }

  // Completed: clear ALL sensitive payload — message text, reply token,
  // and the financial reply content.
  const { error } = await admin
    .from("line_jobs")
    .update({
      status: "completed",
      processed_at: new Date().toISOString(),
      text: null,
      reply_token: null,
      reply_text: null,
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
          lineRetryKey(`${job.id}:dead-notice`),
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
// DEAD_RETENTION_DAYS, webhook_events dedup markers, command results, and
// expired linking codes.
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

  // Command results are the idempotency ledger; keep them for the same
  // window as the dedup markers.
  const { error: resultsError } = await admin
    .from("line_command_results")
    .delete()
    .lt("created_at", completedCutoff);

  if (resultsError) {
    console.error("[line-jobs] command results cleanup failed:", resultsError.message);
  }

  // Deleted-transaction staging past the restore window: the snapshot
  // holds financial data, so it must not outlive its usefulness.
  const { error: stagingError } = await admin
    .from("deleted_transaction_staging")
    .delete()
    .lt("deleted_at", new Date(now - 10 * 60_000).toISOString());

  if (stagingError) {
    console.error("[line-jobs] staging cleanup failed:", stagingError.message);
  }

  // Expired linking codes are unusable; drop them so the table stays tidy.
  const { error: codesError } = await admin
    .from("linking_codes")
    .delete()
    .lt("expires_at", new Date(now).toISOString());

  if (codesError) {
    console.error("[line-jobs] linking_codes cleanup failed:", codesError.message);
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
