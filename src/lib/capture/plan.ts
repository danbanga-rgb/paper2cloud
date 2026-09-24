/**
 * SPEC §6.1 / FINDINGS §1 — turn one extraction of one photo (set of pages) into `documents` rows.
 * Pure; the extraction worker persists the plan.
 *
 * - The uploaded document keeps its id and takes the resolved type and primary payload.
 * - `documents_in_image > 1` is only valid for checks: each extra check becomes its own document
 *   sharing the same pages (one confirm card per check, S6 "Check 1 of 3").
 * - Each `also_contains` companion (usually the check lying on the invoice) becomes its own
 *   document sharing the pages. All documents from one photo share a `batch_key`; a check card
 *   pre-ticks the invoice(s) from the same batch (S7).
 * - Check documents store a one-element ChecksPayload array so every check document has the same shape.
 */
import type { ExtractionResult } from "../extraction/extract";
import type { CheckPayload, DocType } from "../contracts/extraction";
import { overallConfidence } from "../contracts/extraction";

export interface PlannedDocument {
  /** null = create a new documents row; else the uploaded document's id */
  existingId: string | null;
  docType: DocType;
  payload: unknown;
  overallConfidence: number;
  /** true only for the uploaded document (the model call cost is recorded once) */
  carriesCost: boolean;
  /** the uploader's button disagreed with the model (S5 banner), primary only */
  typeConflict: boolean;
}

export interface DocumentPlan {
  batchKey: string;
  documents: PlannedDocument[];
}

export function planDocuments(uploadedId: string, batchKey: string | null, r: ExtractionResult): DocumentPlan {
  const documents: PlannedDocument[] = [];

  const primaryParts = split(r.resolvedDocType, r.payload, r.overallConfidence);
  primaryParts.forEach((p, i) =>
    documents.push({ ...p, existingId: i === 0 ? uploadedId : null, carriesCost: i === 0, typeConflict: i === 0 && r.typeConflict }),
  );

  for (const c of r.companions) {
    for (const p of split(c.docType, c.payload, c.overallConfidence)) {
      documents.push({ ...p, existingId: null, carriesCost: false, typeConflict: false });
    }
  }

  return { batchKey: batchKey ?? uploadedId, documents };
}

function split(docType: DocType, payload: unknown, conf: number): { docType: DocType; payload: unknown; overallConfidence: number }[] {
  if (docType !== "check") return [{ docType, payload, overallConfidence: conf }];
  const checks = payload as CheckPayload[];
  return checks.map((ch) => ({ docType, payload: [ch], overallConfidence: overallConfidence("check", [ch]) }));
}

/**
 * S7 pre-tick source for a composite photo: the invoice numbers of invoice documents in the same
 * batch. The confirm route matches them to open bills of the payee (after the invoice is confirmed).
 */
export function sameBatchInvoiceRefs(batch: { docType: DocType; payload: unknown }[]): string[] {
  const refs: string[] = [];
  for (const d of batch) {
    if (d.docType !== "invoice" && d.docType !== "credit_memo") continue;
    const ref = (d.payload as { invoice_number?: { value: string | null } }).invoice_number?.value;
    if (ref) refs.push(ref);
  }
  return refs;
}
