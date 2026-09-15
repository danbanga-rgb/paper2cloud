/**
 * SPEC §9 — canonical `qb_sync` request builders (CONTRACT). Pure.
 *
 * Input: reviewed rows from bills / payments / payment_applications / vendors (as plain objects).
 * Output: QbRequest payloads + the dependency edges the qb_sync writer must persist.
 *
 * Credit allocation rule (pins down qbXML's per-bill SetCredit):
 *   payment_applications rows on kind='bill' are the total reduction of that bill (cash + credit);
 *   rows on kind='credit' are the credit consumed. Credits are allocated to bill applications
 *   greedily in application order. PaymentAmount for a bill = its application − credit allocated
 *   to it. Sum of PaymentAmount across bills == check amount (validated upstream).
 */
import { fromCents, type Cents } from "../contracts/money";
import {
  BillAddSchema,
  BillPaymentCheckAddSchema,
  CheckAddSchema,
  VendorAddSchema,
  VendorCreditAddSchema,
  type QbRequest,
} from "../contracts/qb";

export interface VendorRow { id: string; name: string; qbListId: string | null }
export interface BillRow {
  id: string; documentId: string; vendorId: string; kind: "bill" | "credit";
  refNumber: string; txnDate: string; dueDate: string | null; totalCents: Cents;
  expenseAccountListId: string; memo: string | null; qbTxnId: string | null;
}
export interface PaymentRow {
  id: string; documentId: string; vendorId: string; method: "check" | "cash" | "other";
  checkNumber: string | null; txnDate: string; amountCents: Cents;
  bankAccountListId: string; memo: string | null;
}
export interface ApplicationRow { paymentId: string; billId: string; amountCents: Cents }

export interface StagedRequest {
  entity: "vendor" | "bill" | "credit" | "payment";
  entityId: string;
  op: QbRequest["op"];
  request: QbRequest;
  /** entity ids (not qb_sync ids) this request depends on; the writer resolves them to qb_sync rows */
  dependsOnEntityIds: string[];
}

export function memoFor(documentId: string, uploaderName: string, extra?: string | null): string {
  const base = `Paper2Cloud ${documentId.slice(0, 8)} · ${uploaderName}`;
  return extra ? `${base} · ${extra}`.slice(0, 4095) : base;
}

export function stageVendor(v: VendorRow): StagedRequest {
  const request = VendorAddSchema.parse({ op: "VendorAdd", Name: v.name.slice(0, 41) });
  return { entity: "vendor", entityId: v.id, op: "VendorAdd", request, dependsOnEntityIds: [] };
}

export function stageBill(b: BillRow, vendor: VendorRow, uploaderName: string): StagedRequest {
  const common = {
    VendorRef: { ListID: vendor.qbListId ?? `pending:${vendor.id}` },
    TxnDate: b.txnDate,
    RefNumber: b.refNumber.slice(0, 20),
    Memo: memoFor(b.documentId, uploaderName, b.memo),
    ExpenseLineAdd: [{ AccountRef: { ListID: b.expenseAccountListId }, Amount: fromCents(b.totalCents) }],
  };
  const deps = vendor.qbListId ? [] : [vendor.id];
  if (b.kind === "credit") {
    const request = VendorCreditAddSchema.parse({ op: "VendorCreditAdd", ...common });
    return { entity: "credit", entityId: b.id, op: "VendorCreditAdd", request, dependsOnEntityIds: deps };
  }
  const request = BillAddSchema.parse({ op: "BillAdd", ...common, ...(b.dueDate ? { DueDate: b.dueDate } : {}) });
  return { entity: "bill", entityId: b.id, op: "BillAdd", request, dependsOnEntityIds: deps };
}

export function stagePayment(
  p: PaymentRow,
  vendor: VendorRow,
  applications: ApplicationRow[],
  billsById: Map<string, BillRow>,
  uploaderName: string,
  cogsAccountListId: string,
): StagedRequest {
  if (p.method !== "check" || !p.checkNumber) {
    throw new Error("Only check payments are staged in MVP (SPEC §9, non-goals).");
  }
  const refNumber = p.checkNumber.slice(0, 11);
  const memo = memoFor(p.documentId, uploaderName, p.memo);
  const apps = applications.filter((a) => a.paymentId === p.id);

  if (apps.length === 0) {
    const request = CheckAddSchema.parse({
      op: "CheckAdd",
      AccountRef: { ListID: p.bankAccountListId },
      PayeeEntityRef: { ListID: vendor.qbListId ?? `pending:${vendor.id}` },
      RefNumber: refNumber,
      TxnDate: p.txnDate,
      Memo: memo,
      IsToBePrinted: false,
      ExpenseLineAdd: [{ AccountRef: { ListID: cogsAccountListId }, Amount: fromCents(p.amountCents) }],
    });
    return { entity: "payment", entityId: p.id, op: "CheckAdd", request, dependsOnEntityIds: vendor.qbListId ? [] : [vendor.id] };
  }

  const billApps = apps.filter((a) => billsById.get(a.billId)?.kind === "bill");
  const creditApps = apps.filter((a) => billsById.get(a.billId)?.kind === "credit");
  const creditPool = creditApps.map((c) => ({ billId: c.billId, remaining: c.amountCents as number }));

  const AppliedToTxnAdd = billApps.map((a) => {
    const bill = billsById.get(a.billId)!;
    let cash = a.amountCents as number;
    const SetCredit: { CreditTxnID: string; AppliedAmount: string }[] = [];
    for (const c of creditPool) {
      if (c.remaining <= 0 || cash <= 0) continue;
      const take = Math.min(c.remaining, cash);
      const credit = billsById.get(c.billId)!;
      SetCredit.push({ CreditTxnID: credit.qbTxnId ?? `pending:${credit.id}`, AppliedAmount: fromCents(take as Cents) });
      c.remaining -= take;
      cash -= take;
    }
    return {
      TxnID: bill.qbTxnId ?? `pending:${bill.id}`,
      PaymentAmount: fromCents(cash as Cents),
      ...(SetCredit.length ? { SetCredit } : {}),
    };
  });

  const request = BillPaymentCheckAddSchema.parse({
    op: "BillPaymentCheckAdd",
    PayeeEntityRef: { ListID: vendor.qbListId ?? `pending:${vendor.id}` },
    TxnDate: p.txnDate,
    BankAccountRef: { ListID: p.bankAccountListId },
    IsToBePrinted: false,
    RefNumber: refNumber,
    Memo: memo,
    AppliedToTxnAdd,
  });

  const deps = [
    ...(vendor.qbListId ? [] : [vendor.id]),
    ...apps.map((a) => a.billId).filter((id) => !billsById.get(id)?.qbTxnId),
  ];
  return { entity: "payment", entityId: p.id, op: "BillPaymentCheckAdd", request, dependsOnEntityIds: deps };
}

/**
 * The consumer must substitute `pending:<entityId>` ListIDs/TxnIDs with the real ids from the
 * dependency rows before rendering qbXML. This keeps staging pure and lets a payment be staged
 * in the same batch as the bills it pays.
 */
export const PENDING_REF = /^pending:([0-9a-f-]{36})$/;
