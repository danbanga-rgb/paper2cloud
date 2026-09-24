/**
 * Extraction worker (SPEC §3, §6.5, §8): extracting → extracted → needs_confirmation, or
 * extracting → needs_attention with `extraction_failed`. Persists the composite-photo plan:
 * one `extractions` row per document, new documents sharing the uploaded document's pages.
 * Runs with the service role; callers have already authorized the request.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractDocument } from "../extraction/extract";
import { providerFromEnv } from "../extraction/providers";
import { loadPrompts } from "../extraction/prompts";
import { ExtractionHintSchema, type ExtractionHint } from "../contracts/extraction";
import { PAGES_BUCKET, SIGNED_URL_TTL_S } from "../supabase/server";
import { planDocuments } from "./plan";
import { audit, transition } from "../documents/transition";
import { join } from "node:path";

const PROMPTS_DIR = join(process.cwd(), "src/lib/extraction/prompts");

export async function runExtraction(db: SupabaseClient, documentId: string): Promise<void> {
  const { data: doc, error } = await db
    .from("documents")
    .select("id, doc_type, status, uploader_id, captured_at, batch_key, source")
    .eq("id", documentId)
    .single();
  if (error || !doc) throw new Error(`document ${documentId} not found`);
  if (doc.status !== "extracting") throw new Error(`document ${documentId} is ${doc.status}, not extracting`);

  const { data: pages } = await db.from("pages").select("id, page_no, storage_path, width, height, bytes").eq("document_id", documentId).order("page_no");
  if (!pages?.length) throw new Error(`document ${documentId} has no pages`);

  try {
    const images = await Promise.all(
      pages.map(async (p) => {
        const { data: signed, error: e } = await db.storage.from(PAGES_BUCKET).createSignedUrl(p.storage_path, SIGNED_URL_TTL_S);
        if (e || !signed) throw new Error(`could not sign page ${p.page_no}`);
        return { url: signed.signedUrl, pageNo: p.page_no as number };
      }),
    );
    const promptVersion = await currentPromptVersion(db);
    const result = await extractDocument(providerFromEnv(), loadPrompts(promptVersion, PROMPTS_DIR), images, hintFor(doc.doc_type));
    const plan = planDocuments(documentId, doc.batch_key, result);

    for (const planned of plan.documents) {
      let id = planned.existingId;
      if (id) {
        await db.from("documents").update({ doc_type: planned.docType, batch_key: plan.batchKey }).eq("id", id).throwOnError();
      } else {
        const { data: created } = await db
          .from("documents")
          .insert({
            doc_type: planned.docType, status: "needs_confirmation", source: doc.source, uploader_id: doc.uploader_id,
            captured_at: doc.captured_at, batch_key: plan.batchKey,
          })
          .select("id")
          .single()
          .throwOnError();
        id = created!.id as string;
        await db.from("pages").insert(pages.map((p) => ({
          document_id: id, page_no: p.page_no, storage_path: p.storage_path, width: p.width, height: p.height, bytes: p.bytes,
        }))).throwOnError();
        await audit(db, null, "created_from_photo", "document", id, { from_document: documentId, doc_type: planned.docType });
      }
      await db.from("extractions").insert({
        document_id: id,
        version: await nextVersion(db, id),
        model: result.model,
        prompt_version: result.promptVersion,
        classification: result.classification,
        payload: planned.payload,
        overall_confidence: planned.overallConfidence,
        issues: planned.typeConflict ? [...result.issues, "type_conflict"] : result.issues,
        latency_ms: planned.carriesCost ? result.latencyMs : null,
        cost_usd: planned.carriesCost ? result.costUsd : null,
      }).throwOnError();
    }

    await transition(db, documentId, "extracting", "extracted", "system", null);
    await transition(db, documentId, "extracted", "needs_confirmation", "system", null);
    // TODO(phase1): Web Push "ready to confirm" to doc.uploader_id — needs a push_subscriptions table (docs/DECISIONS-NEEDED.md).
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    await db.from("exceptions").insert({ document_id: documentId, reason: "extraction_failed", detail: { message } });
    await transition(db, documentId, "extracting", "needs_attention", "system", null, { reason: "extraction_failed" });
  }
}

async function currentPromptVersion(db: SupabaseClient): Promise<string> {
  const { data } = await db.from("settings").select("value").eq("key", "prompt_version").maybeSingle();
  return typeof data?.value === "string" ? data.value : process.env.EXTRACTION_PROMPT_VERSION ?? "v1";
}

async function nextVersion(db: SupabaseClient, documentId: string): Promise<number> {
  const { data } = await db.from("extractions").select("version").eq("document_id", documentId).order("version", { ascending: false }).limit(1);
  return ((data?.[0]?.version as number | undefined) ?? 0) + 1;
}

/** The document's initial doc_type is the button the uploader pressed (set by POST /api/documents). */
function hintFor(docType: string): ExtractionHint {
  const parsed = ExtractionHintSchema.safeParse(docType);
  return parsed.success ? parsed.data : "unknown";
}
