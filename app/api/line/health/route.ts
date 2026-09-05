import { NextResponse, type NextRequest } from "next/server";
import {
  isValidWorkerToken,
} from "@/lib/line-jobs";
import { metricsRange, queueHealth } from "@/lib/observability";

// Operator health snapshot, token-gated like the worker. Everything needed
// to answer "is the LINE pipeline healthy?" without querying tables:
// queue depth, oldest pending age, heartbeat freshness, and a week of
// metric counters. No message content, tokens, or user ids.
export async function GET(request: NextRequest) {
  const token = request.headers.get("x-worker-token");
  if (!token || !(await isValidWorkerToken(token))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [health, metrics] = await Promise.all([
    queueHealth(),
    metricsRange(7),
  ]);

  return NextResponse.json({ health, metrics });
}
