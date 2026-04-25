import {
  createExpense,
  getDashboardSummary,
  updateDailyBudget,
  updateMonthlyBudget,
} from "@/lib/expense-service";
import { formatBaht } from "@/lib/format";
import {
  type GeminiLineIntent,
  parseLineIntentWithGemini,
} from "@/lib/gemini-expense-parser";
import {
  isGeminiReceiptParserConfigured,
  type ParsedReceipt,
  parseReceiptImageWithGemini,
} from "@/lib/gemini-receipt-parser";
import {
  getLineImageContent,
  LineContentTooLargeError,
  type LineImageMessageEvent,
  type LineWebhookEvent,
  type LineWebhookPayload,
  replyLineMessage,
  UnsupportedLineImageError,
  verifyLineSignature,
} from "@/lib/line";
import {
  type ParsedExpenseText,
  parseDailyBudgetCommand,
  parseExpenseText,
  parseMonthlyBudgetCommand,
} from "@/lib/parser";
import {
  MAX_LINE_EVENTS,
  MAX_LINE_TEXT_LENGTH,
  MAX_LINE_WEBHOOK_BODY_BYTES,
  RequestBodyTooLargeError,
  appendDashboardAccessToken,
  isRateLimited,
  normalizeLineUserId,
  readRequestTextWithLimit,
} from "@/lib/security";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const lineMessageRateLimit = {
  limit: 30,
  windowMs: 60_000,
};
const MAX_LINE_WEBHOOK_EVENT_ID_LENGTH = 128;

function getLineUserId(event: LineWebhookEvent) {
  return normalizeLineUserId(event.source?.userId, "") || null;
}

function getDashboardUrl(lineUserId: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!appUrl) return null;

  const url = new URL("/dashboard", appUrl);
  url.searchParams.set("lineUserId", lineUserId);
  appendDashboardAccessToken(url, lineUserId);

  return url.toString();
}

function getReceiptExpenseWebhookEventId(
  lineWebhookEventId: string | null | undefined,
  index: number,
) {
  if (!lineWebhookEventId) return null;

  const suffix = `:receipt:${index}`;

  return `${lineWebhookEventId.slice(
    0,
    MAX_LINE_WEBHOOK_EVENT_ID_LENGTH - suffix.length,
  )}${suffix}`;
}

