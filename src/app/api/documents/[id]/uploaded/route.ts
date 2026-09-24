import { NextResponse, after } from "next/server";
import { requireUser, route, HttpError } from "@/lib/auth/session";
import { PAGES_BUCKET, serviceClient } from "@/lib/supabase/server";
import { transition } from "@/lib/documents/transition";
import { runExtraction } from "@/lib/capture/run-extraction";

/**
 * POST — client signals all pages uploaded → status extracting → extraction runs after the response.
 * Idempotent: a document already past `received` just reports its status (offline-queue retries).
 */
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const db = serviceClient();

  const { data: doc } = await db.from("documents").select("id, status, uploader_id").eq("id", id).maybeSingle();
  if (!doc) throw new HttpError(404, "Not found");
  if (doc.uploader_id !== user.id && user.role !== "owner") throw new HttpError(403, "Not allowed");
  if (doc.status !== "received") return NextResponse.json({ status: doc.status });

  const { data: pages } = await db.from("pages").select("storage_path").eq("document_id", id);
  const folder = await db.storage.from(PAGES_BUCKET).list(id);
  const stored = new Set((folder.data ?? []).map((f) => `${id}/${f.name}`));
  const missing = (pages ?? []).filter((p) => !stored.has(p.storage_path));
  if (missing.length) throw new HttpError(409, `${missing.length} page(s) not uploaded yet`);

  await transition(db, id, "received", "extracting", "system", user.id);
  after(() => runExtraction(db, id));
  return NextResponse.json({ status: "extracting" }, { status: 202 });
});
