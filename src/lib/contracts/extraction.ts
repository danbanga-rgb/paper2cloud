/**
 * SPEC §6 — Extraction contract (CONTRACT).
 *
 * These schemas validate raw model output. They are deliberately strict about shape and
 * permissive about values: a wrong number is a fixture-score problem, a wrong shape is a bug.
 *
 * Money in model output is a decimal number (as the model writes it). It is converted to
 * integer cents at the boundary by `toCents` in ./money.ts — nothing downstream sees floats.
 */
import { z } from "zod";

export const DOC_TYPES = [
  "invoice",
  "credit_memo",
  "check",
  "statement",
  "delivery_slip",
  "note",
  "other",
] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const DocTypeSchema = z.enum(DOC_TYPES);

/** The button the uploader pressed. `unknown` for imported fixtures. */
export const ExtractionHintSchema = z.enum([
  "invoice",
  "check",
  "credit_memo",
  "statement",
  "delivery_slip",
  "unknown",
]);
export type ExtractionHint = z.infer<typeof ExtractionHintSchema>;

const Confidence = z.number().min(0).max(1);
const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

/** A field the model may or may not have found, with its own confidence. */
export function field<T extends z.ZodTypeAny>(value: T) {
  return z.object({ value: value.nullable(), confidence: Confidence });
}
export type Field<T> = { value: T | null; confidence: number };

// ---------------------------------------------------------------------------
// §6.1 Classification
// ---------------------------------------------------------------------------
export const ClassificationSchema = z.object({
  doc_type: DocTypeSchema,
  documents_in_image: z.number().int().min(0),
  is_continuation_of_previous: z.boolean(),
  legibility: z.enum(["good", "fair", "poor"]),
  confidence: Confidence,
});
export type Classification = z.infer<typeof ClassificationSchema>;

// ---------------------------------------------------------------------------
// §6.2 Invoice / credit memo
// ---------------------------------------------------------------------------
export const InvoicePayloadSchema = z.object({
  vendor_name_printed: field(z.string()),
  vendor_address: field(z.string()),
  invoice_number: field(z.string()),
  invoice_date: field(IsoDate),
  due_date: field(IsoDate),
  terms: field(z.string()),
  subtotal: field(z.number()),
  tax: field(z.number()),
  total: field(z.number()),
  is_credit: z.boolean(),
  paid_stamp_or_cod: field(z.boolean()),
  check_number_referenced: field(z.string()),
  page_count_seen: z.number().int().min(1),
  issues: z.array(z.string()),
});
export type InvoicePayload = z.infer<typeof InvoicePayloadSchema>;

// ---------------------------------------------------------------------------
// §6.3 Check (array — one image may hold several checks)
// ---------------------------------------------------------------------------
export const CheckPayloadSchema = z.object({
  check_number: field(z.string()),
  payee: field(z.string()),
  amount_numeric: field(z.number()),
  amount_written: field(z.string()),
  date: field(IsoDate),
  memo: field(z.string()),
  memo_invoice_numbers: z.array(z.string()),
  signed: z.boolean(),
  issues: z.array(z.string()),
});
export type CheckPayload = z.infer<typeof CheckPayloadSchema>;
export const ChecksPayloadSchema = z.array(CheckPayloadSchema).min(1);

// ---------------------------------------------------------------------------
// Record-only types carry a minimal payload
// ---------------------------------------------------------------------------
export const RecordOnlyPayloadSchema = z.object({
  vendor_name_printed: field(z.string()),
  date: field(IsoDate),
  summary: z.string(),
  amount_mentioned: field(z.number()),
  issues: z.array(z.string()),
});
export type RecordOnlyPayload = z.infer<typeof RecordOnlyPayloadSchema>;

/** Pick the payload schema for a classified type. */
export function payloadSchemaFor(docType: DocType) {
  switch (docType) {
    case "invoice":
    case "credit_memo":
      return InvoicePayloadSchema;
    case "check":
      return ChecksPayloadSchema;
    default:
      return RecordOnlyPayloadSchema;
  }
}

// ---------------------------------------------------------------------------
// §6.4 Confidence thresholds (CONTRACT)
// ---------------------------------------------------------------------------
export const CONFIDENCE = {
  /** ≥ normal: shown as a normal field. */
  normal: 0.85,
  /** < required: shown empty and the uploader must type it. */
  required: 0.5,
  /** Cap applied to check amount when numeric and written amounts disagree. */
  amountDisagreementCap: 0.5,
  /** Classification confidence at which the model's type overrides the uploader's hint. */
  overrideHint: 0.8,
} as const;

export type FieldState = "normal" | "highlight" | "required";
export function fieldState(confidence: number): FieldState {
  if (confidence >= CONFIDENCE.normal) return "normal";
  if (confidence >= CONFIDENCE.required) return "highlight";
  return "required";
}

/** overall_confidence = min over the required fields for the type (SPEC §6.4). */
export function overallConfidence(docType: DocType, payload: unknown): number {
  if (docType === "invoice" || docType === "credit_memo") {
    const p = InvoicePayloadSchema.parse(payload);
    return Math.min(
      p.vendor_name_printed.confidence,
      p.invoice_number.confidence,
      p.invoice_date.confidence,
      p.total.confidence,
    );
  }
  if (docType === "check") {
    const checks = ChecksPayloadSchema.parse(payload);
    return Math.min(
      ...checks.map((c) =>
        Math.min(
          c.payee.confidence,
          c.check_number.confidence,
          c.date.confidence,
          c.amount_numeric.confidence,
        ),
      ),
    );
  }
  return 1; // record-only types never gate anything
}

/** What is stored in `extractions` (one row per model run). */
export const ExtractionRecordSchema = z.object({
  document_id: z.string().uuid(),
  version: z.number().int().min(1),
  model: z.string(),
  prompt_version: z.string(),
  classification: ClassificationSchema,
  payload: z.unknown(),
  overall_confidence: Confidence,
  issues: z.array(z.string()),
  latency_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type ExtractionRecord = z.infer<typeof ExtractionRecordSchema>;
