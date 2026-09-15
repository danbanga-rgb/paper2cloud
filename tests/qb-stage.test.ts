import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { stageBill, stagePayment, stageVendor, type BillRow, type PaymentRow, type VendorRow } from "@/lib/qb/stage";
import { QbRequestSchema } from "@/lib/contracts/qb";
import { cents } from "@/lib/contracts/money";

const golden = (name: string) => JSON.parse(readFileSync(`fixtures/golden/${name}.json`, "utf8"));

const pepsi: VendorRow = { id: "11111111-1111-4111-8111-111111111111", name: "Pepsi Bottling", qbListId: "80000012-1234567890" };
const newVendor: VendorRow = { id: "22222222-2222-4222-8222-222222222222", name: "New Produce Co", qbListId: null };
const bill = (id: string, ref: string, total: number, kind: "bill" | "credit" = "bill", qbTxnId: string | null = null): BillRow => ({
  id, documentId: `doc-${id}`, vendorId: pepsi.id, kind, refNumber: ref, txnDate: "2026-09-10", dueDate: null,
  totalCents: cents(total), expenseAccountListId: "COGS-LISTID", memo: null, qbTxnId,
});
const b1 = bill("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "22910", 80000, "bill", "TXN-B1");
const b2 = bill("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "22987", 50000, "bill", null);
const c1 = bill("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "CM-771", 3550, "credit", "TXN-C1");
const billsById = new Map([b1, b2, c1].map((b) => [b.id, b]));

const payment: PaymentRow = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", documentId: "doc-check-1047", vendorId: pepsi.id, method: "check",
  checkNumber: "1047", txnDate: "2026-09-12", amountCents: cents(126450), bankAccountListId: "CHK-LISTID", memo: "inv 22910, 22987",
};

describe("stageBill", () => {
  it("BillAdd matches golden (test a)", () => {
    const s = stageBill(b1, pepsi, "Maria");
    expect(s.op).toBe("BillAdd");
    expect(s.request).toEqual(golden("bill-add"));
    expect(QbRequestSchema.parse(s.request)).toBeTruthy();
    expect(s.dependsOnEntityIds).toEqual([]);
  });
  it("credit memo becomes VendorCreditAdd", () => {
    expect(stageBill(c1, pepsi, "Maria").op).toBe("VendorCreditAdd");
  });
  it("unsynced vendor creates a dependency and a pending ref", () => {
    const s = stageBill({ ...b1, vendorId: newVendor.id }, newVendor, "Maria");
    expect(s.dependsOnEntityIds).toEqual([newVendor.id]);
    expect((s.request as { VendorRef: { ListID: string } }).VendorRef.ListID).toBe(`pending:${newVendor.id}`);
    expect(stageVendor(newVendor).request).toEqual({ op: "VendorAdd", Name: "New Produce Co" });
  });
});

describe("stagePayment", () => {
  it("BillPaymentCheckAdd with two bills and one credit matches golden (test b)", () => {
    const s = stagePayment(payment, pepsi, [
      { paymentId: payment.id, billId: b1.id, amountCents: cents(80000) },
      { paymentId: payment.id, billId: b2.id, amountCents: cents(50000) },
      { paymentId: payment.id, billId: c1.id, amountCents: cents(3550) },
    ], billsById, "Maria", "COGS-LISTID");
    expect(s.op).toBe("BillPaymentCheckAdd");
    expect(s.request).toEqual(golden("bill-payment-check-add"));
    const r = s.request as { AppliedToTxnAdd: { PaymentAmount: string }[] };
    const sum = r.AppliedToTxnAdd.reduce((a, x) => a + Math.round(Number(x.PaymentAmount) * 100), 0);
    expect(sum).toBe(126450);
    expect(s.dependsOnEntityIds).toEqual([b2.id]); // b1 and c1 already have TxnIDs
  });
  it("no applications → CheckAdd to COGS", () => {
    const s = stagePayment(payment, pepsi, [], billsById, "Maria", "COGS-LISTID");
    expect(s.op).toBe("CheckAdd");
    expect(s.request).toEqual(golden("check-add"));
  });
  it("refuses non-check methods in MVP", () => {
    expect(() => stagePayment({ ...payment, method: "cash", checkNumber: null }, pepsi, [], billsById, "Maria", "COGS")).toThrow();
  });
});
