import "server-only";
import { z } from "zod";
import { CATEGORY_SLUGS } from "@/lib/categories";
import type {
  ParsedTransaction,
  TransactionParser,
} from "@/lib/ai/provider";

const DEFAULT_MODEL = "gemini-2.5-flash";
// Used when the primary model is rate-limited or overloaded (429/5xx).
// Set GEMINI_FALLBACK_MODEL="" to disable.
const DEFAULT_FALLBACK_MODEL = "gemini-2.5-flash";
const RETRYABLE_STATUS = new Set([429, 500, 502, 503]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const responseSchema = z.object({
  kind: z.enum(["transaction", "unknown"]),
  type: z.enum(["income", "expense"]).optional(),
  amount: z.number().positive().optional(),
  category: z.enum(CATEGORY_SLUGS).optional(),
  description: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function buildPrompt(text: string): string {
  const today = new Date();
  const todayISO = today.toISOString().slice(0, 10);

  return `คุณคือผู้ช่วยบันทึกรายรับรายจ่าย จงแปลงข้อความภาษาไทยหรืออังกฤษเป็นข้อมูลธุรกรรม

กฎ:
- ถ้าข้อความไม่ใช่การบันทึกรายรับหรือรายจ่าย ให้ตอบ {"kind":"unknown"}
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
"เมื่อวานไปกินตี๋น้อยกับเพื่อนหมดไป 829" → {"kind":"transaction","type":"expense","amount":829,"category":"food","description":"ไปกินตี๋น้อยกับเพื่อน","date":"<วันเมื่อวาน>"}
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
    const fallback = process.env.GEMINI_FALLBACK_MODEL ?? DEFAULT_FALLBACK_MODEL;
    const models = [...new Set([primary, fallback].filter(Boolean))];

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
    let response: Response | undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await sleep(1500 * attempt);
      }
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({
            contents: [{ parts: [{ text: buildPrompt(text) }] }],
            generationConfig: {
              temperature: 0,
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
                required: ["kind"],
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
      return null;
    }

    // Never trust the model output — validate shape, amount and category.
    const parsed = responseSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.kind !== "transaction") {
      return null;
    }
    const d = parsed.data;
    if (!d.type || !d.amount || !d.category || !d.date) {
      return null;
    }

    return {
      type: d.type,
      amount: d.amount,
      category: d.category,
      description: d.description?.trim() || d.category,
      date: d.date,
    };
  }
}
