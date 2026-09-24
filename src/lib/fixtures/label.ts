/**
 * Phase 0 ground-truth label files: fixtures/labels/<first page image>.json (committed).
 *
 * One label file = one photo set (usually one photo; several for a multi-page invoice) and every
 * document physically in it, in the same order the extractor reports them: the primary document,
 * then `also_contains` companions (the check lying on the invoice). Payloads are the SPEC §6 shapes;
 * in ground truth a present value has confidence 1 and an absent one is null with confidence 0.
 *
 * `questions` is how the agent asks the owner about an ambiguous photo (crossed-out total, unclear
 * digit) inside the helper instead of in chat; the owner's answer is stored with the label.
 */
import { z } from "zod";
import {
  DocTypeSchema,
  payloadSchemaFor,
  type DocType,
  type InvoicePayload,
} from "../contracts/extraction";
import type { ExtractionResult } from "../extraction/extract";
import { redactMicr } from "../extraction/extract";
import { toCents, type Cents } from "../contracts/money";

export const LABEL_SCHEMA_VERSION = 1;

export const LabelQuestionSchema = z.object({
  id: z.string(),
  /** document index + field path the question is about, e.g. "0.handwritten_adjusted_total" */
  field: z.string().nullable(),
  text: z.string(),
  answer: z.string().nullable(),
});
export type LabelQuestion = z.infer<typeof LabelQuestionSchema>;

export const LabelDocumentSchema = z.object({
  doc_type: DocTypeSchema,
  payload: z.unknown(),
});
export type LabelDocument = z.infer<typeof LabelDocumentSchema>;

export const LabelFileSchema = z.object({
  schema: z.literal(LABEL_SCHEMA_VERSION),
  image: z.string(),
  /** image files of this photo set, page order; pages[0] === image */
  pages: z.array(z.string()).min(1),
  /** draft = model output not yet reviewed; labeled = owner-confirmed ground truth; skipped = excluded from scoring */
  status: z.enum(["draft", "labeled", "skipped"]),
  skip_reason: z.string().nullable().default(null),
  /** ground truth for classification scoring (SPEC §13: classification, checks-per-image) */
  classification: z.object({
    doc_type: DocTypeSchema,
    documents_in_image: z.number().int().min(0),
    also_contains: z.array(DocTypeSchema),
  }),
  documents: z.array(LabelDocumentSchema).min(1),
  questions: z.array(LabelQuestionSchema).default([]),
  notes: z.string().nullable().default(null),
  draft_source: z.object({ model: z.string(), prompt_version: z.string() }).nullable().default(null),
  labeled_at: z.string().nullable().default(null),
});
export type LabelFile = z.infer<typeof LabelFileSchema>;

/** Label file name for an image (the image name itself stays readable in git). */
export function labelFileName(image: string): string {
  if (image.includes("/") || image.includes("\\") || image.startsWith(".")) throw new Error(`bad image name ${image}`);
  return `${image}.json`;
}

/** Turn a model draft into an unreviewed label (the helper pre-fills its fields from this). */
export function labelFromExtraction(image: string, pages: string[], r: ExtractionResult): LabelFile {
  const documents: LabelDocument[] = [
    { doc_type: r.resolvedDocType, payload: r.payload },
    ...r.companions.map((c) => ({ doc_type: c.docType, payload: c.payload })),
  ];
  return {
    schema: LABEL_SCHEMA_VERSION,
    image,
    pages,
    status: "draft",
    skip_reason: null,
    classification: {
      doc_type: r.classification.doc_type,
      documents_in_image: r.classification.documents_in_image,
      also_contains: r.classification.also_contains,
    },
    documents,
    questions: draftQuestions(documents),
    notes: null,
    draft_source: { model: r.model, prompt_version: r.promptVersion },
    labeled_at: null,
  };
}

/**
 * Questions the helper puts to the owner for a draft. Only things a human must decide:
 * a handwritten adjusted total (which amount is owed?) and printed-vs-written check amounts.
 */
export function draftQuestions(documents: LabelDocument[]): LabelQuestion[] {
  const qs: LabelQuestion[] = [];
  documents.forEach((d, i) => {
    if (d.doc_type === "invoice" || d.doc_type === "credit_memo") {
      const p = d.payload as InvoicePayload;
      if (p.handwritten_adjusted_total?.value != null) {
        qs.push({
          id: `${i}.adjusted`,
          field: `${i}.handwritten_adjusted_total`,
          text: `Printed total ${p.total.value ?? "?"}, handwritten ${p.handwritten_adjusted_total.value}. Is the handwritten figure what is actually owed?`,
          answer: null,
        });
      }
    }
    if (d.doc_type === "check") {
      (d.payload as { issues: string[] }[]).forEach((c, j) => {
        if (c.issues.some((x) => x.includes("disagree"))) {
          qs.push({ id: `${i}.${j}.amount`, field: `${i}.${j}.amount_numeric`, text: `Check ${j + 1}: the box and the written amount disagree. What is the real amount?`, answer: null });
        }
      });
    }
  });
  return qs;
}

