import {
  createExpense,
  getDashboardSummary,
  updateDailyBudget,
} from "@/lib/expense-service";
import { formatBaht } from "@/lib/format";
import {
  type LineWebhookEvent,
  type LineWebhookPayload,
  replyLineMessage,
  verifyLineSignature,
} from "@/lib/line";
import { parseDailyBudgetCommand, parseExpenseText } from "@/lib/parser";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getLineUserId(event: LineWebhookEvent) {
  return event.source?.userId ?? null;
}

function getDashboardUrl(lineUserId: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!appUrl) return null;

  const url = new URL("/dashboard", appUrl);
  url.searchParams.set("lineUserId", lineUserId);

  return url.toString();
}

async function buildDailySummaryReply(lineUserId: string) {
  const summary = await getDashboardSummary(lineUserId);

  return [
    `วันนี้ใช้ไป ${formatBaht(summary.todayTotalBaht)} จากงบ ${formatBaht(summary.dailyBudgetBaht)}`,
    summary.dailyRemainingBaht >= 0
      ? `ยังเหลือ ${formatBaht(summary.dailyRemainingBaht)}`
      : `เกินงบแล้ว ${formatBaht(Math.abs(summary.dailyRemainingBaht))}`,
  ].join("\n");
}

async function buildMonthlySummaryReply(lineUserId: string) {
  const summary = await getDashboardSummary(lineUserId);
  const topLeak = summary.leakInsights[0];

  return [
    `เดือนนี้ใช้ไป ${formatBaht(summary.monthTotalBaht)} จากงบ ${formatBaht(summary.monthlyBudgetBaht)}`,
    `คาดการณ์สิ้นเดือน ${formatBaht(summary.projectedMonthTotalBaht)}`,
    topLeak
      ? `เงินรั่วอันดับแรก: ${topLeak.label} ${formatBaht(topLeak.totalBaht)}`
      : "ยังไม่พบเงินรั่วชัดเจน",
  ].join("\n");
}

async function handleLineText(lineUserId: string, text: string) {
  const normalized = text.trim().toLowerCase();

  if (["สรุปวันนี้", "today", "summary today"].includes(normalized)) {
    return buildDailySummaryReply(lineUserId);
  }

  if (["สรุปเดือนนี้", "month", "summary month"].includes(normalized)) {
    return buildMonthlySummaryReply(lineUserId);
  }

  if (["dashboard", "แดชบอร์ด", "ดู dashboard"].includes(normalized)) {
    const dashboardUrl = getDashboardUrl(lineUserId);

    return dashboardUrl
      ? `Dashboard ของคุณ: ${dashboardUrl}`
      : "ยังไม่ได้ตั้งค่า NEXT_PUBLIC_APP_URL สำหรับลิงก์ Dashboard";
  }

  const budgetCommand = parseDailyBudgetCommand(text);

  if (budgetCommand) {
    await updateDailyBudget(lineUserId, budgetCommand.dailyBudgetBaht);

    return `ตั้งงบรายวันแล้ว: ${formatBaht(budgetCommand.dailyBudgetBaht)}`;
  }

  const parsed = parseExpenseText(text);

  if (!parsed) {
    return "พิมพ์รายการกับจำนวนเงิน เช่น ข้าว 55 หรือพิมพ์ สรุปวันนี้";
  }

  await createExpense({ lineUserId, ...parsed });

  return [
    `บันทึกแล้ว: ${parsed.title} ${formatBaht(parsed.amountBaht)}`,
    await buildDailySummaryReply(lineUserId),
  ].join("\n");
}

async function replyText(replyToken: string, text: string) {
  await replyLineMessage(replyToken, [
    {
      type: "text",
      text,
    },
  ]);
}

async function handleLineEvent(event: LineWebhookEvent) {
  if (event.type !== "message") return;
  if (event.message?.type !== "text") return;
  if (!event.replyToken) return;

  const text = event.message.text;
  if (typeof text !== "string") return;

  const lineUserId = getLineUserId(event);
  if (!lineUserId) {
    await replyText(event.replyToken, "ไม่พบ LINE user id สำหรับบันทึกรายจ่าย");
    return;
  }

  await replyText(event.replyToken, await handleLineText(lineUserId, text));
}

export async function POST(request: Request) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;

  if (!channelSecret) {
    return NextResponse.json(
      { error: "LINE webhook is not configured" },
      { status: 500 },
    );
  }

  const body = await request.text();
  const signature = request.headers.get("x-line-signature") ?? "";

  if (!verifyLineSignature(body, signature, channelSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: LineWebhookPayload;

  try {
    payload = JSON.parse(body) as LineWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  try {
    await Promise.all((payload.events ?? []).map(handleLineEvent));
  } catch {
    return NextResponse.json(
      { error: "Unable to process LINE webhook" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
