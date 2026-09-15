/**
 * SPEC §8 "Validation on confirm" (CONTRACT). Pure. Server routes call these before writing
 * bills / payments / payment_applications and before moving a document to `confirmed`.
 * A failed validation yields exception codes; the route raises them and moves the document to
 * `needs_attention` (or blocks the confirm for hard errors, see `blocking`).
 */
import type { Cents } from "../contracts/money";
import type { ExceptionReason } from "../contracts/status";

export interface ValidationIssue {
  reason: ExceptionReason;
  message: string;
  /** blocking: the uploader cannot confirm until fixed. non-blocking: confirm proceeds, exception raised. */
  blocking: boolean;
  detail?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Invoice / credit memo
// ---------------------------------------------------------------------------
export interface InvoiceConfirmInput {
  vendorId: string | null;
  vendorIsNew: boolean;
  refNumber: string;
  txnDate: string; // YYYY-MM-DD
  totalCents: Cents | null;
  subtotalCents: Cents | null;
  taxCents: Cents | null;
  kind: "bill" | "credit";
  /** an existing bill with the same (vendorId, refNumber, kind), if any */
  duplicateOf: { billId: string; capturedAt: string; uploaderName: string } | null;
  /** perceptual-hash near-match, if any */
  similarImageDocumentId: string | null;
}

export function validateInvoiceConfirm(i: InvoiceConfirmInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!i.vendorId) {
    issues.push({ reason: "new_vendor", message: "Pick or create a vendor.", blocking: true });
  } else if (i.vendorIsNew) {
    issues.push({
      reason: "new_vendor",
      message: "New vendor will be created in QuickBooks after owner approval.",
      blocking: false,
      detail: { vendorId: i.vendorId },
    });
  }

  if (!i.refNumber.trim()) {
    issues.push({ reason: "low_confidence", message: "Invoice number is required.", blocking: true });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.txnDate)) {
    issues.push({ reason: "low_confidence", message: "Invoice date is required.", blocking: true });
  }
  if (i.totalCents === null || i.totalCents < 0) {
    issues.push({ reason: "low_confidence", message: "Total is required and must be ≥ 0.", blocking: true });
  }

  if (i.subtotalCents !== null && i.taxCents !== null && i.totalCents !== null) {
    const diff = Math.abs(i.subtotalCents + i.taxCents - i.totalCents);
    if (diff > 2) {
      issues.push({
        reason: "amount_mismatch",
        message: `Subtotal + tax differs from total by ${diff} cents.`,
        blocking: false,
        detail: { subtotalCents: i.subtotalCents, taxCents: i.taxCents, totalCents: i.totalCents },
      });
    }
  }

  if (i.duplicateOf) {
    issues.push({
      reason: "duplicate_suspected",
      message: `Already captured on ${i.duplicateOf.capturedAt} by ${i.duplicateOf.uploaderName}.`,
      blocking: true,
      detail: { billId: i.duplicateOf.billId },
    });
  } else if (i.similarImageDocumentId) {
    issues.push({
      reason: "duplicate_suspected",
      message: "This photo looks like one already uploaded.",
      blocking: false,
      detail: { documentId: i.similarImageDocumentId },
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------
export interface OpenBillRef {
  billId: string;
  vendorId: string;
  kind: "bill" | "credit";
  openBalanceCents: Cents;
}
export interface ApplicationInput {
  billId: string;
  amountCents: Cents;
}
export interface PaymentConfirmInput {
  payeeVendorId: string | null;
  checkNumber: string;
  txnDate: string;
  amountCents: Cents | null;
  /** parsed from amount_written; null when unparseable */
  writtenAmountCents: Cents | null;
  applications: ApplicationInput[];
  openBills: OpenBillRef[];
  /** the uploader explicitly chose "leave $X unapplied" */
  leaveUnapplied: boolean;
  duplicateOf: { paymentId: string } | null;
}

export function validatePaymentConfirm(i: PaymentConfirmInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!i.payeeVendorId) issues.push({ reason: "new_vendor", message: "Pick the payee.", blocking: true });
  if (!i.checkNumber.trim()) issues.push({ reason: "low_confidence", message: "Check number is required.", blocking: true });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.txnDate)) issues.push({ reason: "low_confidence", message: "Check date is required.", blocking: true });
  if (i.amountCents === null || i.amountCents <= 0) {
    issues.push({ reason: "low_confidence", message: "Amount is required and must be > 0.", blocking: true });
  }
  if (i.amountCents !== null && i.writtenAmountCents !== null && i.amountCents !== i.writtenAmountCents) {
    issues.push({
      reason: "amount_mismatch",
      message: "Numeric and written amounts disagree — confirm the amount.",
      blocking: true,
      detail: { amountCents: i.amountCents, writtenAmountCents: i.writtenAmountCents },
    });
  }
  if (i.duplicateOf) {
    issues.push({ reason: "duplicate_suspected", message: "This check number was already captured for this payee.", blocking: true, detail: i.duplicateOf });
  }

  const byId = new Map(i.openBills.map((b) => [b.billId, b]));
  let appliedBills = 0;
  let appliedCredits = 0;
  for (const a of i.applications) {
    const bill = byId.get(a.billId);
    if (!bill) {
      issues.push({ reason: "over_applied", message: "Applied to a bill that is not open.", blocking: true, detail: { billId: a.billId } });
      continue;
    }
    if (a.amountCents <= 0) {
      issues.push({ reason: "amount_mismatch", message: "Application amounts must be > 0.", blocking: true, detail: { billId: a.billId } });
    }
    if (a.amountCents > bill.openBalanceCents) {
      issues.push({
        reason: "over_applied",
        message: "Applied more than the bill's open balance.",
        blocking: true,
        detail: { billId: a.billId, amountCents: a.amountCents, openBalanceCents: bill.openBalanceCents },
      });
    }
    if (i.payeeVendorId && bill.vendorId !== i.payeeVendorId) {
      issues.push({ reason: "multi_vendor_check", message: "A check can only pay one vendor's bills.", blocking: true, detail: { billId: a.billId } });
    }
    if (bill.kind === "credit") appliedCredits += a.amountCents;
    else appliedBills += a.amountCents;
  }

  // Credits reduce what the check needs to cover: check amount = bills applied − credits applied.
  const net = appliedBills - appliedCredits;
  if (i.amountCents !== null && i.amountCents > 0) {
    if (i.applications.length === 0) {
      if (!i.leaveUnapplied) {
        issues.push({ reason: "unapplied_payment", message: "Tick the invoices this check pays, or choose “leave unapplied”.", blocking: true });
      } else {
        issues.push({ reason: "unapplied_payment", message: "Check recorded with no invoices applied.", blocking: false });
      }
    } else if (net !== i.amountCents) {
      const diff = i.amountCents - net;
      if (i.leaveUnapplied && diff > 0) {
        issues.push({ reason: "unapplied_payment", message: `${diff} cents left unapplied.`, blocking: false, detail: { unappliedCents: diff } });
      } else {
        issues.push({
          reason: "amount_mismatch",
          message: "Applied invoices don't add up to the check amount.",
          blocking: true,
          detail: { amountCents: i.amountCents, appliedNetCents: net },
        });
      }
    }
  }

  return issues;
}

export function hasBlocking(issues: ValidationIssue[]): boolean {
  return issues.some((x) => x.blocking);
}
