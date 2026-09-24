import { describe, expect, it } from "vitest";
import { planDocuments, sameBatchInvoiceRefs } from "@/lib/capture/plan";
import type { ExtractionResult } from "@/lib/extraction/extract";
import { DEFAULT_CLASSIFY, DEFAULT_INVOICE } from "@/lib/extraction/providers/mock";

const check = (n: string, conf = 0.95) => ({
  check_number: { value: n, confidence: conf }, payee: { value: "Sudni", confidence: 0.9 },
  amount_numeric: { value: 689.52, confidence: 0.95 }, amount_written: { value: null, confidence: 0 },
  date: { value: "2026-09-10", confidence: 0.9 }, memo: { value: "653279", confidence: 0.8 },
  memo_invoice_numbers: ["653279"], signed: true, issues: [],
});

function result(over: Partial<ExtractionResult>): ExtractionResult {
  return {
    classification: { ...DEFAULT_CLASSIFY, also_contains: [] } as ExtractionResult["classification"],
    resolvedDocType: "invoice", typeConflict: false, payload: DEFAULT_INVOICE, companions: [],
    overallConfidence: 0.9, issues: [], model: "m", promptVersion: "v1", latencyMs: 1, costUsd: 0.05, ...over,
  };
}

describe("planDocuments", () => {
  it("plain invoice → the uploaded document only", () => {
    const p = planDocuments("doc-1", null, result({}));
    expect(p.batchKey).toBe("doc-1");
    expect(p.documents).toEqual([expect.objectContaining({ existingId: "doc-1", docType: "invoice", carriesCost: true })]);
  });

  it("three checks in one photo → three documents, one check each", () => {
    const p = planDocuments("doc-1", "b", result({ resolvedDocType: "check", payload: [check("1"), check("2", 0.4), check("3")] }));
    expect(p.documents.map((d) => d.existingId)).toEqual(["doc-1", null, null]);
    expect(p.documents.map((d) => (d.payload as any[])[0].check_number.value)).toEqual(["1", "2", "3"]);
    expect(p.documents[1]!.overallConfidence).toBe(0.4); // per check, not the photo minimum
    expect(p.documents.filter((d) => d.carriesCost)).toHaveLength(1);
  });

  it("invoice with the check on top → invoice + check sharing the batch", () => {
    const p = planDocuments("doc-1", null, result({
      typeConflict: true,
      companions: [{ docType: "check", payload: [check("1047")], overallConfidence: 0.8 }],
    }));
    expect(p.documents.map((d) => [d.docType, d.existingId, d.typeConflict])).toEqual([
      ["invoice", "doc-1", true],
      ["check", null, false],
    ]);
  });

  it("check card pre-ticks the invoice number from the same photo", () => {
    expect(sameBatchInvoiceRefs([
      { docType: "invoice", payload: { ...DEFAULT_INVOICE, invoice_number: { value: "653279", confidence: 0.9 } } },
      { docType: "check", payload: [check("1")] },
    ])).toEqual(["653279"]);
  });
});
