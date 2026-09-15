import { NextResponse } from "next/server";
/** GET — signed read URL (≤ 10 min). Uploaders may only fetch their own check images (SPEC §12). Phase 1. */
export async function GET() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
