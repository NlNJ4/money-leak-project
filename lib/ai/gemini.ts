import "server-only";
import { z } from "zod";
import {
  CATEGORY_SLUGS,
  EXPENSE_CATEGORY_SLUGS,
  INCOME_CATEGORY_SLUGS,
} from "@/lib/categories";
import { isValidISODate, toISODate, todayISO as todayISOBangkok } from "@/lib/date";
import type {
  ParsedTransaction,
  TransactionParser,
} from "@/lib/ai/provider";

const DEFAULT_MODEL = "gemini-3.7-flash";
// Kept as a final low-latency fallback even when GEMINI_FALLBACK_MODEL is set.
// This parser is a small extraction task, so Flash-Lite is a better emergency
// option than waiting on another reasoning-heavy model during capacity spikes.
const DEFAULT_FALLBACK_MODEL = "gemini-3.5-flash-lite";
const RETRYABLE_STATUS = new Set([500, 502, 503]);
const RETRY_DELAY_MS = 300;
// Read at call time so tests can point the parser at a local mock.
function geminiBaseUrl(): string {
  return process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com";
}
function requestTimeoutMs(): number {
  return Number(process.env.GEMINI_TIMEOUT_MS) || 8_000;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const responseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unknown") }),
  z.object({
    kind: z.literal("transaction"),
    type: z.enum(["income", "expense"]),
    amount: z.number().positive(),
    category: z.enum(CATEGORY_SLUGS),
    description: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
]);

// Same limits the web form and rule parser enforce (lib/validation.ts,
// lib/ai/rule-parser.ts): the model output must never bypass them.
const MAX_AMOUNT = 999_999_999;

// Returns a reason string when the parsed transaction violates the app's
// own validation rules, else null.
function validateParsed(d: {
  type: "income" | "expense";
  amount: number;
  category: (typeof CATEGORY_SLUGS)[number];
  description: string;
  date: string;
}): string | null {
  if (d.amount <= 0 || d.amount > MAX_AMOUNT) {
    return "amount out of range";
  }
  if (!isValidISODate(d.date)) {
    return "date is not a real calendar date";
  }
  if (d.description.trim().length > 200) {
    return "description too long";
  }
  const allowed =
    d.type === "expense" ? EXPENSE_CATEGORY_SLUGS : INCOME_CATEGORY_SLUGS;
  if (!(allowed as readonly string[]).includes(d.category)) {
    return "category does not match type";
  }
  return null;
}

function buildPrompt(text: string): string {
  // Bangkok wall-clock "today", so relative dates resolve correctly on UTC
  // servers between 00:00 and 07:00 ICT (audit item 9).
  const todayISO = todayISOBangkok();
  const yesterdayISO = toISODate(new Date(Date.now() - 86_400_000));

  return `คุณคือผู้ช่วยบันทึกรายรับรายจ่าย จงแปลงข้อความภาษาไทยหรืออังกฤษเป็นข้อมูลธุรกรรม

กฎ:
- ต้องตอบครบทั้ง 6 fields: kind, type, amount, category, description, date
- ถ้าข้อความไม่ใช่การบันทึกรายรับหรือรายจ่าย ให้ตอบ {"kind":"unknown","type":"expense","amount":0,"category":"other","description":"","date":"${todayISO}"}
- amount ต้องเป็นตัวเลข ไม่มีสัญลักษณ์สกุลเงิน
- type: "expense" ถ้าเป็นการใช้เงิน, "income" ถ้าเป็นการได้รับเงิน (ได้เงิน, รับเงิน, ขายของ, เงินเดือน)
- category ต้องเลือกจากรายการนี้เท่านั้น:
  expense: food(อาหาร,กิน,กาแฟ,ข้าว), transport(น้ำมัน,เติมน้ำมัน,แท็กซี่,รถเมล์,เดินทาง), shopping(ช้อป,ซื้อของ), housing(ค่าเช่า,ผ่อนบ้าน), bills(ค่าน้ำ,ค่าไฟ,เน็ต,โทรศัพท์), health(หมอ,ยา,โรงพยาบาล), entertainment(หนัง,เกม,เที่ยว), family(ให้แม่,ให้พ่อ,ลูก,ครอบครัว), other
  income: salary(เงินเดือน), freelance(ฟรีแลนซ์,งานนอก), investment(ปันผล,ขายหุ้น,ดอกเบี้ย), refund(เงินคืน,คืนเงิน), other_income(ได้เงิน,รับเงิน)
- date: วันที่ทำธุรกรรมเป็น YYYY-MM-DD เทียบจาก "วันนี้" = ${todayISO}
  ("เมื่อวาน" = วันก่อนวันนี้, "มื้อเช้า/วันนี้" ไม่ระบุ = วันนี้) ถ้าไม่แน่ใจให้ใช้ ${todayISO}
- description: สิ่งที่จ่ายหรือรับ (ตัดจำนวนเงินออก)

ตัวอย่าง:
"กินข้าว 120" → {"kind":"transaction","type":"expense","amount":120,"category":"food","description":"กินข้าว","date":"${todayISO}"}
"ได้เงิน 2000" → {"kind":"transaction","type":"income","amount":2000,"category":"other_income","description":"ได้เงิน","date":"${todayISO}"}
"เติมน้ำมัน 800" → {"kind":"transaction","type":"expense","amount":800,"category":"transport","description":"เติมน้ำมัน","date":"${todayISO}"}
"เมื่อวานไปกินตี๋น้อยกับเพื่อนหมดไป 829" → {"kind":"transaction","type":"expense","amount":829,"category":"food","description":"ไปกินตี๋น้อยกับเพื่อน","date":"${yesterdayISO}"}
"ให้แม่ 2000" → {"kind":"transaction","type":"expense","amount":2000,"category":"family","description":"ให้แม่","date":"${todayISO}"}

ข้อความของผู้ใช้:
"${text.replace(/"/g, "'")}"`;
}

export class GeminiParser implements TransactionParser {
  async parseTransaction(text: string): Promise<ParsedTransaction | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    const primary = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const configuredFallback = process.env.GEMINI_FALLBACK_MODEL;
    const models = [
      ...new Set(
        [primary, configuredFallback, DEFAULT_FALLBACK_MODEL].filter(
          (model): model is string => Boolean(model),
        ),
      ),
    ];

    let lastError: unknown;
    for (const model of models) {
      try {
        const result = await this.attemptModel(model, text);
        if (model !== primary) {
          console.warn(`[gemini] primary ${primary} unavailable, used fallback ${model}`);
        }
        return result;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error("Gemini parse failed");
  }

  private async attemptModel(
    model: string,
    text: string,
  ): Promise<ParsedTransaction | null> {
    const apiKey = process.env.GEMINI_API_KEY!;
    // Bound each model so a congested endpoint cannot consume LINE's entire
    // reply-token window before the low-latency fallback gets a chance.
    let response: Response | undefined;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_DELAY_MS);
      }
      response = await fetch(
        `${geminiBaseUrl()}/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          signal: AbortSignal.timeout(requestTimeoutMs()),
          body: JSON.stringify({
            contents: [{ parts: [{ text: buildPrompt(text) }] }],
            generationConfig: {
              // Gemini 3.x removed temperature/top_p/top_k; sending them may
              // fail the request (audit item 7).
              ...(/^gemini-3/.test(model) ? {} : { temperature: 0 }),
              responseMimeType: "application/json",
              responseSchema: {
                type: "object",
                properties: {
                  kind: { type: "string", enum: ["transaction", "unknown"] },
                  type: { type: "string", enum: ["income", "expense"] },
                  amount: { type: "number" },
                  category: { type: "string", enum: [...CATEGORY_SLUGS] },
                  description: { type: "string" },
                  date: { type: "string" },
                },
                required: [
                  "kind",
                  "type",
                  "amount",
                  "category",
                  "description",
                  "date",
                ],
              },
            },
          }),
        },
      );
      if (response.ok || !RETRYABLE_STATUS.has(response.status)) {
        break;
      }
    }

    if (!response || !response.ok) {
      const status = response?.status ?? "no response";
      const detail = response ? await response.text() : "";
      throw new Error(`Gemini API failed: ${status} ${detail}`);
    }

    const payload = await response.json();
    const raw = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof raw !== "string") {
      console.warn("[gemini] no text candidate returned");
      return null;
    }

    // Never trust the model output. Invalid structured output is a provider
    // failure, not an "unknown" user message, so let parseTransaction try the
    // next model instead of returning a misleading help response.
    const parsed = responseSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(`Gemini returned invalid structured output: ${raw.slice(0, 300)}`);
    }
    if (parsed.data.kind === "unknown") {
      return null;
    }
    const d = parsed.data;

    // Invalid values are a provider failure, not a user message: throw so
    // parseTransaction tries the next model instead of enqueueing a
    // transaction the database will reject.
    const violation = validateParsed(d);
    if (violation) {
      throw new Error(`Gemini output rejected (${violation}): ${JSON.stringify(d).slice(0, 200)}`);
    }

    return {
      type: d.type,
      amount: d.amount,
      category: d.category,
      description: d.description.trim().slice(0, 200) || d.category,
      date: d.date,
    };
  }
}
