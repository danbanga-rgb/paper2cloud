import { NextResponse } from "next/server";
/**
 * Consumer-facing endpoints for the Timesheet App qbXML service (shared-secret auth). Phase 3.
 * GET  → next batch of qb_sync rows with status queued whose depends_on is ok (pending:<id> refs resolved server-side).
 * POST → QbSyncResult[] write-back: status, qb_txn_id, error; then propagate document status (staged → pushed | failed).
 */
export async function GET() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
export async function POST() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
