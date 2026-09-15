import { describe, expect, it } from "vitest";
import { normalizeVendorName, addressTokensFrom } from "@/lib/vendor/normalize";
import { resolveVendor, syntheticRefNumber, isSyntheticRefNumber } from "@/lib/vendor/resolve";

describe("normalizeVendorName", () => {
  it("uppercases, strips punctuation and legal suffixes", () => {
    expect(normalizeVendorName("Sysco San Francisco, Inc.")).toBe("SYSCO SAN FRANCISCO");
    expect(normalizeVendorName("Pepsi Bottling Ventures LLC")).toBe("PEPSI BOTTLING VENTURES");
    expect(normalizeVendorName("Frito-Lay")).toBe("FRITO LAY");
    expect(normalizeVendorName("Bimbo Bakeries USA")).toBe("BIMBO BAKERIES");
    expect(normalizeVendorName("A & B Produce Co.")).toBe("A AND B PRODUCE");
  });
  it("drops address tokens and trailing state / branch ids", () => {
    const addr = addressTokensFrom("5900 Stewart Ave, Fremont, CA 94538");
    expect(normalizeVendorName("SYSCO FREMONT CA", { addressTokens: addr })).toBe("SYSCO");
    expect(normalizeVendorName("SYSCO 042")).toBe("SYSCO");
    expect(normalizeVendorName("Coca-Cola Bottling CA")).toBe("COCA COLA BOTTLING");
  });
  it("is idempotent", () => {
    const once = normalizeVendorName("Sysco San Francisco, Inc.");
    expect(normalizeVendorName(once)).toBe(once);
  });
  it("handles empty", () => {
    expect(normalizeVendorName(null)).toBe("");
  });
});

describe("resolveVendor", () => {
  const c = (vendorId: string, similarity: number, exactAlias = false) => ({ vendorId, name: vendorId, similarity, exactAlias });
  it("exact alias wins regardless of similarity", () => {
    expect(resolveVendor("SYSCO SF", null, [c("pepsi", 0.9), c("sysco", 0.3, true)])).toEqual({ kind: "exact", vendorId: "sysco" });
  });
  it("proposes when best ≥ 0.6 and runner-up < 0.45", () => {
    expect(resolveVendor("Sysco Fremont", null, [c("sysco", 0.72), c("cisco", 0.4)])).toEqual({ kind: "proposed", vendorId: "sysco", similarity: 0.72 });
  });
  it("is ambiguous when runner-up ≥ 0.45", () => {
    const r = resolveVendor("Coke", null, [c("coca-cola", 0.7), c("coke-zero-dist", 0.5), c("pepsi", 0.1)]);
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.candidates.map((x) => x.vendorId)).toEqual(["coca-cola", "coke-zero-dist"]);
  });
  it("is unknown below threshold or with no name", () => {
    expect(resolveVendor("Zzz Foods", null, [c("sysco", 0.2)])).toEqual({ kind: "unknown" });
    expect(resolveVendor("", null, [c("sysco", 0.99, true)])).toEqual({ kind: "unknown" });
  });
});

describe("syntheticRefNumber", () => {
  it("builds and recognizes NOINV refs", () => {
    const ref = syntheticRefNumber("2026-09-12", "6f1c2a3b-0000-4000-8000-0123456789ab");
    expect(ref).toBe("NOINV-20260912-89AB");
    expect(isSyntheticRefNumber(ref)).toBe(true);
    expect(isSyntheticRefNumber("48812")).toBe(false);
  });
});
