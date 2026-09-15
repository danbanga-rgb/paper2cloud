import { NextResponse } from "next/server";
/**
 * POST — uploader confirmation. Body validated with Zod; runs validateInvoiceConfirm / validatePaymentConfirm
 * (src/lib/validation/confirm.ts); writes bills / payments / payment_applications / vendor_aliases with the
 * service role; assertTransition(needs_confirmation → confirmed); raises exceptions; evaluates shouldAutoApprove.
 * Phase 1 (invoice), Phase 2 (check applications).
 */
export async function POST() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
