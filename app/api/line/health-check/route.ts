import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { pushOwnerAlertOnce, queueHealth } from "@/lib/observability";

// Daily watchdog (Vercel Cron — see vercel.json). It exists to catch what
// the per-minute sweep cannot: the sweep itself having stopped. Authorized
// by Vercel's automatic `Authorization: Bearer $CRON_SECRET` header.
export const maxDuration = 30;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const findings: string[] = [];

  // 1. Is the per-minute worker actually running?
  const health = await queueHealth();
  if (
    health.heartbeatAgeSeconds === null ||
    health.heartbeatAgeSeconds > 180
  ) {
    findings.push(
      `worker heartbeat หยุดนาน ${
        health.heartbeatAgeSeconds === null
          ? "ไม่พบข้อมูล"
          : `${Math.round(health.heartbeatAgeSeconds / 60)} นาที`
      } (ควรไม่เกิน 3 นาที)`,
    );
  }

  // 2. Deployment smoke: public pages answer and the worker endpoint
  //    still rejects unauthenticated calls.
  const origin = new URL(request.url).origin;
  const login = await fetch(`${origin}/login`, {
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!login || !login.ok) {
    findings.push("หน้าเว็บ /login ไม่ตอบสนอง");
  }

  const worker = await fetch(`${origin}/api/line/worker`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!worker || worker.status !== 401) {
    findings.push("worker endpoint ไม่ได้ปฏิเสธ request ที่ไม่มี token");
  }

  for (const message of findings) {
    await pushOwnerAlertOnce("watchdog", message);
  }

  return NextResponse.json({
    ok: findings.length === 0,
    findings,
    health,
  });
}
