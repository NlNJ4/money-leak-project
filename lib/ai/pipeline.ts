import { GeminiParser } from "@/lib/ai/gemini";
import { parseWithConfidence } from "@/lib/ai/rule-parser";
import type { ParsedTransaction } from "@/lib/ai/provider";
import { recordMetrics } from "@/lib/observability";

// Rule-parser results at or above this confidence are trusted without a
// Gemini call; anything lower (or unparseable) escalates to the AI chain.
export const RULE_CONFIDENCE_THRESHOLD = 0.7;

export async function parseTransaction(
  text: string,
): Promise<ParsedTransaction | null> {
  const startedAt = Date.now();
  const rule = parseWithConfidence(text);

  if (rule.parsed && rule.confidence >= RULE_CONFIDENCE_THRESHOLD) {
    logParserEvent({
      source: "rule",
      outcome: "parsed",
      confidence: rule.confidence,
      durationMs: Date.now() - startedAt,
    });
    void recordMetrics(["parser_rule_hit"]);
    return rule.parsed;
  }

  try {
    const result = await new GeminiParser().parseTransaction(text);
    logParserEvent({
      source: "gemini",
      outcome: result ? "parsed" : "unknown",
      durationMs: Date.now() - startedAt,
      ruleConfidence: rule.confidence,
    });
    void recordMetrics([result ? "parser_gemini_hit" : "parser_gemini_unknown"]);
    return result;
  } catch (err) {
    logParserEvent({
      source: "gemini",
      outcome: "error",
      durationMs: Date.now() - startedAt,
      ruleConfidence: rule.confidence,
      error: err instanceof Error ? err.name : "unknown",
    });
    void recordMetrics(["parser_gemini_error"]);
    // The webhook layer retries durable jobs; propagation (not a fake
    // "unknown") keeps that recovery possible.
    throw err;
  }
}

// One structured line per message for measuring rule-vs-Gemini usage.
// Never includes message text or user ids — raw financial messages must
// stay out of analytics/logs.
function logParserEvent(event: Record<string, unknown>) {
  console.log(`[parser] ${JSON.stringify(event)}`);
}
