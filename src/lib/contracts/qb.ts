/**
 * SPEC §9 — Canonical QuickBooks request payloads (CONTRACT).
 *
 * This is the contract between PaperFlow and the Timesheet App's qbXML service. PaperFlow
 * writes these into `qb_sync.request_json`; the consumer renders qbXML from them. Field names
 * mirror qbXML on purpose so the renderer is mechanical. Money here is a decimal string with
 * two places ("842.10") because that is what qbXML wants and it avoids float drift in JSON.
 *
 * Nothing outside src/lib/qb/ may import this file (CLAUDE.md rule 4).
 */
import { z } from "zod";

const Money = z.string().regex(/^\d+\.\d{2}$/, "money must be a decimal string with 2 places");
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ListRef = z.object({ ListID: z.string().min(1) });

export const VendorAddSchema = z.object({
  op: z.literal("VendorAdd"),
  Name: z.string().min(1).max(41), // QB vendor name limit
});

export const ExpenseLineAddSchema = z.object({
  AccountRef: ListRef,
  Amount: Money,
  Memo: z.string().max(4095).optional(),
});

export const BillAddSchema = z.object({
  op: z.literal("BillAdd"),
  VendorRef: ListRef,
  TxnDate: IsoDate,
  DueDate: IsoDate.optional(),
  RefNumber: z.string().min(1).max(20), // QB RefNumber limit
  Memo: z.string().max(4095).optional(),
  ExpenseLineAdd: z.array(ExpenseLineAddSchema).min(1),
});

export const VendorCreditAddSchema = z.object({
  op: z.literal("VendorCreditAdd"),
  VendorRef: ListRef,
  TxnDate: IsoDate,
  RefNumber: z.string().min(1).max(20),
  Memo: z.string().max(4095).optional(),
  ExpenseLineAdd: z.array(ExpenseLineAddSchema).min(1),
});

export const SetCreditSchema = z.object({
  CreditTxnID: z.string().min(1),
  AppliedAmount: Money,
});

export const AppliedToTxnAddSchema = z.object({
  TxnID: z.string().min(1), // the bill's qb_txn_id
  PaymentAmount: Money,
  SetCredit: z.array(SetCreditSchema).optional(),
});

export const BillPaymentCheckAddSchema = z.object({
  op: z.literal("BillPaymentCheckAdd"),
  PayeeEntityRef: ListRef,
  APAccountRef: ListRef.optional(), // omitted → QB default AP
  TxnDate: IsoDate,
  BankAccountRef: ListRef,
  IsToBePrinted: z.literal(false),
  RefNumber: z.string().min(1).max(11), // check number limit
  Memo: z.string().max(4095).optional(),
  AppliedToTxnAdd: z.array(AppliedToTxnAddSchema).min(1),
});

export const CheckAddSchema = z.object({
  op: z.literal("CheckAdd"),
  AccountRef: ListRef, // bank account
  PayeeEntityRef: ListRef,
  RefNumber: z.string().min(1).max(11),
  TxnDate: IsoDate,
  Memo: z.string().max(4095).optional(),
  IsToBePrinted: z.literal(false),
  ExpenseLineAdd: z.array(ExpenseLineAddSchema).min(1),
});

export const QbRequestSchema = z.discriminatedUnion("op", [
  VendorAddSchema,
  BillAddSchema,
  VendorCreditAddSchema,
  BillPaymentCheckAddSchema,
  CheckAddSchema,
]);
export type QbRequest = z.infer<typeof QbRequestSchema>;
export type QbOp = QbRequest["op"];

export const QB_ENTITY_FOR_OP: Record<QbOp, "vendor" | "bill" | "credit" | "payment"> = {
  VendorAdd: "vendor",
  BillAdd: "bill",
  VendorCreditAdd: "credit",
  BillPaymentCheckAdd: "payment",
  CheckAdd: "payment",
};

/** What the consumer writes back per qb_sync row. */
export const QbSyncResultSchema = z.object({
  qb_sync_id: z.string().uuid(),
  status: z.enum(["ok", "error", "skipped"]),
  qb_txn_id: z.string().nullable(),
  qb_error_code: z.string().nullable(),
  qb_error_text: z.string().nullable(),
  /** QB error codes the consumer considers transient (retry ≤ 3 times, SPEC §9). */
  transient: z.boolean().default(false),
});
export type QbSyncResult = z.infer<typeof QbSyncResultSchema>;
