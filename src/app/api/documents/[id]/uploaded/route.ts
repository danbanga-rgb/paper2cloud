import { NextResponse } from "next/server";
/** POST — client signals all pages uploaded → status extracting → enqueue extraction job. Phase 1. */
export async function POST() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
