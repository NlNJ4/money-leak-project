import { categoryOrder } from "@/lib/categories";
import {
  addDaysToDateKey,
  getBangkokDateKey,
  toBangkokIso,
} from "@/lib/date";
import {
  generateGeminiJson,
  isGeminiConfigured,
  parseGeminiJsonObject,
} from "@/lib/gemini";
import { detectCategory } from "@/lib/parser";
import {
  MAX_EXPENSE_AMOUNT_BAHT,
  MAX_EXPENSE_TITLE_LENGTH,
} from "@/lib/security";
import type { ExpenseCategory } from "@/lib/types";

const MIN_RECEIPT_CONFIDENCE = 0.55;
const MAX_RECEIPT_EXPENSES = 12;

type RawReceiptExpense = {
  title?: unknown;
  amountBaht?: unknown;
  category?: unknown;
  isNeed?: unknown;
};

type RawReceiptParseResult = {
  merchantName?: unknown;
  receiptDate?: unknown;
  totalBaht?: unknown;
  expenses?: unknown;
  needsClarification?: unknown;
  clarificationQuestion?: unknown;
  confidence?: unknown;
};

export type ParsedReceiptExpense = {
  title: string;
  amountBaht: number;
  category: ExpenseCategory;
  isNeed: boolean;
  spentAt?: string;
};

export type ParsedReceipt = {
  merchantName: string | null;
  receiptDateKey: string | null;
  totalBaht: number | null;
  expenses: ParsedReceiptExpense[];
  confidence: number;
  clarificationQuestion: string | null;
};

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    merchantName: {
      type: ["string", "null"],
      description:
        "Store or merchant name if clearly visible. Null if not visible.",
    },
    receiptDate: {
      type: ["string", "null"],
      description:
        "Receipt date as YYYY-MM-DD if clearly visible. Null if not visible.",
    },
    totalBaht: {
      type: ["integer", "null"],
      description:
        "Receipt total paid in Thai baht if clearly visible. Null if uncertain.",
    },
    expenses: {
      type: "array",
      maxItems: MAX_RECEIPT_EXPENSES,
      description:
        "Expense lines to record. Prefer itemized purchased items. If only a total is visible, return one total expense.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: {
            type: "string",
            description:
              "Short expense title without private numbers, phone numbers, card numbers, or receipt ids.",
          },
          amountBaht: {
            type: "integer",
            minimum: 1,
            maximum: MAX_EXPENSE_AMOUNT_BAHT,
            description:
              "Positive integer amount in Thai baht for this line. Do not include change, discounts, or card/payment numbers.",
          },
          category: {
            type: "string",
            enum: categoryOrder,
            description: `One of ${categoryOrder.join(", ")}.`,
          },
          isNeed: {
            type: "boolean",
            description:
              "True for necessary spending such as meals or commute. False for treats, shopping, subscriptions, and delivery convenience.",
          },
        },
        required: ["title", "amountBaht", "category", "isNeed"],
      },
    },
    needsClarification: {
      type: "boolean",
      description:
        "True when the image is not a readable receipt or the spending amount is unclear.",
    },
    clarificationQuestion: {
      type: ["string", "null"],
      description:
        "One short Thai message telling the user what to send again if the receipt is unclear.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Confidence from 0 to 1.",
    },
  },
  required: [
    "merchantName",
    "receiptDate",
    "totalBaht",
    "expenses",
    "needsClarification",
    "clarificationQuestion",
    "confidence",
  ],
} as const;

export function isGeminiReceiptParserConfigured() {
  return isGeminiConfigured();
}

