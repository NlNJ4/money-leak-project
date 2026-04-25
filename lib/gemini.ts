const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";
const DEFAULT_GEMINI_TIMEOUT_MS = 6000;

type GeminiContentPart =
  | {
      text: string;
    }
  | {
      inline_data: {
        mime_type: string;
        data: string;
      };
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

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function getGeminiModel() {
  return (process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL).replace(
    /^models\//,
    "",
  );
}

export function extractGeminiResponseText(
  payload: GeminiGenerateContentResponse,
) {
  return (
    payload.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text ??
    null
  );
}

export function parseGeminiJsonObject<T>(text: string) {
  try {
    return JSON.parse(text) as T;
  } catch {
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (!objectMatch) return null;

    try {
      return JSON.parse(objectMatch[0]) as T;
    } catch {
      return null;
    }
  }
}

export async function generateGeminiJson({
  parts,
  responseJsonSchema,
  maxOutputTokens = 384,
  temperature = 0,
  timeoutMs = DEFAULT_GEMINI_TIMEOUT_MS,
  logLabel = "Gemini generate failed",
}: {
  parts: GeminiContentPart[];
  responseJsonSchema: unknown;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  logLabel?: string;
}) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
              parts,
            },
          ],
          generationConfig: {
            maxOutputTokens,
            responseMimeType: "application/json",
            responseJsonSchema,
            temperature,
          },
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      console.error(logLabel, { status: response.status });
      return null;
    }

    const payload = (await response.json()) as GeminiGenerateContentResponse;

    return extractGeminiResponseText(payload);
  } catch (error) {
    console.error(logLabel, {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
