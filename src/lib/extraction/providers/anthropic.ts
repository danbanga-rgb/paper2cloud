/**
 * Anthropic provider behind `ExtractionProvider` (SPEC §6). Vision input, JSON-only output,
 * latency and cost recorded per call.
 *
 * - Images arrive as data: URIs or signed URLs; URLs are fetched server-side and sent as base64
 *   (Supabase signed URLs are short-lived and we don't want the model provider fetching them).
 * - Prompts ask for JSON only; `extractJson` pulls the first {...} or [...] block defensively.
 * - Never log image bytes or raw responses (check responses could carry MICR digits — SPEC §12).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ExtractionProvider, ImageInput } from "../extract";
import { costUsd } from "./pricing";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  /** thinking depth; unset = the model's default */
  effort?: Effort;
  /** SPEC §6.5: 30 s timeout, one retry */
  timeoutMs?: number;
  maxRetries?: number;
  /** injectable for tests */
  client?: Pick<Anthropic, "beta">;
  fetchImpl?: typeof fetch;
}

export class ExtractionRefused extends Error {
  constructor(public readonly category: string | null) {
    super(`model declined the request${category ? ` (${category})` : ""}`);
  }
}

export function anthropicProvider(opts: AnthropicProviderOptions): ExtractionProvider {
  const client =
    opts.client ??
    new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 30_000, maxRetries: opts.maxRetries ?? 1 });
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    name: opts.model,
    async call({ system, user, images }) {
      const imageBlocks = await Promise.all(images.map((img) => toImageBlock(img, fetchImpl)));
      const started = Date.now();
      const res = await client.beta.messages.create({
        model: opts.model,
        max_tokens: 16_000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
        system,
        messages: [
          {
            role: "user",
            content: [
              ...imageBlocks,
              { type: "text", text: `${user}\nRespond with JSON only, no prose, no code fences.` },
            ],
          },
        ],
      });
      const latencyMs = Date.now() - started;

      if (res.stop_reason === "refusal") throw new ExtractionRefused(res.stop_details?.category ?? null);
      if (res.stop_reason === "max_tokens") throw new Error("model output truncated (max_tokens)");

      const text = res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return { text: extractJson(text), latencyMs, costUsd: costUsd(res.model, res.usage), model: res.model };
    },
  };
}

/** First balanced top-level JSON object or array in `text`; throws when there is none. */
export function extractJson(text: string): string {
  const start = text.search(/[[{]/);
  if (start < 0) throw new Error("model returned no JSON");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error("model returned unterminated JSON");
}

async function toImageBlock(img: ImageInput, fetchImpl: typeof fetch): Promise<Anthropic.Beta.BetaImageBlockParam> {
  const dataUri = img.url.match(/^data:(image\/[a-z+]+);base64,(.*)$/s);
  if (dataUri) {
    return { type: "image", source: { type: "base64", media_type: mediaType(dataUri[1]!), data: dataUri[2]! } };
  }
  const r = await fetchImpl(img.url);
  if (!r.ok) throw new Error(`could not fetch page ${img.pageNo}: HTTP ${r.status}`);
  const data = Buffer.from(await r.arrayBuffer()).toString("base64");
  return { type: "image", source: { type: "base64", media_type: mediaType(r.headers.get("content-type")), data } };
}

function mediaType(ct: string | null | undefined): ImageMediaType {
  const t = (ct ?? "").split(";")[0]!.trim().toLowerCase();
  if (t === "image/png" || t === "image/gif" || t === "image/webp") return t;
  return "image/jpeg"; // the PWA uploads JPEG q≈0.8 (SPEC §10)
}
