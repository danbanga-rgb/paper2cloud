import { NextResponse } from "next/server";
/**
 * POST (internal, service-role) — run extractDocument() for a document id; write extractions row;
 * split multi-check images into N documents; move to needs_confirmation; send push. Phase 1.
 * Consider Supabase Edge Function or a queue if Vercel timeouts bite; keep the logic in src/lib/extraction.
 */
export async function POST() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
