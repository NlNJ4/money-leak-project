import "server-only";
import { GeminiParser } from "@/lib/ai/gemini";
import type { ParsedTransaction } from "@/lib/ai/provider";
import { createAdminClient } from "@/lib/supabase/admin";

// All replies are Thai-first: the bot conversation is Thai per the spec.
function fmt(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

const LINK_CODE_RE = /^MONEY-\d{4}$/;

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
  "2. ส่งโค้ดที่ได้ (เช่น MONEY-1234) มาที่นี่",
].join("\n");

async function resolveUserId(
  admin: ReturnType<typeof createAdminClient>,
  lineUserId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("user_identities")
    .select("user_id")
    .eq("provider", "line")
    .eq("provider_user_id", lineUserId)
    .maybeSingle();
  return data?.user_id ?? null;
}

// ---- linking ----

export async function linkByCode(
  lineUserId: string,
  code: string,
): Promise<string> {
  const admin = createAdminClient();

  const { data: linkRow } = await admin
    .from("linking_codes")
    .select("user_id, expires_at")
    .eq("code", code)
    .maybeSingle();

  if (!linkRow) {
    return "ไม่พบโค้ดนี้ครับ ตรวจสอบในหน้าแดชบอร์ดอีกครั้งนะครับ";
  }
  if (new Date(linkRow.expires_at) < new Date()) {
    return "โค้ดนี้หมดอายุแล้วครับ กดขอโค้ดใหม่ในหน้าแดชบอร์ดได้เลยครับ";
  }

  const { data: existing } = await admin
    .from("user_identities")
    .select("user_id")
    .eq("provider", "line")
    .eq("provider_user_id", lineUserId)
    .maybeSingle();

  if (existing) {
    return existing.user_id === linkRow.user_id
      ? "บัญชีนี้เชื่อมต่อไว้แล้วครับ ✅"
      : "LINE นี้ถูกเชื่อมต่อกับบัญชีอื่นอยู่แล้วครับ";
  }

  const { error } = await admin.from("user_identities").insert({
    user_id: linkRow.user_id,
    provider: "line",
    provider_user_id: lineUserId,
  });
  if (error) {
    return "เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้งครับ";
  }

  await admin.from("linking_codes").delete().eq("code", code);
  return "เชื่อมต่อสำเร็จ ✅\nเริ่มบันทึกได้เลย เช่น กินข้าว 120";
}

// ---- summaries (no AI needed per spec section 11) ----

type Range = { from: string; to: string };

async function rangeRows(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  range: Range,
) {
  const { data } = await admin
    .from("transactions")
    .select(
      "type, amount, transaction_date, category:categories(icon, name_th)",
    )
    .eq("user_id", userId)
    .gte("transaction_date", range.from)
    .lte("transaction_date", range.to)
    .order("transaction_date", { ascending: false });
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
  const { data } = await admin
    .from("transactions")
    .select("type, amount, category:categories(icon, name_th)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(5);

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
): Promise<string> {
  const admin = createAdminClient();

  const { data: category } = await admin
    .from("categories")
    .select("id, type, icon, name_th")
    .eq("slug", parsed.category)
    .single();

  if (!category || category.type !== parsed.type) {
    return "หมวดหมู่ไม่ถูกต้องครับ ลองพิมพ์ใหม่อีกครั้งนะครับ";
  }

  const { error } = await admin.from("transactions").insert({
    user_id: userId,
    type: parsed.type,
    amount: parsed.amount,
    category_id: category.id,
    description: parsed.description,
    transaction_date: parsed.date,
    source: "line",
  });

  if (error) {
    return "บันทึกไม่สำเร็จครับ ลองใหม่อีกครั้งนะครับ";
  }

  const head = `✅ บันทึกแล้ว\n\n${category.icon} ${category.name_th}\n${fmt(parsed.amount)} บาท`;
  if (parsed.type !== "expense") {
    return head;
  }

  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  const rows = await rangeRows(admin, userId, { from: iso, to: iso });
  const spentToday = rows
    .filter((r) => r.type === "expense")
    .reduce((sum, r) => sum + Number(r.amount), 0);

  return `${head}\n\nวันนี้ใช้ไปแล้ว ${fmt(spentToday)} บาท`;
}

// ---- entry point used by the webhook ----

export async function handleLineMessage(
  lineUserId: string,
  text: string,
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
    return summaryForRange(userId, { from: isoToday(), to: isoToday() }, "วันนี้");
  }
  if (trimmed === "เดือนนี้") {
    const now = new Date();
    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const to = isoToday();
    return summaryForRange(
      userId,
      { from, to },
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
  } catch {
    return "เกิดข้อผิดพลาดในการวิเคราะห์ครับ ลองส่งใหม่อีกครั้งนะครับ";
  }

  if (!parsed) {
    return "ไม่เข้าใจข้อความครับ ลองแบบนี้ดู: กินข้าว 120 หรือพิมพ์ ช่วย เพื่อดูตัวอย่าง";
  }

  return saveTransaction(userId, parsed);
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
