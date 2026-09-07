import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  cleanupOldJobs,
  isValidWorkerToken,
  processDueLineJobs,
  retryDeadJobs,
} from "@/lib/line-jobs";

// Scheduled retry sweep, hit every minute by Supabase pg_cron (Vercel
// Hobby cron is daily-only). This is what makes retries run even when no
// new LINE message arrives. Auth is a token generated in-database —
// nothing here is callable without a row in line_worker_tokens.
export async function POST(request: NextRequest) {
  const token = request.headers.get("x-worker-token");
  if (!token || !(await isValidWorkerToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const processed = await processDueLineJobs();
    await cleanupOldJobs();
    const dead = await countDeadJobs();

    // Structured alert line: cron.job_run_details and Vercel logs both
    // surface warnings, so a growing dead-letter queue is visible without
    // dashboards.
    if (dead > 0) {
      console.warn(`[alert] ${JSON.stringify({ deadJobs: dead })}`);
    }

    return NextResponse.json({ ok: true, processed, dead });
  } catch (err) {
    // A 500 here surfaces in cron.job_run_details for diagnosis.
    console.error("[line worker] sweep failed:", err);
    return NextResponse.json({ error: "worker_failed" }, { status: 500 });
  }
}

// Inspection (GET) and safe recovery (POST action=retry-dead), both
// token-gated. Message text is deliberately excluded — ids, attempts, and
// errors only.
export async function GET(request: NextRequest) {
  const token = request.headers.get("x-worker-token");
  if (!token || !(await isValidWorkerToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const [{ data: dead }, { data: depth }] = await Promise.all([
    admin
      .from("line_jobs")
      .select("id, attempts, last_error, received_at")
      .eq("status", "dead")
      .order("received_at", { ascending: false })
      .limit(50),
    admin.from("line_jobs").select("status"),
  ]);

  const counts: Record<string, number> = {};
  for (const row of depth ?? []) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }

  return NextResponse.json({ dead: dead ?? [], depth: counts });
}

// Retry dead jobs via the shared lib function.
export async function PUT(request: NextRequest) {
  const token = request.headers.get("x-worker-token");
  if (!token || !(await isValidWorkerToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const retried = await retryDeadJobs();
    return NextResponse.json({ ok: true, retried: retried.length, ids: retried });
  } catch (err) {
    console.error("[line worker] retry-dead failed:", (err as Error).message);
    return NextResponse.json({ error: "retry_failed" }, { status: 500 });
  }
}

async function countDeadJobs(): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("line_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "dead");

  if (error) {
    console.error("[line worker] dead count failed:", error.message);
    return 0;
  }
  return count ?? 0;
}
