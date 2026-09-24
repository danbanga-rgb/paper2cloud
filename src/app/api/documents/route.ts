import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, route } from "@/lib/auth/session";
import { PAGES_BUCKET, serviceClient } from "@/lib/supabase/server";
import { audit } from "@/lib/documents/transition";

/**
 * POST /api/documents  { doc_type_hint, captured_at, batch_key?, pages: [{page_no, width, height, bytes, image_hash?}] }
 * → { document_id, upload_urls: [{page_no, signed_put_url, token, storage_path}] }
 * Creates documents + pages rows (status received) and returns signed upload URLs for direct upload.
 * `client_ref` makes retries from the offline queue idempotent (same device-side id → same document).
 */
const Body = z.object({
  doc_type_hint: z.enum(["invoice", "check", "statement", "delivery_slip", "credit_memo", "other"]),
  captured_at: z.string().datetime({ offset: true }),
  batch_key: z.string().max(100).optional(),
  client_ref: z.string().uuid(),
  pages: z
    .array(z.object({
      page_no: z.number().int().min(1),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      bytes: z.number().int().positive().max(15_000_000),
      image_hash: z.string().regex(/^[0-9a-f]{16}$/).optional(),
    }))
    .min(1)
    .max(20),
});

export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const body = Body.parse(await req.json());
  const db = serviceClient();

  // Offline-queue retry: the device reuses client_ref, so return the existing document instead of a duplicate.
  const ref = `pwa:${body.client_ref}`;
  const { data: existing } = await db.from("documents").select("id").eq("original_message_ref", ref).eq("uploader_id", user.id).maybeSingle();

  let documentId = existing?.id as string | undefined;
  if (!documentId) {
    const { data: doc } = await db
      .from("documents")
      .insert({
        doc_type: body.doc_type_hint === "credit_memo" ? "credit_memo" : body.doc_type_hint,
        status: "received",
        source: "pwa",
        uploader_id: user.id,
        captured_at: body.captured_at,
        batch_key: body.batch_key ?? null,
        image_hash: body.pages.find((p) => p.page_no === 1)?.image_hash ?? null,
        original_message_ref: ref,
      })
      .select("id")
      .single()
      .throwOnError();
    documentId = doc!.id as string;
    await db.from("pages").insert(body.pages.map((p) => ({
      document_id: documentId, page_no: p.page_no, storage_path: `${documentId}/${p.page_no}.jpg`,
      width: p.width, height: p.height, bytes: p.bytes,
    }))).throwOnError();
    await audit(db, user.id, "created", "document", documentId, { hint: body.doc_type_hint, pages: body.pages.length });
  }

  const upload_urls = await Promise.all(
    body.pages.map(async (p) => {
      const storage_path = `${documentId}/${p.page_no}.jpg`;
      const { data, error } = await db.storage.from(PAGES_BUCKET).createSignedUploadUrl(storage_path, { upsert: true });
      if (error || !data) throw new Error(`could not sign upload for page ${p.page_no}`);
      return { page_no: p.page_no, signed_put_url: data.signedUrl, token: data.token, storage_path };
    }),
  );
  return NextResponse.json({ document_id: documentId, upload_urls }, { status: existing ? 200 : 201 });
});
