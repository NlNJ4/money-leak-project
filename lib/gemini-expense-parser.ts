import { categoryOrder } from "@/lib/categories";
import { detectCategory } from "@/lib/parser";
import type { ExpenseCategory } from "@/lib/types";

const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_TIMEOUT_MS = 6000;
const MIN_CONFIDENCE = 0.55;

const intentActions = [
  "expense",
  "budget",
  "summary_today",
  "summary_month",
  "dashboard",
  "identity",
  "unknown",
] as const;

type IntentAction = (typeof intentActions)[number];

type RawGeminiIntent = {
  action?: unknown;
  title?: unknown;
  amountBaht?: unknown;
  category?: unknown;
  isNeed?: unknown;
  dailyBudgetBaht?: unknown;
  needsClarification?: unknown;
  clarificationQuestion?: unknown;
  confidence?: unknown;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

export type GeminiLineIntent =
  | {
      action: "expense";
      title: string;
      amountBaht: number;
      category: ExpenseCategory;
      isNeed: boolean;
      confidence: number;
    }
  | {
      action: "budget";
      dailyBudgetBaht: number;
      confidence: number;
    }
  | {
      action: "summary_today" | "summary_month" | "dashboard" | "identity";
      confidence: number;
    }
  | {
      action: "clarify";
      clarificationQuestion: string;
      confidence: number;
    }
  | {
      action: "unknown";
      clarificationQuestion: string | null;
      confidence: number;
    };

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: intentActions,
      description:
        "The user's intent. Use expense only when the message is meant to record spending.",
    },
    title: {
      type: ["string", "null"],
      description:
        "Short expense title without filler words. Null when not an expense or missing.",
    },
    amountBaht: {
      type: ["integer", "null"],
      description:
        "Positive integer amount in Thai baht. Convert Thai or English number words when clear. Never invent.",
    },
    category: {
      type: ["string", "null"],
      description: `One of ${categoryOrder.join(", ")}. Null when not an expense.`,
    },
    isNeed: {
      type: ["boolean", "null"],
      description:
        "True for necessary spending such as meals or commute. False for treats, shopping, subscriptions, and delivery convenience.",
    },
    dailyBudgetBaht: {
      type: ["integer", "null"],
      description:
        "Positive integer daily budget in baht when the action is budget. Null otherwise.",
    },
    needsClarification: {
      type: "boolean",
      description:
        "True when required expense or budget details are missing or uncertain.",
    },
    clarificationQuestion: {
      type: ["string", "null"],
      description:
        "One short Thai question asking the user to resend the complete entry in one message.",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Confidence from 0 to 1.",
    },
  },
  required: [
    "action",
    "title",
    "amountBaht",
    "category",
    "isNeed",
    "dailyBudgetBaht",
    "needsClarification",
    "clarificationQuestion",
    "confidence",
  ],
} as const;

export function isGeminiExpenseParserConfigured() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function getGeminiModel() {
  return (process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL).replace(
    /^models\//,
    "",
  );
}

function buildPrompt(text: string) {
  return [
    "You are a strict intent parser for a Thai-first LINE personal expense bot.",
    "Return only structured JSON matching the schema.",
    "Do not guess missing amounts. Do not turn non-expense chat into expenses.",
    "If an expense is missing title or amount, set needsClarification true and ask the user in Thai to resend the complete entry in one message.",
    "For expense categories use:",
    "- food: meals, rice, noodles, lunch, dinner",
    "- drinks: coffee, tea, water, boba, milk tea",
    "- delivery: delivery fee, Grab, LINE MAN, food delivery",
    "- transport: BTS, MRT, bus, taxi, ride, fuel, commute",
    "- shopping: snacks, Shopee, Lazada, small items, general shopping",
    "- subscriptions: Netflix, Spotify, YouTube, recurring memberships",
    "- other: clear expenses that do not fit the other categories",
    "Recognize commands for today/month summaries, dashboard link, identity, and daily budget setting.",
    `User message as JSON string: ${JSON.stringify(text.trim().slice(0, 500))}`,
  ].join("\n");
}

