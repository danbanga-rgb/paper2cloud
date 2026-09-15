import { describe, expect, it } from "vitest";
import { validateInvoiceConfirm, validatePaymentConfirm, hasBlocking } from "@/lib/validation/confirm";
import { cents } from "@/lib/contracts/money";

const baseInvoice = {
  vendorId: "sysco", vendorIsNew: false, refNumber: "48812", txnDate: "2026-09-12",
  totalCents: cents(84210), subtotalCents: cents(81210), taxCents: cents(3000), kind: "bill" as const,
  duplicateOf: null, similarImageDocumentId: null,
};

describe("validateInvoiceConfirm", () => {
  it("passes a clean invoice", () => expect(validateInvoiceConfirm(baseInvoice)).toEqual([]));
  it("blocks on missing vendor / ref / date / total", () => {
    expect(hasBlocking(validateInvoiceConfirm({ ...baseInvoice, vendorId: null }))).toBe(true);
    expect(hasBlocking(validateInvoiceConfirm({ ...baseInvoice, refNumber: " " }))).toBe(true);
    expect(hasBlocking(validateInvoiceConfirm({ ...baseInvoice, txnDate: "9/12/26" }))).toBe(true);
    expect(hasBlocking(validateInvoiceConfirm({ ...baseInvoice, totalCents: null }))).toBe(true);
  });
  it("new vendor is non-blocking but raises an exception", () => {
    const r = validateInvoiceConfirm({ ...baseInvoice, vendorIsNew: true });
    expect(r).toHaveLength(1);
    expect(r[0]!.reason).toBe("new_vendor");
    expect(r[0]!.blocking).toBe(false);
  });
  it("subtotal+tax mismatch beyond 2 cents is non-blocking amount_mismatch", () => {
    const r = validateInvoiceConfirm({ ...baseInvoice, taxCents: cents(3100) });
    expect(r.map((x) => x.reason)).toEqual(["amount_mismatch"]);
    expect(hasBlocking(r)).toBe(false);
    expect(validateInvoiceConfirm({ ...baseInvoice, taxCents: cents(3002) })).toEqual([]);
  });
  it("exact duplicate blocks; similar image only warns", () => {
    expect(hasBlocking(validateInvoiceConfirm({ ...baseInvoice, duplicateOf: { billId: "b1", capturedAt: "2026-09-10", uploaderName: "Maria" } }))).toBe(true);
    const r = validateInvoiceConfirm({ ...baseInvoice, similarImageDocumentId: "d9" });
    expect(r[0]!.reason).toBe("duplicate_suspected");
    expect(r[0]!.blocking).toBe(false);
  });
});

const bills = [
  { billId: "b1", vendorId: "pepsi", kind: "bill" as const, openBalanceCents: cents(80000) },
  { billId: "b2", vendorId: "pepsi", kind: "bill" as const, openBalanceCents: cents(50000) },
  { billId: "c1", vendorId: "pepsi", kind: "credit" as const, openBalanceCents: cents(3550) },
  { billId: "x1", vendorId: "sysco", kind: "bill" as const, openBalanceCents: cents(10000) },
];
const basePayment = {
  payeeVendorId: "pepsi", checkNumber: "1047", txnDate: "2026-09-12", amountCents: cents(126450),
  writtenAmountCents: cents(126450), applications: [{ billId: "b1", amountCents: cents(80000) }, { billId: "b2", amountCents: cents(50000) }, { billId: "c1", amountCents: cents(3550) }],
  openBills: bills, leaveUnapplied: false, duplicateOf: null,
};

describe("validatePaymentConfirm", () => {
  it("passes: two bills minus one credit equals the check", () => {
    expect(validatePaymentConfirm(basePayment)).toEqual([]);
  });
  it("blocks when applications don't add up", () => {
    const r = validatePaymentConfirm({ ...basePayment, applications: [{ billId: "b1", amountCents: cents(80000) }] });
    expect(r.map((x) => x.reason)).toEqual(["amount_mismatch"]);
    expect(hasBlocking(r)).toBe(true);
  });
  it("allows explicit partial: leave the remainder unapplied (non-blocking exception)", () => {
    const r = validatePaymentConfirm({ ...basePayment, applications: [{ billId: "b1", amountCents: cents(80000) }], leaveUnapplied: true });
    expect(r).toHaveLength(1);
    expect(r[0]!.reason).toBe("unapplied_payment");
    expect(r[0]!.blocking).toBe(false);
    expect(r[0]!.detail).toEqual({ unappliedCents: 46450 });
  });
  it("no applications: blocks unless leaveUnapplied", () => {
    expect(hasBlocking(validatePaymentConfirm({ ...basePayment, applications: [] }))).toBe(true);
    const r = validatePaymentConfirm({ ...basePayment, applications: [], leaveUnapplied: true });
    expect(r[0]!.reason).toBe("unapplied_payment");
    expect(hasBlocking(r)).toBe(false);
  });
  it("blocks over-application and cross-vendor application", () => {
    expect(validatePaymentConfirm({ ...basePayment, applications: [{ billId: "b1", amountCents: cents(90000) }], amountCents: cents(90000), writtenAmountCents: cents(90000) }).map((x) => x.reason)).toContain("over_applied");
    expect(validatePaymentConfirm({ ...basePayment, applications: [{ billId: "x1", amountCents: cents(10000) }], amountCents: cents(10000), writtenAmountCents: cents(10000) }).map((x) => x.reason)).toContain("multi_vendor_check");
  });
  it("blocks when numeric and written amounts disagree", () => {
    const r = validatePaymentConfirm({ ...basePayment, writtenAmountCents: cents(126400) });
    expect(r.map((x) => x.reason)).toContain("amount_mismatch");
    expect(hasBlocking(r)).toBe(true);
  });
  it("blocks duplicate check numbers for the same payee", () => {
    expect(hasBlocking(validatePaymentConfirm({ ...basePayment, duplicateOf: { paymentId: "p0" } }))).toBe(true);
  });
});
