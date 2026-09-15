import { NextResponse } from "next/server";
/**
 * POST /api/documents  { doc_type_hint, captured_at, batch_key?, pages: [{page_no, width, height, bytes, image_hash?}] }
 * → { document_id, upload_urls: [{page_no, signed_put_url, storage_path}] }
 * Creates documents + pages rows (status received) and returns signed PUT URLs for direct upload.
 * Phase 1.
 */
export async function POST() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