function toIntentAction(value: unknown): IntentAction {
  return intentActions.includes(value as IntentAction)
    ? (value as IntentAction)
    : "unknown";
}

function toPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function toConfidence(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;

  return Math.min(1, Math.max(0, value));
}

function toCategory(value: unknown, title: string) {
  if (categoryOrder.includes(value as ExpenseCategory)) {
    return value as ExpenseCategory;
  }

  return detectCategory(title);
}

function toQuestion(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();

  return "ขอรายละเอียดเป็นชื่อรายการและจำนวนเงินในข้อความเดียว เช่น ข้าว 55";
}

function extractResponseText(payload: GeminiGenerateContentResponse) {
  return (
    payload.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text ??
    null
  );
}

function parseJsonObject(text: string) {
  try {
    return JSON.parse(text) as RawGeminiIntent;
  } catch {
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (!objectMatch) return null;

    try {
      return JSON.parse(objectMatch[0]) as RawGeminiIntent;
    } catch {
      return null;
    }
  }
}

function normalizeIntent(rawIntent: RawGeminiIntent): GeminiLineIntent {
  const action = toIntentAction(rawIntent.action);
  const confidence = toConfidence(rawIntent.confidence);
  const needsClarification = rawIntent.needsClarification === true;

  if (needsClarification) {
    return {
      action: "clarify",
      clarificationQuestion: toQuestion(rawIntent.clarificationQuestion),
      confidence,
    };
  }

  if (action === "expense") {
    const title = typeof rawIntent.title === "string" ? rawIntent.title.trim() : "";
    const amountBaht = toPositiveInteger(rawIntent.amountBaht);

    if (!title || !amountBaht || confidence < MIN_CONFIDENCE) {
      return {
        action: "clarify",
        clarificationQuestion: toQuestion(rawIntent.clarificationQuestion),
        confidence,
      };
    }

    return {
      action: "expense",
      title,
      amountBaht,
      category: toCategory(rawIntent.category, title),
      isNeed: rawIntent.isNeed === true,
      confidence,
    };
  }

  if (action === "budget") {
    const dailyBudgetBaht = toPositiveInteger(rawIntent.dailyBudgetBaht);

    if (!dailyBudgetBaht || confidence < MIN_CONFIDENCE) {
      return {
        action: "clarify",
        clarificationQuestion:
          typeof rawIntent.clarificationQuestion === "string" &&
          rawIntent.clarificationQuestion.trim()
            ? rawIntent.clarificationQuestion.trim()
            : "ต้องการตั้งงบรายวันเท่าไหร่? เช่น budget 200",
        confidence,
      };
    }

    return {
      action: "budget",
      dailyBudgetBaht,
      confidence,
    };
  }

  if (
    action === "summary_today" ||
    action === "summary_month" ||
    action === "dashboard" ||
    action === "identity"
  ) {
    return confidence >= MIN_CONFIDENCE
      ? { action, confidence }
      : {
          action: "unknown",
          clarificationQuestion: toQuestion(rawIntent.clarificationQuestion),
          confidence,
        };
  }

  return {
    action: "unknown",
    clarificationQuestion:
      typeof rawIntent.clarificationQuestion === "string" &&
      rawIntent.clarificationQuestion.trim()
        ? rawIntent.clarificationQuestion.trim()
        : null,
    confidence,
  };
}

export async function parseLineIntentWithGemini(
  text: string,
): Promise<GeminiLineIntent | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${getGeminiModel()}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: buildPrompt(text) }],
            },
          ],
          generationConfig: {
            maxOutputTokens: 384,
            responseMimeType: "application/json",
            responseJsonSchema,
            temperature: 0,
          },
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      console.error("Gemini intent parse failed", { status: response.status });
      return null;
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;
    const responseText = extractResponseText(payload);

    if (!responseText) return null;

    const rawIntent = parseJsonObject(responseText);
    if (!rawIntent) return null;

    return normalizeIntent(rawIntent);
  } catch (error) {
    console.error("Gemini intent parse failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
