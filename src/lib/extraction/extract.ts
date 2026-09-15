/**
 * SPEC §6 — extraction service surface. Providers implement `ExtractionProvider`; `extractDocument`
 * is the only thing routes call. Adding a provider = new file in ./providers/, registered in
 * `providerFromEnv`. Nothing here talks to the database.
 */
import {
  ChecksPayloadSchema,
  ClassificationSchema,
  CONFIDENCE,
  InvoicePayloadSchema,
  RecordOnlyPayloadSchema,
  overallConfidence,
  type Classification,
  type DocType,
  type ExtractionHint,
} from "../contracts/extraction";
import { parseWrittenAmount, toCents } from "../contracts/money";

export interface ImageInput {
  /** signed URL or data: URI; already downscaled to ≤ 2000px long edge (SPEC §6.5) */
  url: string;
  pageNo: number;
}

export interface ModelCall {
  /** returns the raw JSON text the model produced */
  (args: { system: string; user: string; images: ImageInput[]; jsonSchema: object }): Promise<{
    text: string;
    latencyMs: number;
    costUsd: number | null;
    model: string;
  }>;
}

export interface ExtractionProvider {
  name: string;
  call: ModelCall;
}

export interface ExtractionResult {
  classification: Classification;
  /** the type to store on the document after hint/classification reconciliation */
  resolvedDocType: DocType;
  /** true when the model overrode the uploader's hint (show the “this looks like a …” prompt) */
  typeConflict: boolean;
  payload: unknown; // validated against payloadSchemaFor(resolvedDocType)
  overallConfidence: number;
  issues: string[];
  model: string;
  promptVersion: string;
  latencyMs: number;
  costUsd: number | null;
}

export interface Prompts {
  version: string;
  classify: string;
  invoice: string;
  check: string;
  recordOnly: string;
}

const HINT_TO_TYPE: Record<ExtractionHint, DocType | null> = {
  invoice: "invoice",
  check: "check",
  credit_memo: "credit_memo",
  statement: "statement",
  delivery_slip: "delivery_slip",
  unknown: null,
};

export async function extractDocument(
  provider: ExtractionProvider,
  prompts: Prompts,
  images: ImageInput[],
  hint: ExtractionHint,
): Promise<ExtractionResult> {
  const issues: string[] = [];
  let latencyMs = 0;
  let costUsd = 0;
  let model = provider.name;

  // Pass 1 — classify
  const c = await provider.call({
    system: prompts.classify,
    user: `Uploader pressed: ${hint}. Pages: ${images.length}.`,
    images,
    jsonSchema: {},
  });
  latencyMs += c.latencyMs;
  costUsd += c.costUsd ?? 0;
  model = c.model;
  const classification = ClassificationSchema.parse(JSON.parse(c.text));

  // Reconcile hint vs model (SPEC §6.1)
  const hinted = HINT_TO_TYPE[hint];
  let resolvedDocType: DocType = hinted ?? classification.doc_type;
  let typeConflict = false;
  if (hinted && classification.doc_type !== hinted && classification.confidence >= CONFIDENCE.overrideHint) {
    resolvedDocType = classification.doc_type;
    typeConflict = true;
  }

  // Pass 2 — type-specific extraction
  const system =
    resolvedDocType === "invoice" || resolvedDocType === "credit_memo"
      ? prompts.invoice
      : resolvedDocType === "check"
        ? prompts.check
        : prompts.recordOnly;
  const e = await provider.call({ system, user: `Document type: ${resolvedDocType}.`, images, jsonSchema: {} });
  latencyMs += e.latencyMs;
  costUsd += e.costUsd ?? 0;
  const raw = JSON.parse(e.text);

  let payload: unknown;
  if (resolvedDocType === "invoice" || resolvedDocType === "credit_memo") {
    const p = InvoicePayloadSchema.parse(raw);
    // Post-processing rules (SPEC §6.2) — done here, never by the model
    const sub = toCents(p.subtotal.value), tax = toCents(p.tax.value), tot = toCents(p.total.value);
    if (sub !== null && tax !== null && tot !== null && Math.abs(sub + tax - tot) > 2) {
      issues.push(`subtotal+tax != total by ${sub + tax - tot} cents`);
    }
    if (tot !== null && tot < 0) {
      p.is_credit = true;
      p.total.value = Math.abs(p.total.value!);
      issues.push("negative total → reclassified as credit");
    }
    if (p.is_credit && resolvedDocType === "invoice") resolvedDocType = "credit_memo";
    if (p.page_count_seen !== images.length) issues.push(`model saw ${p.page_count_seen} pages, ${images.length} uploaded`);
    payload = p;
  } else if (resolvedDocType === "check") {
    const checks = ChecksPayloadSchema.parse(raw);
    for (const ch of checks) {
      const num = toCents(ch.amount_numeric.value);
      const written = parseWrittenAmount(ch.amount_written.value);
      if (num !== null && written !== null && num !== written) {
        ch.issues.push("numeric and written amounts disagree");
        ch.amount_numeric.confidence = Math.min(ch.amount_numeric.confidence, CONFIDENCE.amountDisagreementCap);
      }
    }
    if (classification.documents_in_image !== checks.length) {
      issues.push(`classifier counted ${classification.documents_in_image} checks, extractor returned ${checks.length}`);
    }
    payload = checks;
  } else {
    payload = RecordOnlyPayloadSchema.parse(raw);
  }

  return {
    classification,
    resolvedDocType,
    typeConflict,
    payload,
    overallConfidence: overallConfidence(resolvedDocType, payload),
    issues,
    model,
    promptVersion: prompts.version,
    latencyMs,
    costUsd: costUsd || null,
  };
}
