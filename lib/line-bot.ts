import "server-only";
import { GeminiParser } from "@/lib/ai/gemini";
import type { ParsedTransaction } from "@/lib/ai/provider";
import { monthRange, todayISO } from "@/lib/date";
import { createAdminClient } from "@/lib/supabase/admin";

// All replies are Thai-first: the bot conversation is Thai per the spec.
function fmt(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

const LINK_CODE_RE = /^MONEY-[A-Za-z0-9_-]{22}$/;

// Brute-force guard for code redemption: 5 attempts per LINE user per hour.
// In-memory is per server instance; acceptable for a single-user MVP, but a
// shared store (e.g. a Postgres counter) is needed for multi-instance deploys.
const REDEEM_LIMIT = 5;
const REDEEM_WINDOW_MS = 60 * 60 * 1000;
const redeemAttempts = new Map<string, { count: number; resetAt: number }>();

function redeemRateLimited(lineUserId: string): boolean {
  const now = Date.now();
  const entry = redeemAttempts.get(lineUserId);
  if (!entry || entry.resetAt < now) {
    redeemAttempts.set(lineUserId, { count: 1, resetAt: now + REDEEM_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > REDEEM_LIMIT;
}

const HELP_TEXT = [
  "บันทึกรายรับรายจ่ายได้ง่าย ๆ แค่พิมพ์ส่งมาเลยครับ",
  "",
  "ตัวอย่าง:",
  "🍜 กินข้าว 120",
  "⛽ เติมน้ำมัน 800",
  "💰 ได้เงิน 2000",
  "📅 เมื่อวานกินตี๋น้อย 829",
  "",
  "ดูสรุป:",
  "วันนี้ • เดือนนี้ • ล่าสุด",
].join("\n");

const NOT_LINKED_TEXT = [
  "สวัสดี 👋 บอทนี้ใช้บันทึกรายรับ–รายจ่ายของคุณ",
  "เริ่มใช้งาน:",
  "1. เข้าเว็บแดชบอร์ด กดปุ่ม \"เชื่อมต่อ LINE\"",
  "2. ส่งโค้ดที่ได้ (ขึ้นต้นด้วย MONEY-) มาที่นี่",
].join("\n");

async function resolveUserId(
  admin: ReturnType<typeof createAdminClient>,
  lineUserId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("user_identities")
    .select("user_id")
    .eq("provider", "line")
    .eq("provider_user_id", lineUserId)
    .maybeSingle();
  if (error) {
    throw new Error(`identity lookup failed: ${error.message}`);
  }
  return data?.user_id ?? null;
}

// ---- linking ----

// Redemption is one atomic database operation (redeem_linking_code RPC):
// it locks the code row, validates expiry, consumes the code and inserts
// the identity in a single transaction — no double-redeem races.
export async function linkByCode(
  lineUserId: string,
  code: string,
): Promise<string> {
  if (redeemRateLimited(lineUserId)) {
    return "พยายามหลายครั้งเกินไปครับ ลองอีกครั้งในภายหลังนะครับ";
  }

  const admin = createAdminClient();
  const { data: status, error } = await admin.rpc("redeem_linking_code", {
    p_code: code,
    p_provider: "line",
    p_provider_user_id: lineUserId,
  });

  if (error) {
    console.error("[line-bot] redeem failed:", error.message);
    return "เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้งครับ";
  }

  switch (status) {
    case "linked":
      return "เชื่อมต่อสำเร็จ ✅\nเริ่มบันทึกได้เลย เช่น กินข้าว 120";
    case "already_linked_same":
      return "บัญชีนี้เชื่อมต่อไว้แล้วครับ ✅";
    case "already_linked_other":
      return "LINE นี้ถูกเชื่อมต่อกับบัญชีอื่นอยู่แล้วครับ";
    case "expired":
      return "โค้ดนี้หมดอายุแล้วครับ กดขอโค้ดใหม่ในหน้าแดชบอร์ดได้เลยครับ";
    default:
      return "ไม่พบโค้ดนี้ครับ ตรวจสอบในหน้าแดชบอร์ดอีกครั้งนะครับ";
  }
}

// ---- summaries (no AI needed per spec section 11) ----

type Range = { from: string; to: string };

async function rangeRows(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  range: Range,
) {
  const { data, error } = await admin
    .from("transactions")
    .select(
      "type, amount, transaction_date, category:categories(icon, name_th)",
    )
    .eq("user_id", userId)
    .gte("transaction_date", range.from)
    .lte("transaction_date", range.to)
    .order("transaction_date", { ascending: false });
  if (error) {
    // Never answer with a believable ฿0 summary on a database failure.
    throw new Error(`summary query failed: ${error.message}`);
  }
  return data ?? [];
}

async function summaryForRange(
  userId: string,
  range: Range,
  title: string,
): Promise<string> {
  const admin = createAdminClient();
  const rows = await rangeRows(admin, userId, range);

  let income = 0;
  let expense = 0;
  const byCategory = new Map<string, { icon: string; name: string; total: number }>();

  for (const row of rows) {
    const amount = Number(row.amount);
    if (row.type === "income") income += amount;
    else if (row.type === "expense") expense += amount;
    if (row.type !== "transfer" && row.category) {
      const cat = row.category as { icon: string; name_th: string };
      const key = `${row.type}:${cat.name_th}`;
      const entry = byCategory.get(key);
      if (entry) entry.total += amount;
      else byCategory.set(key, { icon: cat.icon, name: cat.name_th, total: amount });
    }
  }

  const lines = [
    `📅 ${title}`,
    "",
    `เงินเข้า    ฿${fmt(income)}`,
    `เงินออก     ฿${fmt(expense)}`,
    "──────────",
    `สุทธิ      ${income - expense >= 0 ? "+" : "-"}฿${fmt(Math.abs(income - expense))}`,
  ];

  const expenseCats = [...byCategory.entries()]
    .filter(([key]) => key.startsWith("expense:"))
    .sort((a, b) => b[1].total - a[1].total);
  if (expenseCats.length > 0) {
    lines.push("", "รายจ่าย", "");
    for (const [, cat] of expenseCats) {
      lines.push(`${cat.icon} ${cat.name}  ฿${fmt(cat.total)}`);
    }
  }

  return lines.join("\n");
}

async function recentText(userId: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("transactions")
    .select("type, amount, category:categories(icon, name_th)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    throw new Error(`recent query failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    return "🕘 ล่าสุด\n\nยังไม่มีรายการครับ";
  }

  const lines = data.map((row) => {
    const cat = row.category as { icon: string; name_th: string } | null;
    const sign = row.type === "expense" ? "-" : "+";
    return `${cat?.icon ?? "📦"} ${cat?.name_th ?? "—"}  ${sign}${fmt(Number(row.amount))}`;
  });

  return ["🕘 ล่าสุด", "", ...lines].join("\n");
}

// ---- AI save flow ----

async function saveTransaction(
  userId: string,
  parsed: ParsedTransaction,
  eventKey: string,
): Promise<string> {
  const admin = createAdminClient();

  // Atomic + idempotent: the webhook event marker and the transaction are
  // written in one transaction, so duplicate LINE deliveries cannot
  // double-save (audit item 4).
  const { data: status, error } = await admin.rpc("save_line_transaction", {
    p_event_key: eventKey,
    p_user_id: userId,
    p_type: parsed.type,
    p_amount: parsed.amount,
    p_category_slug: parsed.category,
    p_description: parsed.description,
    p_transaction_date: parsed.date,
  });

  if (error) {
    console.error("[line-bot] save failed:", error.message);
    return "บันทึกไม่สำเร็จครับ ลองใหม่อีกครั้งนะครับ";
  }
  if (status === "duplicate") {
    return "รายการนี้บันทึกไปแล้วครับ ✅";
  }
  if (status !== "saved") {
    return "หมวดหมู่ไม่ถูกต้องครับ ลองพิมพ์ใหม่อีกครั้งนะครับ";
  }

  const { data: category } = await admin
    .from("categories")
    .select("icon, name_th")
    .eq("slug", parsed.category)
    .single();

  const head = `✅ บันทึกแล้ว\n\n${category?.icon ?? "📦"} ${category?.name_th ?? parsed.description}\n${fmt(parsed.amount)} บาท`;
  if (parsed.type !== "expense") {
    return head;
  }

  const today = todayISO();
  const rows = await rangeRows(admin, userId, { from: today, to: today });
  const spentToday = rows
    .filter((r) => r.type === "expense")
    .reduce((sum, r) => sum + Number(r.amount), 0);

  return `${head}\n\nวันนี้ใช้ไปแล้ว ${fmt(spentToday)} บาท`;
}

// ---- entry point used by the webhook ----

export async function handleLineMessage(
  lineUserId: string,
  text: string,
  eventKey = "manual",
): Promise<string> {
  const trimmed = text.trim();

  if (LINK_CODE_RE.test(trimmed.toUpperCase())) {
    return linkByCode(lineUserId, trimmed.toUpperCase());
  }

  const admin = createAdminClient();
  const userId = await resolveUserId(admin, lineUserId);
  if (!userId) {
    return NOT_LINKED_TEXT;
  }

  if (trimmed === "วันนี้") {
    const today = todayISO();
    return summaryForRange(userId, { from: today, to: today }, "วันนี้");
  }
  if (trimmed === "เดือนนี้") {
    const range = monthRange();
    const now = new Date();
    return summaryForRange(
      userId,
      range,
      `${now.getMonth() + 1}/${now.getFullYear()}`,
    );
  }
  if (trimmed === "ล่าสุด") {
    return recentText(userId);
  }
  if (trimmed === "ช่วย" || trimmed.toLowerCase() === "help") {
    return HELP_TEXT;
  }

  let parsed: ParsedTransaction | null = null;
  try {
    parsed = await new GeminiParser().parseTransaction(trimmed);
  } catch (err) {
    console.error("[line-bot] gemini parse failed:", err);
    return "เกิดข้อผิดพลาดในการวิเคราะห์ครับ ลองส่งใหม่อีกครั้งนะครับ";
  }

  if (!parsed) {
    return "ไม่เข้าใจข้อความครับ ลองแบบนี้ดู: กินข้าว 120 หรือพิมพ์ ช่วย เพื่อดูตัวอย่าง";
  }

  return saveTransaction(userId, parsed, eventKey);
}
