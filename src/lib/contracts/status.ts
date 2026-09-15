/**
 * SPEC §8 — Document state machine and exception codes (CONTRACT).
 *
 * `canTransition` is the single source of truth. Server routes must call `assertTransition`
 * before updating `documents.status`; the DB does not enforce this (yet).
 */
import { z } from "zod";

export const DOC_STATUSES = [
  "received",
  "extracting",
  "extracted",
  "needs_confirmation",
  "confirmed",
  "needs_attention",
  "approved",
  "staged",
  "pushed",
  "failed",
  "void",
] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];
export const DocStatusSchema = z.enum(DOC_STATUSES);

export const EXCEPTION_REASONS = [
  "extraction_failed",
  "low_confidence",
  "new_vendor",
  "duplicate_suspected",
  "amount_mismatch",
  "unapplied_payment",
  "multi_vendor_check",
  "type_conflict",
  "qb_error",
  "money_note",
  "over_applied",
] as const;
export type ExceptionReason = (typeof EXCEPTION_REASONS)[number];
export const ExceptionReasonSchema = z.enum(EXCEPTION_REASONS);

export type Actor = "system" | "uploader" | "owner";

/** Allowed transitions: from → { to → who may do it }. */
const TRANSITIONS: Record<DocStatus, Partial<Record<DocStatus, Actor[]>>> = {
  received: { extracting: ["system"], void: ["owner"] },
  extracting: { extracted: ["system"], needs_attention: ["system"], void: ["owner"] },
  extracted: { needs_confirmation: ["system"], void: ["owner"] },
  needs_confirmation: {
    confirmed: ["uploader", "owner"],
    needs_attention: ["uploader", "system"], // "Flag for owner" or a validation failure
    void: ["owner"],
  },
  confirmed: {
    approved: ["system", "owner"], // system only when auto-push policy passes (§11)
    needs_attention: ["system"], // validation failure after confirm
    void: ["owner"],
  },
  needs_attention: {
    needs_confirmation: ["owner"], // send back to uploader
    confirmed: ["owner"], // owner fixed it themselves
    approved: ["owner"],
    void: ["owner"],
  },
  approved: { staged: ["system"], needs_attention: ["system"], void: ["owner"] },
  staged: { pushed: ["system"], failed: ["system"] },
  pushed: {}, // terminal; corrections happen in QuickBooks
  failed: { needs_attention: ["system", "owner"], staged: ["owner"] }, // retry
  void: {},
};

export function canTransition(from: DocStatus, to: DocStatus, actor: Actor): boolean {
  const allowed = TRANSITIONS[from]?.[to];
  return !!allowed && allowed.includes(actor);
}

export class IllegalTransition extends Error {
  constructor(
    public readonly from: DocStatus,
    public readonly to: DocStatus,
    public readonly actor: Actor,
  ) {
    super(`Illegal transition ${from} → ${to} by ${actor}`);
  }
}

export function assertTransition(from: DocStatus, to: DocStatus, actor: Actor): void {
  if (!canTransition(from, to, actor)) throw new IllegalTransition(from, to, actor);
}

/** Statuses that count as "open" for the uploader's badge. */
export const UPLOADER_OPEN: readonly DocStatus[] = ["needs_confirmation"];
/** Statuses that appear in the owner's needs-attention queue. */
export const OWNER_QUEUE: readonly DocStatus[] = ["needs_attention", "failed"];
/** Statuses after which the record is immutable in this system. */
export const TERMINAL: readonly DocStatus[] = ["pushed", "void"];

/**
 * SPEC §11 — auto-approve policy. Pure; the caller gathers the inputs.
 */
export interface AutoPushInput {
  autoPushEnabled: boolean;
  minConfidence: number;
  overallConfidence: number;
  /** Every field below CONFIDENCE.normal was edited by the uploader. */
  allLowConfidenceFieldsEdited: boolean;
  vendorHasQbListId: boolean;
  openExceptionCount: number;
  /** For checks: applications sum equals amount. For bills: true. */
  applicationsBalanced: boolean;
}

export function shouldAutoApprove(i: AutoPushInput): boolean {
  if (!i.autoPushEnabled) return false;
  if (!(i.overallConfidence >= i.minConfidence || i.allLowConfidenceFieldsEdited)) return false;
  if (!i.vendorHasQbListId) return false;
  if (i.openExceptionCount > 0) return false;
  if (!i.applicationsBalanced) return false;
  return true;
}
