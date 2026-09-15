/**
 * SPEC §7 steps 2–4 — vendor resolution (CONTRACT thresholds).
 * Pure over an in-memory candidate list; the caller fetches candidates (exact alias hit via SQL,
 * else top-N by pg_trgm similarity) and passes them in. Keeping the decision here means the
 * thresholds are unit-tested and the SQL stays dumb.
 */
import { normalizeVendorName, addressTokensFrom } from "./normalize";

export interface VendorCandidate {
  vendorId: string;
  name: string;
  /** trigram similarity (0..1) between the normalized printed name and the vendor name or alias */
  similarity: number;
  /** true when the match came from vendor_aliases.alias_normalized exactly */
  exactAlias: boolean;
}

export type VendorResolution =
  | { kind: "exact"; vendorId: string }
  | { kind: "proposed"; vendorId: string; similarity: number }
  | { kind: "ambiguous"; candidates: VendorCandidate[] }
  | { kind: "unknown" };

export const RESOLVE = {
  proposeMin: 0.6,
  runnerUpMax: 0.45,
} as const;

export function resolveVendor(
  printedName: string | null | undefined,
  printedAddress: string | null | undefined,
  candidates: VendorCandidate[],
): VendorResolution {
  const normalized = normalizeVendorName(printedName, { addressTokens: addressTokensFrom(printedAddress) });
  if (!normalized) return { kind: "unknown" };

  const exact = candidates.find((c) => c.exactAlias);
  if (exact) return { kind: "exact", vendorId: exact.vendorId };

  const sorted = [...candidates].sort((a, b) => b.similarity - a.similarity);
  const best = sorted[0];
  const second = sorted[1];
  if (!best || best.similarity < RESOLVE.proposeMin) return { kind: "unknown" };
  if (second && second.similarity >= RESOLVE.runnerUpMax) {
    return { kind: "ambiguous", candidates: sorted.filter((c) => c.similarity >= RESOLVE.runnerUpMax) };
  }
  return { kind: "proposed", vendorId: best.vendorId, similarity: best.similarity };
}

/** SPEC §7.4 — synthetic ref number when the paper has none. */
export function syntheticRefNumber(isoDate: string, documentId: string): string {
  const ymd = isoDate.replace(/-/g, "");
  return `NOINV-${ymd}-${documentId.replace(/-/g, "").slice(-4).toUpperCase()}`;
}
export function isSyntheticRefNumber(ref: string): boolean {
  return /^NOINV-\d{8}-[0-9A-F]{4}$/.test(ref);
}
