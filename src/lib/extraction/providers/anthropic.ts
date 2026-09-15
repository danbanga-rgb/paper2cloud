/**
 * Anthropic provider — Phase 0 implements this. Kept as a stub in the scaffold so the shape is fixed.
 *
 * Implementation notes for the agent:
 * - Use the Messages API with image content blocks (fetch the signed URL server-side and pass base64,
 *   or pass the URL if the SDK version supports URL image sources).
 * - Ask for JSON only; set a low temperature; parse the first {...} or [...] block defensively.
 * - Record latency and, if the response exposes usage, compute cost from the model's price table
 *   kept in ./pricing.ts (not in this file).
 * - Never log image bytes. Never log the raw response for check documents at info level (SPEC §12).
 */
import type { ExtractionProvider } from "../extract";

export function anthropicProvider(_opts: { apiKey: string; model: string }): ExtractionProvider {
  return {
    name: _opts.model,
    async call() {
      throw new Error("anthropicProvider not implemented — Phase 0 task (docs/phases.md)");
    },
  };
}
