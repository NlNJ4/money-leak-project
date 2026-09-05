import "server-only";
import { parseTransactionWithStatus } from "@/lib/ai/pipeline";
import type { ParsedTransaction } from "@/lib/ai/provider";
import { recordMetrics } from "@/lib/observability";
import { monthRange, todayISO } from "@/lib/date";
import { createAdminClient } from "@/lib/supabase/admin";

// All replies are Thai-first: the bot conversation is Thai per the spec.
function fmt(n: number): string {
  return n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

const LINK_CODE_RE = /^money-([A-Za-z0-9_-]{22})$/i;

// Undo commands, matched after collapsing whitespace so spacing variations
// ("ลบ ล่าสุด", "ยกเลิกรายการล่าสุด") all work.
const UNDO_RE = /^(?:ยกเลิก|ลบ)(?:รายการ)?ล่าสุด$/;

// Restore the just-deleted transaction (within the 2-minute window).
const RESTORE_RE = /^กู้คืน(ล่าสุด)?$/;

// "แก้ล่าสุด 80" / "แก้ 80" / "แก้ 80 บาท" — fix the latest amount.
const EDIT_LATEST_RE = /^แก้(?:ล่าสุด|รายการล่าสุด)?\s+([\d,]+(?:\.\d+)?)\s*(?:บาท)?$/;

// Brute-force guard for code redemption: 5 attempts per LINE user per hour,
// counted atomically in the database (register_redeem_attempt RPC) so it
// holds across serverless instances.
async function redeemAllowed(
  admin: ReturnType<typeof createAdminClient>,
  lineUserId: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("register_redeem_attempt", {
    p_line_user_id: lineUserId,
  });
  if (error) {
    // Fail open: a limiter outage must not lock real users out of linking.
    console.error("[line-bot] rate limit check failed:", error.message);
    return true;
  }
  return data === true;
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
  "",
  "พิมพ์ผิด? พิมพ์ ลบล่าสุด เพื่อลบรายการล่าสุด",
  "แล้วพิมพ์ กู้คืน ภายใน 2 นาที เพื่อเอากลับ",
  "แก้จำนวนเงิน: แก้ล่าสุด 80",
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
  commandKey = "",
): Promise<string> {
  const admin = createAdminClient();

  if (!(await redeemAllowed(admin, lineUserId))) {
    return "พยายามหลายครั้งเกินไปครับ ลองอีกครั้งในภายหลังนะครับ";
  }

  const { data: status, error } = await admin.rpc("redeem_linking_code", {
    p_event_key: commandKey,
    p_code: code,
    p_provider: "line",
    p_provider_user_id: lineUserId,
  });

  if (error) {
    // Database-level failure: propagate so the queue retries the job.
    throw new Error(`redeem_linking_code failed: ${error.message}`);
  }

  switch (status) {
    case "linked":
      return "เชื่อมต่อสำเร็จ ✅\nเริ่มบันทึกได้เลย เช่น กินข้าว 120";
    case "already_linked_same":
      return "บัญชีนี้เชื่อมต่อไว้แล้วครับ ✅";
    case "already_linked_other":
      return "LINE นี้ถูกเชื่อมต่อกับบัญชีอื่นอยู่แล้วครับ";
    case "user_already_linked":
      return "บัญชีเว็บนี้เชื่อมต่อกับ LINE อื่นอยู่แล้วครับ";
    case "expired":
      return "โค้ดนี้หมดอายุแล้วครับ กดขอโค้ดใหม่ในหน้าแดชบอร์ดได้เลยครับ";
    default:
      return "ไม่พบโค้ดนี้ครับ ตรวจสอบในหน้าแดชบอร์ดอีกครั้งนะครับ";
  }
}

// ---- summaries (no AI needed per spec section 11) ----

type Range = { from: string; to: string };

type SummaryCategory = {
  type: string;
  icon: string;
  name: string;
  total: number;
};

// Aggregation happens in SQL (line_range_summary) — fetching rows and
// summing in JavaScript silently undercounts past the hosted 1000-row
// limit.
async function rangeSummary(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  range: Range,
): Promise<{ income: number; expense: number; categories: SummaryCategory[] }> {
  const { data, error } = await admin.rpc("line_range_summary", {
    p_user_id: userId,
    p_from: range.from,
    p_to: range.to,
  });

  if (error) {
    // Never answer with a believable ฿0 summary on a database failure.
    throw new Error(`summary query failed: ${error.message}`);
  }

  const value = Array.isArray(data) ? data[0] : data;
  const parsed = value as unknown as {
    income?: number | string;
    expense?: number | string;
    categories?: SummaryCategory[];
  } | null;

  return {
    income: Number(parsed?.income ?? 0),
    expense: Number(parsed?.expense ?? 0),
    categories: parsed?.categories ?? [],
  };
}

async function summaryForRange(
  userId: string,
  range: Range,
  title: string,
): Promise<string> {
  const admin = createAdminClient();
  const summary = await rangeSummary(admin, userId, range);
  const { income, expense } = summary;

  const lines = [
    `📅 ${title}`,
    "",
    `เงินเข้า    ฿${fmt(income)}`,
    `เงินออก     ฿${fmt(expense)}`,
    "──────────",
    `สุทธิ      ${income - expense >= 0 ? "+" : "-"}฿${fmt(Math.abs(income - expense))}`,
  ];

  const expenseCats = summary.categories
    .filter((cat) => cat.type === "expense")
    .sort((a, b) => b.total - a.total);
  if (expenseCats.length > 0) {
    lines.push("", "รายจ่าย", "");
    for (const cat of expenseCats) {
      lines.push(`${cat.icon} ${cat.name}  ฿${fmt(Number(cat.total))}`);
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

// ---- undo (delete latest transaction) ----

type UndoResult = {
  status: string;
  type?: string;
  amount?: number | string;
  description?: string;
  icon?: string;
  name?: string;
};

// One atomic RPC: locks the newest transaction and deletes it, so two
// rapid-fire undo commands can never remove two rows.
async function undoLatest(
  lineUserId: string,
  commandKey: string,
): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("delete_latest_line_transaction", {
    p_event_key: commandKey,
    p_line_user_id: lineUserId,
  });

  if (error || !data) {
    // Database-level failure: propagate so the queue retries the job.
    throw new Error(`delete_latest_line_transaction failed: ${error?.message ?? "no result"}`);
  }

  const result = data as UndoResult;
  if (result.status === "not_linked") {
    return NOT_LINKED_TEXT;
  }
  if (result.status !== "deleted") {
    return "ยังไม่มีรายการให้ลบครับ";
  }

  return [
    "🗑 ลบรายการล่าสุดแล้ว",
    "",
    `${result.icon ?? "📦"} ${result.name ?? ""}${result.description ? ` · ${result.description}` : ""}`,
    `${fmt(Number(result.amount ?? 0))} บาท`,
    "",
    "↩️ พิมพ์ กู้คืน ภายใน 2 นาที เพื่อเอารายการนี้กลับครับ",
  ].join("\n");
}

async function restoreLatest(
  lineUserId: string,
  commandKey: string,
): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("restore_latest_line_transaction", {
    p_event_key: commandKey,
    p_line_user_id: lineUserId,
  });

  if (error || !data) {
    throw new Error(`restore_latest_line_transaction failed: ${error?.message ?? "no result"}`);
  }

  const result = data as { status: string; description?: string; amount?: number | string };
  if (result.status === "nothing_to_restore") {
    return "ไม่มีรายการที่ลบไว้ภายใน 2 นาทีครับ";
  }
  if (result.status === "not_linked") {
    return NOT_LINKED_TEXT;
  }
  if (result.status !== "restored") {
    return "กู้คืนไม่สำเร็จครับ";
  }

  return [
    "↩️ กู้คืนรายการแล้ว",
    "",
    `${result.description ? `${result.description} · ` : ""}${fmt(Number(result.amount ?? 0))} บาท`,
  ].join("\n");
}

async function updateLatestAmount(
  lineUserId: string,
  amount: number,
  commandKey: string,
): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("update_latest_line_transaction_amount", {
    p_event_key: commandKey,
    p_line_user_id: lineUserId,
    p_amount: amount,
  });

  if (error || !data) {
    throw new Error(`update_latest_line_transaction_amount failed: ${error?.message ?? "no result"}`);
  }

  const result = data as {
    status: string;
    amount?: number | string;
    description?: string;
    icon?: string;
    name?: string;
  };
  if (result.status === "invalid_amount") {
    return "จำนวนเงินไม่ถูกต้องครับ ลองแบบนี้: แก้ล่าสุด 80";
  }
  if (result.status === "not_linked") {
    return NOT_LINKED_TEXT;
  }
  if (result.status === "not_found") {
    return "ยังไม่มีรายการให้แก้ครับ";
  }
  if (result.status !== "updated") {
    return "แก้ไขไม่สำเร็จครับ";
  }

  return [
    "✏️ แก้จำนวนเงินรายการล่าสุดแล้ว",
    "",
    `${result.icon ?? "📦"} ${result.name ?? ""}${result.description ? ` · ${result.description}` : ""}`,
    `${fmt(Number(result.amount ?? 0))} บาท`,
  ].join("\n");
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
    // Database-level failure: propagate so the queue retries the job.
    throw new Error(`save_line_transaction failed: ${error.message}`);
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
  const summary = await rangeSummary(admin, userId, { from: today, to: today });

  return `${head}\n\nวันนี้ใช้ไปแล้ว ${fmt(summary.expense)} บาท`;
}

// ---- entry point used by the webhook ----

export async function handleLineMessage(
  lineUserId: string,
  text: string,
  eventKey = "manual",
): Promise<string> {
  const trimmed = text.trim();

  // "manual" is the test/default value — commands replay by real webhook
  // event keys only, so manual invocations must not poison the ledger.
  const commandKey = eventKey === "manual" ? "" : eventKey;

  // Normalize the prefix only — the base64url token itself is case-sensitive
  // and must reach the database exactly as generated (audit: uppercase bug).
  const codeMatch = trimmed.match(LINK_CODE_RE);
  if (codeMatch) {
    return linkByCode(lineUserId, `MONEY-${codeMatch[1]}`, commandKey);
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
  if (UNDO_RE.test(trimmed.replace(/\s+/g, ""))) {
    return undoLatest(lineUserId, commandKey);
  }
  const collapsed = trimmed.replace(/\s+/g, " ").trim();
  if (RESTORE_RE.test(collapsed.replace(/\s+/g, ""))) {
    return restoreLatest(lineUserId, commandKey);
  }
  const editMatch = collapsed.match(EDIT_LATEST_RE);
  if (editMatch) {
    return updateLatestAmount(
      lineUserId,
      Number(editMatch[1].replace(/,/g, "")),
      commandKey,
    );
  }
  if (collapsed === "ใช่" || collapsed === "ไม่ใช่") {
    return resolvePendingConfirm(userId, commandKey, collapsed === "ใช่");
  }
  if (trimmed === "ช่วย" || trimmed.toLowerCase() === "help") {
    return HELP_TEXT;
  }

  // Provider/network failures propagate so the queue retries the job.
  // Statuses: rule/gemini → save; unknown → help; quota/circuit → offer
  // the mid-confidence local guess for confirmation instead of guessing.
  const status = await parseTransactionWithStatus(trimmed);

  if (status.via === "quota" || status.via === "circuit") {
    if (status.ruleParsed) {
      return askPendingConfirm(userId, status.ruleParsed, commandKey);
    }
    return "ระบบวิเคราะห์ข้อความไม่พร้อมใช้งานชั่วคราวครับ ลองส่งใหม่อีกครั้งในภายหลังนะครับ";
  }

  if (status.via === "unknown") {
    return "ไม่เข้าใจข้อความครับ ลองแบบนี้ดู: กินข้าว 120 หรือพิมพ์ ช่วย เพื่อดูตัวอย่าง";
  }

  return saveTransaction(userId, status.parsed, eventKey);
}

// ---- ambiguous-confirmation flow (AI unavailable, mid-confidence guess) ----

async function askPendingConfirm(
  userId: string,
  guess: ParsedTransaction,
  commandKey: string,
): Promise<string> {
  if (!commandKey) {
    // Manual/test invocation: no durable event key to bind the confirm to.
    return "ระบบวิเคราะห์ไม่พร้อมใช้งานชั่วคราวครับ ลองส่งใหม่ภายหลังนะครับ";
  }

  const admin = createAdminClient();
  const { error } = await admin.from("line_pending_confirms").upsert(
    {
      event_key: commandKey,
      user_id: userId,
      payload: guess,
      expires_at: new Date(Date.now() + 2 * 60_000).toISOString(),
    },
    { onConflict: "event_key" },
  );

  if (error) {
    throw new Error(`pending confirm insert failed: ${error.message}`);
  }
  void recordMetrics(["confirm_asked"]);

  const { data: category } = await admin
    .from("categories")
    .select("icon, name_th")
    .eq("slug", guess.category)
    .single();

  return [
    "🤔 เข้าใจว่าน่าจะเป็นรายการนี้ (ระบบ AI ไม่พร้อมใช้งานชั่วคราว)",
    "",
    `${category?.icon ?? "📦"} ${category?.name_th ?? guess.category}${guess.description ? ` · ${guess.description}` : ""}`,
    `${fmt(guess.amount)} บาท`,
    "",
    "พิมพ์ ใช่ เพื่อบันทึก หรือ ไม่ใช่ เพื่อข้าม (ภายใน 2 นาที)",
  ].join("\n");
}

async function resolvePendingConfirm(
  userId: string,
  _commandKey: string,
  accepted: boolean,
): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("take_pending_confirm", {
    p_user_id: userId,
  });

  if (error) {
    throw new Error(`take_pending_confirm failed: ${error.message}`);
  }
  if (!data) {
    return "ไม่มีรายการที่รอยืนยันครับ";
  }

  if (!accepted) {
    void recordMetrics(["confirm_no"]);
    return "ข้ามรายการนี้แล้วครับ";
  }

  void recordMetrics(["confirm_yes"]);
  const { event_key: eventKey, payload } = data as {
    event_key: string;
    payload: ParsedTransaction;
  };
  return saveTransaction(userId, payload, eventKey);
}
