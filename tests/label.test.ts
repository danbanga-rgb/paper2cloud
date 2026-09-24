import { describe, expect, it } from "vitest";
import { amountOwedCents, emptyCheck, emptyLabel, emptyPayload, finalizeLabel, labelFileName, labelFromExtraction } from "@/lib/fixtures/label";
import type { ExtractionResult } from "@/lib/extraction/extract";
import { DEFAULT_CLASSIFY, DEFAULT_INVOICE } from "@/lib/extraction/providers/mock";
import { InvoicePayloadSchema } from "@/lib/contracts/extraction";

const NOW = "2026-09-24T21:00:00Z";
const sudni = { ...DEFAULT_INVOICE, vendor_name_printed: { value: "SUDNI FOODS", confidence: 0.9 }, invoice_number: { value: "653279", confidence: 0.93 },
  total: { value: 750.04, confidence: 0.95 }, handwritten_adjusted_total: { value: 689.52, confidence: 0.8 }, subtotal: { value: null, confidence: 0 }, tax: { value: null, confidence: 0 } };
const check = { ...emptyCheck(), check_number: { value: "1047", confidence: 0.9 }, payee: { value: "Sudni", confidence: 0.9 }, amount_numeric: { value: 689.52, confidence: 0.9 }, memo_invoice_numbers: ["653279"] };

function result(over: Partial<ExtractionResult>): ExtractionResult {
  return { classification: { ...DEFAULT_CLASSIFY, also_contains: ["check"] } as ExtractionResult["classification"], resolvedDocType: "invoice", typeConflict: false,
    payload: sudni, companions: [{ docType: "check", payload: [check], overallConfidence: 0.9 }], overallConfidence: 0.8, issues: [], model: "m", promptVersion: "v1", latencyMs: 1, costUsd: 0.1, ...over };
}

describe("label files", () => {
  it("draft from a composite photo keeps both documents and asks about the adjusted total", () => {
    const l = labelFromExtraction("a.jpeg", ["a.jpeg"], result({}));
    expect(l.documents.map((d) => d.doc_type)).toEqual(["invoice", "check"]);
    expect(l.questions).toEqual([expect.objectContaining({ id: "0.adjusted", answer: null })]);
    expect(l.draft_source).toEqual({ model: "m", prompt_version: "v1" });
  });

  it("finalize sets truth confidences and derives classification from the documents", () => {
    const l = finalizeLabel(labelFromExtraction("a.jpeg", ["a.jpeg"], result({})), NOW);
    const inv = InvoicePayloadSchema.parse(l.documents[0]!.payload);
    expect(inv.total).toEqual({ value: 750.04, confidence: 1 });
    expect(inv.subtotal).toEqual({ value: null, confidence: 0 });
    expect(l.status).toBe("labeled");
    expect(l.classification).toEqual({ doc_type: "invoice", documents_in_image: 1, also_contains: ["check"] });
    expect(amountOwedCents(inv)).toBe(68952);
  });

  it("two checks in one photo → documents_in_image 2", () => {
    const l = emptyLabel("c.jpeg", ["c.jpeg"], "check");
    l.documents[0]!.payload = [check, { ...check, check_number: { value: "1048", confidence: 1 } }];
    expect(finalizeLabel(l, NOW).classification.documents_in_image).toBe(2);
  });

  it("rejects a wrong shape and bank numbers", () => {
    const bad = emptyLabel("x.jpeg", ["x.jpeg"]);
    bad.documents[0]!.payload = { total: 5 };
    expect(() => finalizeLabel(bad, NOW)).toThrow();
    const micr = emptyLabel("c.jpeg", ["c.jpeg"], "check");
    micr.documents[0]!.payload = [{ ...check, memo: { value: "121000358 0123456789", confidence: 1 } }];
    expect(() => finalizeLabel(micr, NOW)).toThrow(/bank numbers/);
  });

  it("empty payloads satisfy their schemas; empty strings become null", () => {
    for (const t of ["invoice", "credit_memo", "check", "statement", "delivery_slip", "note", "other"] as const) {
      const l = emptyLabel("x.jpeg", ["x.jpeg"], t);
      l.documents[0]!.payload = emptyPayload(t);
      expect(() => finalizeLabel(l, NOW)).not.toThrow();
    }
    const l = emptyLabel("x.jpeg", ["x.jpeg"]);
    (l.documents[0]!.payload as any).invoice_number = { value: "", confidence: 0.3 };
    expect((finalizeLabel(l, NOW).documents[0]!.payload as any).invoice_number).toEqual({ value: null, confidence: 0 });
  });

  it("label file names cannot escape the labels folder", () => {
    expect(labelFileName("WhatsApp Image 2026-08-17 at 12.08.01 PM.jpeg")).toBe("WhatsApp Image 2026-08-17 at 12.08.01 PM.jpeg.json");
    expect(() => labelFileName("../x")).toThrow();
  });
});
