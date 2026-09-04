import { NextResponse, type NextRequest } from "next/server";
import {
  cleanupOldJobs,
  isValidWorkerToken,
  processDueLineJobs,
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
    return NextResponse.json({ ok: true, processed });
  } catch (err) {
    // A 500 here surfaces in cron.job_run_details for diagnosis.
    console.error("[line worker] sweep failed:", err);
    return NextResponse.json({ error: "worker_failed" }, { status: 500 });
  }
}