function buildPrompt() {
  return [
    "You are a strict receipt parser for a Thai-first personal expense bot.",
    "Return only structured JSON matching the schema.",
    "Extract expenses from a receipt or payment slip image.",
    "Do not include phone numbers, card numbers, receipt ids, tax ids, addresses, reward points, payment method ids, discounts, change, or VAT-only lines as expense titles.",
    "If the image is a normal receipt with line items, return useful purchased items, capped to the largest or clearest lines.",
    "If the receipt has no readable line items but has a readable total, return one expense using the merchant name or a short title.",
    "Do not invent missing amounts. If the amount is unclear, set needsClarification true and return no expenses.",
    "Use integer Thai baht amounts. Round only visible .00 satang values.",
    "For expense categories use:",
    "- food: meals, rice, noodles, lunch, dinner, restaurant food",
    "- drinks: coffee, tea, water, boba, milk tea",
    "- delivery: delivery fee, Grab, LINE MAN, food delivery",
    "- transport: BTS, MRT, bus, taxi, ride, fuel, commute",
    "- shopping: snacks, convenience store items, Shopee, Lazada, small items",
    "- subscriptions: Netflix, Spotify, YouTube, recurring memberships",
    "- other: clear expenses that do not fit the other categories",
  ].join("\n");
}

function toConfidence(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;

  return Math.min(1, Math.max(0, value));
}

function toPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function toCategory(value: unknown, title: string) {
  if (categoryOrder.includes(value as ExpenseCategory)) {
    return value as ExpenseCategory;
  }

  return detectCategory(title);
}

function toShortString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeReceiptDateKey(value: unknown) {
  if (typeof value !== "string") return null;

  const candidate = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;

  const date = new Date(`${candidate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== candidate) return null;

  const todayKey = getBangkokDateKey();
  const tomorrowKey = addDaysToDateKey(todayKey, 1);
  const earliestKey = addDaysToDateKey(todayKey, -366);

  if (candidate > tomorrowKey || candidate < earliestKey) return null;

  return candidate;
}

function normalizeExpense(
  rawExpense: RawReceiptExpense,
  receiptDateKey: string | null,
): ParsedReceiptExpense | null {
  const title = toShortString(rawExpense.title);
  const amountBaht = toPositiveInteger(rawExpense.amountBaht);

  if (!title || !amountBaht || amountBaht > MAX_EXPENSE_AMOUNT_BAHT) {
    return null;
  }

  return {
    title: title.slice(0, MAX_EXPENSE_TITLE_LENGTH),
    amountBaht,
    category: toCategory(rawExpense.category, title),
    isNeed: rawExpense.isNeed === true,
    spentAt: receiptDateKey ? toBangkokIso(receiptDateKey, 12, 0) : undefined,
  };
}

function normalizeReceipt(rawReceipt: RawReceiptParseResult): ParsedReceipt {
  const confidence = toConfidence(rawReceipt.confidence);
  const receiptDateKey = normalizeReceiptDateKey(rawReceipt.receiptDate);
  const rawExpenses = Array.isArray(rawReceipt.expenses)
    ? rawReceipt.expenses
    : [];
  const expenses =
    confidence >= MIN_RECEIPT_CONFIDENCE && rawReceipt.needsClarification !== true
      ? rawExpenses
          .map((rawExpense) =>
            normalizeExpense(rawExpense as RawReceiptExpense, receiptDateKey),
          )
          .filter((expense): expense is ParsedReceiptExpense => Boolean(expense))
          .slice(0, MAX_RECEIPT_EXPENSES)
      : [];

  return {
    merchantName: toShortString(rawReceipt.merchantName),
    receiptDateKey,
    totalBaht: toPositiveInteger(rawReceipt.totalBaht),
    expenses,
    confidence,
    clarificationQuestion:
      toShortString(rawReceipt.clarificationQuestion) ??
      "อ่านรูปนี้ยังไม่ชัด ลองส่งรูปใบเสร็จที่เห็นยอดเงินครบอีกครั้ง",
  };
}

export async function parseReceiptImageWithGemini({
  imageBase64,
  mimeType,
}: {
  imageBase64: string;
  mimeType: string;
}) {
  const responseText = await generateGeminiJson({
    parts: [
      {
        inline_data: {
          mime_type: mimeType,
          data: imageBase64,
        },
      },
      { text: buildPrompt() },
    ],
    responseJsonSchema,
    maxOutputTokens: 1024,
    timeoutMs: 10_000,
    logLabel: "Gemini receipt parse failed",
  });

  if (!responseText) return null;

  const rawReceipt = parseGeminiJsonObject<RawReceiptParseResult>(responseText);
  if (!rawReceipt) return null;

  return normalizeReceipt(rawReceipt);
}
