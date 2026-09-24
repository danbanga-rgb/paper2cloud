/**
 * USD per million tokens, Anthropic first-party rates. Used only to record `extractions.cost_usd`
 * and to drive the daily-spend alert (SPEC §6.5); never used for money in the books.
 * Update when prices change; unknown models record cost as null rather than guessing.
 */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
};

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Cache writes bill at 1.25× input, cache reads at 0.1× input. */
export function costUsd(model: string, u: TokenUsage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const input =
    u.input_tokens + 1.25 * (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0);
  const usd = (input * p.inputPerMTok + u.output_tokens * p.outputPerMTok) / 1_000_000;
  return Math.round(usd * 100_000) / 100_000; // numeric(8,5)
}
