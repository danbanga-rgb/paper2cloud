import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, route, HttpError } from "@/lib/auth/session";
import { serviceClient } from "@/lib/supabase/server";
import { transition } from "@/lib/documents/transition";
import { runExtraction } from "@/lib/capture/run-extraction";

/**
 * POST { document_id } — owner-only re-run for a document stuck in `received`/`extracting` (worker died
 * or timed out). §8 has no path back to `extracting` from later states; those go through S10 actions.
 * Normal uploads are extracted by POST /api/documents/:id/uploaded.
 */
const Body = z.object({ document_id: z.string().uuid() });

export const POST = route(async (req: Request) => {
  await requireUser(["owner"]);
  const { document_id } = Body.parse(await req.json());
  const db = serviceClient();
  const { data: doc } = await db.from("documents").select("status").eq("id", document_id).maybeSingle();
  if (!doc) throw new HttpError(404, "Not found");
  if (doc.status === "received") await transition(db, document_id, "received", "extracting", "system", null);
  else if (doc.status !== "extracting") throw new HttpError(409, `Document is ${doc.status}`);
  await runExtraction(db, document_id);
  return NextResponse.json({ ok: true });
});
