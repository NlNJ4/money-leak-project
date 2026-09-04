import { toISODate, todayISO } from "@/lib/date";
import type { CategorySlug, TransactionType } from "@/lib/categories";
import type { ParsedTransaction } from "@/lib/ai/provider";

// Local, zero-cost parser for the common Thai expense/income shorthand
// ("<something> <amount>"). It handles what daily messages actually look
// like; anything unusual comes back with a low confidence and the pipeline
// escalates to Gemini. Category vocabulary mirrors the Gemini prompt in
// lib/ai/gemini.ts so both paths classify consistently.

export type RuleParseResult = {
  parsed: ParsedTransaction | null;
  confidence: number;
};

// Category keyword hits are trusted outright; a missing category keyword
// falls back to "other" with slightly lower (still usable) confidence.
const CONFIDENCE_MATCHED = 0.9;
const CONFIDENCE_FALLBACK = 0.75;
// Below-threshold outcomes: never auto-saved, always escalated.
const CONFIDENCE_NO_VERB = 0.4; // no keyword AND no transaction verb
const CONFIDENCE_EXPLICIT_DATE = 0.3; // dates the rules refuse to guess on
const CONFIDENCE_AMBIGUOUS = 0.2; // multiple/invalid/negative/percent/time
const CONFIDENCE_BARE_AMOUNT = 0.5; // number with no description text
const CONFIDENCE_NOT_TRANSACTION = 0;

const MAX_AMOUNT = 999_999_999;

const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;
// Thai digits (U+0E50..) and Arabic-Indic digits (U+0660..) both sit 0x30
// below their ASCII counterparts' block start.
const THAI_DIGITS_RE = /[\u0E50-\u0E59]/g;
const ARABIC_INDIC_DIGITS_RE = /[\u0660-\u0669]/g;
const CURRENCY_RE = /บาท|฿|thb/gi;
// Comma-grouped numbers must match as one token, not "1" + "250".
const NUMBER_RE = /\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d+)?/g;

// Ordering matters: transport before bills because "ค่าน้ำมัน" contains
// both "น้ำมัน" (fuel) and "ค่าน้ำ" (water bill) — fuel must win. Within a
// category, keywords are unordered; first category with any hit claims it.
const EXPENSE_KEYWORDS: ReadonlyArray<
  readonly [CategorySlug, readonly string[]]
> = [
  [
    "transport",
    ["น้ำมัน", "รถเมล์", "รถไฟ", "แท็กซี่", "แท็กซี", "ค่ารถ", "ค่าเดินทาง", "เดินทาง", "ตั๋ว", "bts", "mrt", "รถ"],
  ],
  [
    "bills",
    ["ค่าไฟ", "ค่าน้ำ", "ค่าเน็ต", "ค่าโทร", "โทรศัพท์", "อินเทอร์เน็ต", "เน็ต", "ค่าก๊าซ"],
  ],
  [
    "food",
    ["กิน", "ข้าว", "กาแฟ", "กาฟเฟ่", "ชา", "นม", "ก๋วยเตี๋ยว", "ตี๋น้อย", "อาหาร", "ขนม", "ของกิน", "มื้อ", "ส้มตำ", "ชาบู", "หมูกระทะ", "โกโก้", "น้ำอัดลม", "น้ำดื่ม", "น้ำ", "เบียร์"],
  ],
  [
    "housing",
    ["ค่าเช่า", "เช่าบ้าน", "ผ่อนบ้าน", "ผ่อนคอนโด", "คอนโด", "หอพัก", "ผ่อน"],
  ],
  [
    "health",
    ["ค่ายา", "โรงพยาบาล", "คลินิก", "หมอ", "ยา", "ฟัน", "วัคซีน", "ตรวจสุขภาพ"],
  ],
  [
    "entertainment",
    ["หนัง", "ซีรีส์", "เกม", "เที่ยว", "ท่องเที่ยว", "คอนเสิร์ต", "netflix", "ทริป"],
  ],
  [
    "family",
    ["ให้แม่", "ให้พ่อ", "ให้ลูก", "ครอบครัว", "เลี้ยงพ่อ", "เลี้ยงแม่", "ค่าเลี้ยง"],
  ],
  [
    "shopping",
    ["ช้อป", "ซื้อของ", "ช้อปปิ้ง", "ตลาด", "เสื้อ", "รองเท้า", "เครื่องสำอาง"],
  ],
];

const INCOME_KEYWORDS: ReadonlyArray<
  readonly [CategorySlug, readonly string[]]
> = [
  ["salary", ["เงินเดือน"]],
  ["refund", ["เงินคืน", "คืนเงิน", "คืนสินค้า"]],
  ["freelance", ["ฟรีแลนซ์", "ฟรีแลน", "งานนอก"]],
  ["investment", ["ปันผล", "ดอกเบี้ย", "ขายหุ้น", "หุ้น", "กองทุน", "ทอง"]],
];

const INCOME_TRIGGERS = [
  "ได้เงิน", "รับเงิน", "ได้รับเงิน", "เงินเดือน", "ขายของ", "โบนัส",
  "ฟรีแลนซ์", "ฟรีแลน", "งานนอก", "ปันผล", "ดอกเบี้ย", "เงินคืน",
  "คืนเงิน", "คืนสินค้า", "รายได้",
];

// Date vocabulary the rules refuse to guess on: only today/yesterday are
// resolved locally; everything else escalates so Gemini can use full
// calendar context. (Numeric dates like 10/9 need no pattern here — they
// surface as multiple numbers and are rejected as ambiguous.)
const EXPLICIT_DATE_RE =
  /ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|วันจันทร์|วันอังคาร|วันพุธ|วันพฤหัส|วันศุกร์|วันเสาร์|วันอาทิตย์|เมื่อสัปดาห์ก่อน|สัปดาห์ก่อน|เดือนก่อน|ปีก่อน/;

