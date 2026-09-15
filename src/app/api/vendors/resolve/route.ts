import { NextResponse } from "next/server";
/** POST { printed_name, printed_address } → VendorResolution. SQL fetches candidates; resolveVendor() decides. Phase 1. */
export async function POST() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
