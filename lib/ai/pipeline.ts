import { GeminiParser } from "@/lib/ai/gemini";
import { parseWithConfidence } from "@/lib/ai/rule-parser";
import type { ParsedTransaction } from "@/lib/ai/provider";
import { recordMetrics } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/admin";

// Rule-parser results at or above this confidence are trusted without a
// Gemini call; anything lower (or unparseable) escalates to the AI chain.
export const RULE_CONFIDENCE_THRESHOLD = 0.7;

// Daily Gemini request ceiling (free-tier protection). Fail-open if the
// counter is unreachable — an observability outage must not break parsing.
const DEFAULT_DAILY_LIMIT = 100;
function dailyLimit(): number {
  const parsed = Number(process.env.GEMINI_DAILY_LIMIT);
  // Zero is a legitimate value ("AI disabled"); only NaN/negative fall back.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DAILY_LIMIT;
}

export type ParseStatus =
  | { via: "rule"; parsed: ParsedTransaction }
  | { via: "gemini"; parsed: ParsedTransaction }
  | { via: "unknown" }
  // The AI path was skipped: daily quota reached, or the breaker is open
  // after repeated quota errors. `ruleParsed` carries the mid-confidence
  // local guess, if any, for the caller's confirmation flow.
  | { via: "quota"; ruleParsed: ParsedTransaction | null }
  | { via: "circuit"; ruleParsed: ParsedTransaction | null };

async function acquireAiSlot(): Promise<"ok" | "quota" | "circuit"> {
  try {
    const { data, error } = await createAdminClient().rpc(
      "try_acquire_ai_slot",
      { p_limit: dailyLimit() },
    );
    if (error) throw new Error(error.message);
    return data as "ok" | "quota" | "circuit";
  } catch (err) {
    console.error("[pipeline] slot check failed (fail-open):", (err as Error).message);
    return "ok";
  }
}

async function noteAiOutcome(quotaErr: boolean): Promise<void> {
  try {
    await createAdminClient().rpc("note_ai_outcome", { p_quota_err: quotaErr });
  } catch {
    // Best-effort breaker bookkeeping.
  }
}

export async function parseTransactionWithStatus(
  text: string,
): Promise<ParseStatus> {
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
    return { via: "rule", parsed: rule.parsed };
  }

  const slot = await acquireAiSlot();
  if (slot !== "ok") {
    logParserEvent({
      source: "ai_gate",
      outcome: slot,
      durationMs: Date.now() - startedAt,
      ruleConfidence: rule.confidence,
    });
    void recordMetrics([`ai_skipped_${slot}`]);
    return { via: slot, ruleParsed: rule.parsed };
  }

  void recordMetrics(["ai_requests"]);

  // Simple escalations (the rules produced a candidate but lacked a
  // keyword/verb) get the inexpensive Flash-Lite model first; genuinely
  // unparseable text needs the full chain.
  const liteFirst = rule.parsed !== null;

  try {
    const result = await new GeminiParser().parseTransaction(text, { liteFirst });
    logParserEvent({
      source: "gemini",
      outcome: result ? "parsed" : "unknown",
      durationMs: Date.now() - startedAt,
      ruleConfidence: rule.confidence,
    });
    void noteAiOutcome(false);
    void recordMetrics([result ? "parser_gemini_hit" : "parser_gemini_unknown"]);
    return result
      ? { via: "gemini", parsed: result }
      : { via: "unknown" };
  } catch (err) {
    const quotaErr = /429/.test((err as Error).message);
    logParserEvent({
      source: "gemini",
      outcome: "error",
      durationMs: Date.now() - startedAt,
      ruleConfidence: rule.confidence,
      error: err instanceof Error ? err.name : "unknown",
    });
    void noteAiOutcome(quotaErr);
    void recordMetrics([quotaErr ? "gemini_quota_err" : "parser_gemini_error"]);
    // The webhook layer retries durable jobs; propagation (not a fake
    // "unknown") keeps that recovery possible.
    throw err;
  }
}

// Back-compat wrapper: the plain parsed-or-null contract.
export async function parseTransaction(
  text: string,
): Promise<ParsedTransaction | null> {
  const status = await parseTransactionWithStatus(text);
  return "parsed" in status ? status.parsed : null;
}

// One structured line per message for measuring rule-vs-Gemini usage.
// Never includes message text or user ids — raw financial messages must
// stay out of analytics/logs.
function logParserEvent(event: Record<string, unknown>) {
  console.log(`[parser] ${JSON.stringify(event)}`);
}