// Longest first so "เมื่อวานนี้" is stripped whole instead of leaving "นี้".
const YESTERDAY_WORDS = ["เมื่อวานนี้", "เมื่อวาน", "วานนี้"];
const TODAY_WORDS = ["วันนี้", "เมื่อกี้", "เมื่อครู่"];

// When no category keyword matches, an expense still needs an explicit
// transaction verb — otherwise "เจอกัน 5 คน" would auto-save as an "other"
// expense. Income triggers are already verb-like, so income is exempt.
const EXPENSE_VERBS = ["ซื้อ", "จ่าย", "เสีย", "โอน", "ใช้"];

// Conversational time vocabulary: "เจอกัน 5 โมง" is a meetup time, not an
// expense — escalate instead of guessing.
const TIME_WORDS = ["โมง", "ชั่วโมง", "นาที", "นาฬิกา", "ทุ่ม", "ครึ่ง"];
const PERCENT_RE = /%|เปอร์เซ็นต์|เปอร์เซนต์/;
// A minus in front of a number is a meaning we do not guess at (refund?
// debt?) — never silently strip the sign and save a positive amount.
const NEGATIVE_AMOUNT_RE = /-\s*\d/;

// "60k", "1พัน", "2 ล้าน" fold into plain numbers before extraction. The
// lookahead stops "5km" (kilometers) from folding.
const AMOUNT_SUFFIX_RE = /(\d+(?:\.\d+)?)\s*(k|พัน|หมื่น|แสน|ล้าน)(?![a-z])/gi;
const SUFFIX_MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  พัน: 1_000,
  หมื่น: 10_000,
  แสน: 100_000,
  ล้าน: 1_000_000,
};

function foldAmountSuffixes(text: string): string {
  return text.replace(AMOUNT_SUFFIX_RE, (_match, num: string, suffix: string) =>
    String(Number(num) * (SUFFIX_MULTIPLIERS[suffix.toLowerCase()] ?? 1)),
  );
}

function normalize(text: string): string {
  return text
    .normalize("NFC")
    .replace(ZERO_WIDTH_RE, "")
    .replace(THAI_DIGITS_RE, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x0e20),
    )
    .replace(ARABIC_INDIC_DIGITS_RE, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x0630),
    )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function parseWithConfidence(text: string): RuleParseResult {
  const normalized = normalize(text);

  // Hard stops first: signs, percentages, and clock times are meanings the
  // rules must not guess at — escalate rather than mis-save.
  if (
    NEGATIVE_AMOUNT_RE.test(normalized) ||
    PERCENT_RE.test(normalized) ||
    TIME_WORDS.some((word) => normalized.includes(word))
  ) {
    return { parsed: null, confidence: CONFIDENCE_AMBIGUOUS };
  }

  const isYesterday = YESTERDAY_WORDS.some((word) => normalized.includes(word));
  const hasExplicitDate = EXPLICIT_DATE_RE.test(normalized);
  const date = isYesterday
    ? toISODate(new Date(Date.now() - 86_400_000))
    : todayISO();

  const withoutCurrency = foldAmountSuffixes(
    normalized.replace(CURRENCY_RE, " "),
  );
  const amounts = [...withoutCurrency.matchAll(NUMBER_RE)].map((m) => m[0]);

  if (amounts.length === 0) {
    return { parsed: null, confidence: CONFIDENCE_NOT_TRANSACTION };
  }
  if (amounts.length > 1) {
    // Multiple numbers are ambiguous (amount + date? two items?) — escalate.
    return { parsed: null, confidence: CONFIDENCE_AMBIGUOUS };
  }

  const token = amounts[0];
  const amount = Number(token.replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    return { parsed: null, confidence: CONFIDENCE_AMBIGUOUS };
  }

  // Description: whatever remains after the amount, currency, and handled
  // date words are stripped.
  let scrubbed = withoutCurrency.replace(token, " ");
  for (const word of [...YESTERDAY_WORDS, ...TODAY_WORDS]) {
    scrubbed = scrubbed.replaceAll(word, " ");
  }
  const description = scrubbed.replace(/\s+/g, " ").trim().slice(0, 200);

  if (!description) {
    // A bare number with no context — let the AI decide if it's a
    // transaction at all.
    return { parsed: null, confidence: CONFIDENCE_BARE_AMOUNT };
  }

  const type: TransactionType = INCOME_TRIGGERS.some((word) =>
    scrubbed.includes(word),
  )
    ? "income"
    : "expense";

  const fallback: CategorySlug = type === "income" ? "other_income" : "other";
  const table = type === "income" ? INCOME_KEYWORDS : EXPENSE_KEYWORDS;
  let category: CategorySlug = fallback;
  let matched = false;
  for (const [slug, words] of table) {
    if (words.some((word) => scrubbed.includes(word))) {
      category = slug;
      matched = true;
      break;
    }
  }

  const parsed: ParsedTransaction = {
    type,
    amount,
    category,
    description,
    date,
  };

  let confidence = matched ? CONFIDENCE_MATCHED : CONFIDENCE_FALLBACK;
  if (
    !matched &&
    type === "expense" &&
    !EXPENSE_VERBS.some((verb) => scrubbed.includes(verb))
  ) {
    confidence = CONFIDENCE_NO_VERB;
  }
  if (hasExplicitDate) {
    confidence = Math.min(confidence, CONFIDENCE_EXPLICIT_DATE);
  }

  return { parsed, confidence };
}