/**
 * Normalize an edited label into ground truth: confidence 1 for present values, 0 for null;
 * payload validated against the §6 schema for its doc type. Throws (ZodError) when the shape is wrong.
 */
export function finalizeLabel(label: LabelFile, now: string): LabelFile {
  const parsed = LabelFileSchema.parse(label);
  const documents = parsed.documents.map((d) => ({
    doc_type: d.doc_type,
    payload: payloadSchemaFor(d.doc_type).parse(truthConfidences(d.payload)),
  }));
  const checks = documents.filter((d) => d.doc_type === "check").reduce((n, d) => n + (d.payload as unknown[]).length, 0);
  const primary = documents[0]!;
  const out: LabelFile = {
    ...parsed,
    status: parsed.status === "skipped" ? "skipped" : "labeled",
    documents,
    classification: {
      ...parsed.classification,
      doc_type: primary.doc_type,
      also_contains: documents.slice(1).map((d) => d.doc_type).filter((t, i, a) => a.indexOf(t) === i),
      documents_in_image: primary.doc_type === "check" ? (primary.payload as unknown[]).length : checks > 0 ? checks : 1,
    },
    labeled_at: now,
  };
  assertNoBankNumbers(out);
  return out;
}

/** SPEC §12: label files are committed, so they must never carry MICR / routing+account digits. */
export function assertNoBankNumbers(label: LabelFile): void {
  const walk = (v: unknown, path: string): void => {
    if (typeof v === "string" && redactMicr(v) !== v) throw new Error(`${path} looks like bank numbers — remove them before saving`);
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(label.documents, "documents");
  walk(label.notes, "notes");
  walk(label.questions, "questions");
}

function truthConfidences(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(truthConfidences);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("value" in o && "confidence" in o && Object.keys(o).length === 2) {
      const empty = o.value === null || o.value === "";
      return { value: empty ? null : o.value, confidence: empty ? 0 : 1 };
    }
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, truthConfidences(x)]));
  }
  return v;
}

/** SPEC §6.2: the bill is booked at the handwritten adjusted total when present, else the printed total. */
export function amountOwedCents(p: Pick<InvoicePayload, "total" | "handwritten_adjusted_total">): Cents | null {
  return toCents(p.handwritten_adjusted_total.value ?? p.total.value);
}

/** Empty payloads for a labeler who has no draft (no API key) or changes a document's type. */
export function emptyPayload(docType: DocType): unknown {
  const f = { value: null, confidence: 0 };
  switch (docType) {
    case "invoice":
    case "credit_memo":
      return {
        vendor_name_printed: f, vendor_address: f, invoice_number: f, invoice_date: f, due_date: f, terms: f,
        subtotal: f, tax: f, total: f, is_credit: docType === "credit_memo", paid_stamp_or_cod: f,
        check_number_referenced: f, paid_date_referenced: f, handwritten_adjusted_total: f,
        handwritten_notes: [], page_count_seen: 1, issues: [],
      };
    case "check":
      return [emptyCheck()];
    case "statement":
      return {
        vendor_name_printed: f, customer_name_printed: f, statement_date: f, rows: [], total_balance: f,
        handwritten_groups: [], handwritten_notes: [], issues: [],
      };
    default:
      return { vendor_name_printed: f, date: f, summary: "", amount_mentioned: f, issues: [] };
  }
}

export function emptyCheck() {
  const f = { value: null, confidence: 0 };
  return { check_number: f, payee: f, amount_numeric: f, amount_written: f, date: f, memo: f, memo_invoice_numbers: [], signed: true, issues: [] };
}

export function emptyLabel(image: string, pages: string[], docType: DocType = "invoice"): LabelFile {
  return {
    schema: LABEL_SCHEMA_VERSION, image, pages, status: "draft", skip_reason: null,
    classification: { doc_type: docType, documents_in_image: 1, also_contains: [] },
    documents: [{ doc_type: docType, payload: emptyPayload(docType) }],
    questions: [], notes: null, draft_source: null, labeled_at: null,
  };
}