async function buildDailySummaryReply(lineUserId: string) {
  const summary = await getDashboardSummary(lineUserId);
  const nearestReminder = summary.recurringReminders[0];

  return [
    `วันนี้ใช้ไป ${formatBaht(summary.todayTotalBaht)} จากงบ ${formatBaht(summary.dailyBudgetBaht)}`,
    summary.dailyRemainingBaht >= 0
      ? `ยังเหลือ ${formatBaht(summary.dailyRemainingBaht)}`
      : `เกินงบแล้ว ${formatBaht(Math.abs(summary.dailyRemainingBaht))}`,
    nearestReminder
      ? `เตือนจ่ายซ้ำ: ${nearestReminder.title} ${formatBaht(nearestReminder.averageAmountBaht)} (${nearestReminder.dueLabel})`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
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

async function buildWeeklySummaryReply(lineUserId: string) {
  const summary = await getDashboardSummary(lineUserId);
  const topCategory = summary.weekTopCategory;
  const topLeak = summary.leakInsights[0];

  if (summary.weekTotalBaht === 0) {
    return "7 วันล่าสุดยังไม่มีรายการ ลองส่งเช่น ข้าว 55";
  }

  return [
    `7 วันล่าสุดใช้ไป ${formatBaht(summary.weekTotalBaht)}`,
    `เฉลี่ยวันละ ${formatBaht(summary.weekAverageBaht)}`,
    topCategory
      ? `หมวดสูงสุด: ${topCategory.label} ${formatBaht(topCategory.totalBaht)}`
      : null,
    topLeak ? `เงินรั่วที่ควรดู: ${topLeak.label} - ${topLeak.suggestion}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function buildRecurringSummaryReply(lineUserId: string) {
  const summary = await getDashboardSummary(lineUserId);
  const recurringInsights = summary.recurringInsights;

  if (recurringInsights.length === 0) {
    return "ยังไม่พบรายจ่ายซ้ำที่ชัดเจนใน 90 วันล่าสุด";
  }

  return [
    "รายจ่ายซ้ำที่พบ:",
    ...recurringInsights.map((insight, index) =>
      `${index + 1}. ${insight.title} ประมาณ ${formatBaht(insight.averageAmountBaht)} (${insight.cadence === "monthly" ? "รายเดือน" : "รายสัปดาห์"})`,
    ),
  ].join("\n");
}

async function buildRecurringReminderReply(lineUserId: string) {
  const summary = await getDashboardSummary(lineUserId);
  const reminders = summary.recurringReminders;

  if (reminders.length === 0) {
    return "ยังไม่มีรายจ่ายซ้ำที่ใกล้ถึงใน 7 วัน";
  }

  return [
    "เตือนจ่ายซ้ำใกล้ถึง:",
    ...reminders.map((reminder, index) =>
      `${index + 1}. ${reminder.title} ${formatBaht(reminder.averageAmountBaht)} - ${reminder.dueLabel}`,
    ),
  ].join("\n");
}

async function buildSavedExpenseReply(
  lineUserId: string,
  expense: ParsedExpenseText & { isNeed?: boolean },
  lineWebhookEventId?: string | null,
) {
  await createExpense({
    lineUserId,
    lineWebhookEventId,
    title: expense.title,
    amountBaht: expense.amountBaht,
    category: expense.category,
    isNeed: expense.isNeed,
  });

  return [
    `บันทึกแล้ว: ${expense.title} ${formatBaht(expense.amountBaht)}`,
    await buildDailySummaryReply(lineUserId),
  ].join("\n");
}

async function buildSavedReceiptReply(
  lineUserId: string,
  receipt: ParsedReceipt,
  lineWebhookEventId?: string | null,
) {
  const savedExpenses = await Promise.all(
    receipt.expenses.map((expense, index) =>
      createExpense({
        lineUserId,
        lineWebhookEventId: getReceiptExpenseWebhookEventId(
          lineWebhookEventId,
          index,
        ),
        title: expense.title,
        amountBaht: expense.amountBaht,
        category: expense.category,
        isNeed: expense.isNeed,
        spentAt: expense.spentAt,
      }),
    ),
  );
  const totalBaht = savedExpenses.reduce(
    (sum, expense) => sum + expense.amountBaht,
    0,
  );
  const previewLines = savedExpenses
    .slice(0, 5)
    .map((expense) => `- ${expense.title} ${formatBaht(expense.amountBaht)}`);
  const hiddenCount = savedExpenses.length - previewLines.length;

  return [
    `บันทึกจากรูปแล้ว ${savedExpenses.length} รายการ รวม ${formatBaht(totalBaht)}`,
    receipt.merchantName ? `ร้าน: ${receipt.merchantName}` : null,
    ...previewLines,
    hiddenCount > 0 ? `และอีก ${hiddenCount} รายการ` : null,
    await buildDailySummaryReply(lineUserId),
  ]
    .filter(Boolean)
    .join("\n");
}

async function handleGeminiIntent(
  lineUserId: string,
  intent: GeminiLineIntent | null,
  lineWebhookEventId?: string | null,
) {
  if (!intent) return null;

  switch (intent.action) {
    case "expense":
      return buildSavedExpenseReply(lineUserId, intent, lineWebhookEventId);

    case "budget":
      await updateDailyBudget(lineUserId, intent.dailyBudgetBaht);

      return `ตั้งงบรายวันแล้ว: ${formatBaht(intent.dailyBudgetBaht)}`;

    case "monthly_budget":
      await updateMonthlyBudget(lineUserId, intent.monthlyBudgetBaht);

      return `ตั้งงบรายเดือนแล้ว: ${formatBaht(intent.monthlyBudgetBaht)}`;

    case "summary_today":
      return buildDailySummaryReply(lineUserId);

    case "summary_week":
      return buildWeeklySummaryReply(lineUserId);

    case "summary_month":
      return buildMonthlySummaryReply(lineUserId);

    case "subscription_summary":
      return buildRecurringSummaryReply(lineUserId);

    case "recurring_reminders":
      return buildRecurringReminderReply(lineUserId);

    case "dashboard": {
      const dashboardUrl = getDashboardUrl(lineUserId);

      return dashboardUrl
        ? `Dashboard ของคุณ: ${dashboardUrl}`
        : "ยังไม่ได้ตั้งค่า NEXT_PUBLIC_APP_URL สำหรับลิงก์ Dashboard";
    }

    case "identity": {
      const dashboardUrl = getDashboardUrl(lineUserId);

      return [
        `LINE user id: ${lineUserId}`,
        dashboardUrl ? `Dashboard: ${dashboardUrl}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    }

    case "clarify":
      return intent.clarificationQuestion;

    case "unknown":
      return intent.clarificationQuestion;
  }
}

async function handleLineText(
  lineUserId: string,
  text: string,
  lineWebhookEventId?: string | null,
) {
  const normalized = text.trim().toLowerCase();

  if (
    ["id", "my id", "line id", "user id", "whoami", "me"].includes(normalized)
  ) {
    const dashboardUrl = getDashboardUrl(lineUserId);

    return [
      `LINE user id: ${lineUserId}`,
      dashboardUrl ? `Dashboard: ${dashboardUrl}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (["สรุปวันนี้", "today", "summary today"].includes(normalized)) {
    return buildDailySummaryReply(lineUserId);
  }

  if (
    ["สรุปสัปดาห์นี้", "สัปดาห์นี้", "week", "summary week"].includes(
      normalized,
    )
  ) {
    return buildWeeklySummaryReply(lineUserId);
  }

  if (["สรุปเดือนนี้", "month", "summary month"].includes(normalized)) {
    return buildMonthlySummaryReply(lineUserId);
  }

  if (
    ["รายจ่ายซ้ำ", "สมาชิก", "subscriptions", "subscription", "subs"].includes(
      normalized,
    )
  ) {
    return buildRecurringSummaryReply(lineUserId);
  }

  if (
    [
      "เตือนจ่ายซ้ำ",
      "เตือนรายจ่ายซ้ำ",
      "ใกล้ตัด",
      "reminders",
      "reminder",
      "due",
    ].includes(normalized)
  ) {
    return buildRecurringReminderReply(lineUserId);
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

  const monthlyBudgetCommand = parseMonthlyBudgetCommand(text);

  if (monthlyBudgetCommand) {
    await updateMonthlyBudget(
      lineUserId,
      monthlyBudgetCommand.monthlyBudgetBaht,
    );

    return `ตั้งงบรายเดือนแล้ว: ${formatBaht(monthlyBudgetCommand.monthlyBudgetBaht)}`;
  }

  const geminiReply = await handleGeminiIntent(
    lineUserId,
    await parseLineIntentWithGemini(text),
    lineWebhookEventId,
  );

  if (geminiReply) return geminiReply;

  const parsed = parseExpenseText(text);

  if (!parsed) {
    return "พิมพ์รายการกับจำนวนเงิน เช่น ข้าว 55 หรือพิมพ์ สรุปวันนี้";
  }

  return buildSavedExpenseReply(lineUserId, parsed, lineWebhookEventId);
}

async function handleLineImage(
  lineUserId: string,
  event: LineImageMessageEvent,
) {
  if (!isGeminiReceiptParserConfigured()) {
    return "ยังไม่ได้ตั้งค่า GEMINI_API_KEY สำหรับอ่านรูปใบเสร็จ";
  }

  if (event.message.contentProvider?.type === "external") {
    return "ตอนนี้รองรับรูปที่ส่งเข้ามาใน LINE โดยตรงเท่านั้น";
  }

  try {
    const image = await getLineImageContent(event.message.id);
    const receipt = await parseReceiptImageWithGemini({
      imageBase64: image.data.toString("base64"),
      mimeType: image.mimeType,
    });

    if (!receipt || receipt.expenses.length === 0) {
      return (
        receipt?.clarificationQuestion ??
        "อ่านรูปนี้ยังไม่ชัด ลองส่งรูปใบเสร็จที่เห็นยอดเงินครบอีกครั้ง"
      );
    }

    return buildSavedReceiptReply(
      lineUserId,
      receipt,
      event.webhookEventId,
    );
  } catch (error) {
    if (error instanceof LineContentTooLargeError) {
      return "รูปใหญ่เกินไป กรุณาส่งรูปใบเสร็จที่เล็กกว่า 5MB";
    }

    if (error instanceof UnsupportedLineImageError) {
      return "รองรับเฉพาะรูป JPG, PNG หรือ WebP";
    }

    console.error("LINE receipt image processing failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return "ยังอ่านรูปใบเสร็จไม่ได้ กรุณาลองส่งรูปใหม่อีกครั้ง";
  }
}

async function replyText(replyToken: string, text: string) {
  await replyLineMessage(replyToken, [
    {
      type: "text",
      text,
    },
  ]);
}

async function safeReplyText(replyToken: string, text: string) {
  try {
    await replyText(replyToken, text);
  } catch (error) {
    console.error("LINE reply failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

async function handleLineEvent(event: LineWebhookEvent) {
  if (event.type !== "message") return;
  if (!event.replyToken) return;

  const lineUserId = getLineUserId(event);
  if (!lineUserId) {
    await safeReplyText(
      event.replyToken,
      "ไม่พบ LINE user id สำหรับบันทึกรายจ่าย",
    );
    return;
  }

  if (isRateLimited(`line:${lineUserId}`, lineMessageRateLimit)) {
    await safeReplyText(
      event.replyToken,
      "ส่งเร็วเกินไป กรุณารอสักครู่แล้วลองใหม่",
    );
    return;
  }

  try {
    if (event.message?.type === "text") {
      const text = event.message.text;
      if (typeof text !== "string") return;

      if (text.length > MAX_LINE_TEXT_LENGTH) {
        await safeReplyText(
          event.replyToken,
          "ข้อความยาวเกินไป กรุณาส่งรายการให้สั้นลง เช่น ข้าว 55",
        );
        return;
      }

      await safeReplyText(
        event.replyToken,
        await handleLineText(lineUserId, text, event.webhookEventId),
      );
      return;
    }

    if (event.message?.type === "image" && event.message.id) {
      await safeReplyText(
        event.replyToken,
        await handleLineImage(lineUserId, event as LineImageMessageEvent),
      );
    }
  } catch (error) {
    console.error("LINE event processing failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    await safeReplyText(
      event.replyToken,
      "ยังบันทึกรายการไม่ได้ กรุณาลองใหม่อีกครั้ง",
    );
  }
}

export async function POST(request: Request) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!channelSecret || !channelAccessToken) {
    return NextResponse.json(
      { error: "LINE webhook is not configured" },
      { status: 500 },
    );
  }

  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json")
  ) {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 },
    );
  }

  let body: string;

  try {
    body = await readRequestTextWithLimit(
      request,
      MAX_LINE_WEBHOOK_BODY_BYTES,
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { error: "Webhook payload is too large" },
        { status: 413 },
      );
    }

    throw error;
  }

  const signature = request.headers.get("x-line-signature") ?? "";

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  if (!verifyLineSignature(body, signature, channelSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: LineWebhookPayload;

  try {
    payload = JSON.parse(body) as LineWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const events = Array.isArray(payload.events) ? payload.events : [];

  if (events.length > MAX_LINE_EVENTS) {
    return NextResponse.json(
      { error: "Webhook payload contains too many events" },
      { status: 413 },
    );
  }

  try {
    await Promise.all(events.map(handleLineEvent));
  } catch {
    return NextResponse.json(
      { error: "Unable to process LINE webhook" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
