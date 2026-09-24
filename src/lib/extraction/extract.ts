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
  StatementPayloadSchema,
  overallConfidence,
  payloadSchemaFor,
  type CheckPayload,
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
  /**
   * Extra documents found in the same photo (e.g. the check laid on top of the invoice). The caller
   * creates one `documents` row per entry, sharing the same pages, each with its own confirm card.
   */
  companions: { docType: DocType; payload: unknown; overallConfidence: number }[];
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
  statement: string;
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
        : resolvedDocType === "statement"
          ? prompts.statement
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
    redactChecks(checks);
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
  } else if (resolvedDocType === "statement") {
    payload = StatementPayloadSchema.parse(raw);
  } else {
    payload = RecordOnlyPayloadSchema.parse(raw);
  }

  // Pass 3+ — companions physically present in the same photo (check on top of invoice, etc.)
  const companions: ExtractionResult["companions"] = [];
  for (const kind of classification.also_contains) {
    if (kind === resolvedDocType) continue;
    const sys = kind === "check" ? prompts.check : kind === "invoice" || kind === "credit_memo" ? prompts.invoice : kind === "statement" ? prompts.statement : prompts.recordOnly;
    const r = await provider.call({ system: sys, user: `Document type: ${kind}. Extract ONLY the ${kind} in this photo; ignore the other paper.`, images, jsonSchema: {} });
    latencyMs += r.latencyMs;
    costUsd += r.costUsd ?? 0;
    const parsed = payloadSchemaFor(kind).parse(JSON.parse(r.text));
    if (kind === "check") redactChecks(parsed as CheckPayload[]);
    companions.push({ docType: kind, payload: parsed, overallConfidence: overallConfidence(kind, parsed) });
  }

  return {
    classification,
    resolvedDocType,
    typeConflict,
    payload,
    companions,
    overallConfidence: overallConfidence(resolvedDocType, payload),
    issues,
    model,
    promptVersion: prompts.version,
    latencyMs,
    costUsd: costUsd || null,
  };
}

/**
 * SPEC §12 defence in depth: the check prompt forbids transcribing the MICR line, but if the model
 * slips, scrub it before anything is stored. Redacts text carrying MICR symbols and long digit runs
 * (routing + account); records that it happened (without the digits).
 */
export function redactChecks(checks: CheckPayload[]): void {
  for (const ch of checks) {
    let hit = false;
    const scrub = (t: string) => {
      const out = redactMicr(t);
      if (out !== t) hit = true;
      return out;
    };
    for (const f of [ch.check_number, ch.payee, ch.amount_written, ch.memo]) {
      if (f.value !== null) f.value = scrub(f.value);
    }
    ch.memo_invoice_numbers = ch.memo_invoice_numbers.map(scrub).filter((n) => n !== "[redacted]");
    ch.issues = ch.issues.map(scrub);
    if (hit) ch.issues.push("bank numbers were present in model output and were redacted");
  }
}

const MICR_SYMBOLS = /[\u2446-\u2449]/;

/**
 * A routing number (9) plus an account number (≥ 4) makes a run of ≥ 13 digits; invoice numbers on
 * this store's paper are far shorter. A bare 9-digit run is left alone because it is indistinguishable
 * from an invoice number and a routing number alone identifies only the bank.
 */
export function redactMicr(text: string): string {
  if (MICR_SYMBOLS.test(text)) return "[redacted]";
  return text.replace(/\d[\d\s-]{11,}\d/g, (run) => (run.replace(/\D/g, "").length >= 13 ? "[redacted]" : run));
}
