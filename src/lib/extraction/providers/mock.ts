/**
 * Mock provider for tests and the labeling helper's offline mode. Returns canned JSON keyed by
 * the first image URL's basename, or a generic invoice when nothing matches.
 */
import type { ExtractionProvider, ImageInput } from "../extract";

export function mockProvider(canned: Record<string, { classify: unknown; extract: unknown }>): ExtractionProvider {
  return {
    name: "mock",
    async call({ system, images }) {
      const key = basename(images[0]?.url ?? "");
      const entry = canned[key];
      const isClassify = system.includes("CLASSIFY");
      const body = entry ? (isClassify ? entry.classify : entry.extract) : (isClassify ? DEFAULT_CLASSIFY : DEFAULT_INVOICE);
      return { text: JSON.stringify(body), latencyMs: 1, costUsd: 0, model: "mock" };
    },
  };
}

function basename(url: string): string {
  return url.split("?")[0]!.split("/").pop() ?? "";
}

export const DEFAULT_CLASSIFY = {
  doc_type: "invoice", documents_in_image: 1, also_contains: [], is_continuation_of_previous: false, legibility: "good", confidence: 0.95,
};
export const DEFAULT_INVOICE = {
  vendor_name_printed: { value: "SYSCO SAN FRANCISCO", confidence: 0.97 },
  vendor_address: { value: "5900 Stewart Ave, Fremont, CA 94538", confidence: 0.6 },
  invoice_number: { value: "48812", confidence: 0.95 },
  invoice_date: { value: "2026-09-12", confidence: 0.9 },
  due_date: { value: null, confidence: 0 },
  terms: { value: "NET 14", confidence: 0.7 },
  subtotal: { value: 812.1, confidence: 0.9 },
  tax: { value: 30.0, confidence: 0.9 },
  total: { value: 842.1, confidence: 0.98 },
  is_credit: false,
  paid_stamp_or_cod: { value: false, confidence: 0.8 },
  check_number_referenced: { value: null, confidence: 0 },
  paid_date_referenced: { value: null, confidence: 0 },
  handwritten_adjusted_total: { value: null, confidence: 0 },
  handwritten_notes: [],
  page_count_seen: 1,
  issues: [],
};
export type _I = ImageInput;
