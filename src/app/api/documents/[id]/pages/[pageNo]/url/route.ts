import { NextResponse } from "next/server";
import { requireUser, route, HttpError } from "@/lib/auth/session";
import { PAGES_BUCKET, SIGNED_URL_TTL_S, serviceClient } from "@/lib/supabase/server";

/**
 * GET — signed read URL (≤ 10 min). Uploaders may only open their own check images (SPEC §12):
 * a page is a check image when any document sharing that storage path is a check.
 */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string; pageNo: string }> }) => {
  const { id, pageNo } = await ctx.params;
  const user = await requireUser();
  const db = serviceClient();

  const { data: page } = await db
    .from("pages")
    .select("storage_path, documents!inner(uploader_id)")
    .eq("document_id", id)
    .eq("page_no", Number(pageNo))
    .maybeSingle();
  if (!page) throw new HttpError(404, "Not found");

  if (user.role !== "owner") {
    const owner = (page.documents as unknown as { uploader_id: string | null }).uploader_id;
    if (owner !== user.id) {
      const { data: sharing } = await db.from("pages").select("documents!inner(doc_type)").eq("storage_path", page.storage_path);
      const isCheckImage = (sharing ?? []).some((s) => (s.documents as unknown as { doc_type: string }).doc_type === "check");
      if (isCheckImage) throw new HttpError(403, "Check images are visible to their uploader and the owner only");
    }
  }

  const { data, error } = await db.storage.from(PAGES_BUCKET).createSignedUrl(page.storage_path, SIGNED_URL_TTL_S);
  if (error || !data) throw new Error("could not sign URL");
  return NextResponse.json({ url: data.signedUrl, expires_in: SIGNED_URL_TTL_S });
});
