import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * The Anthropic client and the two model choices, in one place.
 *
 * Two models rather than one because the app asks Claude for two different
 * kinds of work, and they do not want the same defaults:
 *
 * - **Extraction** (`lib/ai/anthropic.ts`) reads a finished report and copies
 *   fields out of it. It is close to transcription, the answers are all on the
 *   page, and it runs on every upload — so it stays on the cheaper model the app
 *   has always used.
 * - **Drafting** (`lib/ai/mover-draft.ts`) chooses which of forty movers is
 *   worth covering, reads twenty-five filings, and writes the analysis. That is
 *   judgment rather than transcription, and it runs at a much larger input size
 *   — so it gets its own setting, a longer client timeout, and effort turned up.
 */

export const DEFAULT_EXTRACTION_MODEL = "claude-sonnet-4-6";
/**
 * Sonnet 5 rather than Opus: same price tier as the extraction model
 * ($3/$15 per MTok against Opus's $5/$25) on a newer model, and it supports
 * everything the pipeline actually uses — adaptive thinking and
 * `output_config.effort`. Override with ANTHROPIC_DRAFT_MODEL.
 */
export const DEFAULT_DRAFT_MODEL = "claude-sonnet-5";

let cached: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (cached) return cached;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error(
      "ANTHROPIC_API_KEY is missing. Please add your Anthropic API key to .env.local to enable automated PDF extraction.",
    );
  }

  cached = new Anthropic({
    apiKey: apiKey.trim(),
    /**
     * The drafting pipeline's longest single call reads twenty-five filings and
     * writes an eleven-page report. The SDK's ten-minute default is generous for
     * that, but a cron run has no user waiting and every retry costs a full set
     * of input tokens, so the ceiling is raised rather than risk a timeout on a
     * call that was nearly finished.
     */
    timeout: 15 * 60 * 1000,
  });
  return cached;
}

export function extractionModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_EXTRACTION_MODEL;
}

export function draftModel(): string {
  return process.env.ANTHROPIC_DRAFT_MODEL?.trim() || DEFAULT_DRAFT_MODEL;
}

/**
 * Running total across a multi-call pipeline, stored on the draft for audit.
 *
 * The cached halves are tracked separately rather than folded into
 * `inputTokens`, because they are billed at different rates — cache writes at
 * about 1.25x and cache reads at about a tenth — and the drafting pipeline puts
 * *most* of its input through the cache. Summing only `input_tokens` reported a
 * 153,000-token announcement corpus as 3,178 tokens, which made the cost
 * estimate on the review card meaningless.
 */
export type TokenUsage = {
  /** Uncached input, billed at the full rate. */
  inputTokens: number;
  /** Written to cache this call, billed at ~1.25x. */
  cacheWriteTokens: number;
  /** Served from cache, billed at ~0.1x. */
  cacheReadTokens: number;
  outputTokens: number;
};

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
};

export function addUsage(
  total: TokenUsage,
  usage:
    | {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number | null;
        cache_read_input_tokens?: number | null;
      }
    | null
    | undefined,
): TokenUsage {
  return {
    inputTokens: total.inputTokens + (usage?.input_tokens ?? 0),
    cacheWriteTokens:
      total.cacheWriteTokens + (usage?.cache_creation_input_tokens ?? 0),
    cacheReadTokens:
      total.cacheReadTokens + (usage?.cache_read_input_tokens ?? 0),
    outputTokens: total.outputTokens + (usage?.output_tokens ?? 0),
  };
}

/** Turns an SDK error into something an analyst can act on. */
export function describeAnthropicError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Invalid ANTHROPIC_API_KEY. Please verify your API key in .env.local.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Anthropic API rate limit exceeded or credit balance exhausted.";
  }
  if (error instanceof Anthropic.APIError) {
    return `Claude API error ${error.status ?? ""}: ${error.message}`.trim();
  }
  return error instanceof Error ? error.message : "Unknown Claude API error.";
}
