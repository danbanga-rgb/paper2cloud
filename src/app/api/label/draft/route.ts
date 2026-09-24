import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { devOnlyGuard } from "@/lib/fixtures/dev-only";
import { FixtureStore, imageContentType } from "@/lib/fixtures/store";
import { labelFromExtraction } from "@/lib/fixtures/label";
import { extractDocument } from "@/lib/extraction/extract";
import { providerFromEnv } from "@/lib/extraction/providers";
import { loadPrompts } from "@/lib/extraction/prompts";

/**
 * POST { image, pages? } → runs the extractor on the photo set (hint `unknown`, as for imported
 * fixtures), stores the untouched draft in fixtures/drafts/, and returns it. Re-running replaces the
 * draft; the saved label (if any) is never touched here.
 * WhatsApp already recompresses photos to ≤ 1600 px, inside the SPEC §6.5 2000 px limit, so no resize.
 */
const Body = z.object({ image: z.string(), pages: z.array(z.string()).min(1).max(20).optional() });

export async function POST(req: Request) {
  const blocked = devOnlyGuard();
  if (blocked) return blocked;
  const store = new FixtureStore();
  try {
    const { image, pages: requested } = Body.parse(await req.json());
    const pages = requested ?? [image];
    if (pages[0] !== image) throw new Error("pages[0] must be the image being labeled");
    const images = pages.map((p, i) => {
      if (imageContentType(p) === "image/heic") throw new Error(`${p} is HEIC; convert it to JPEG first`);
      const bytes = readFileSync(store.imagePath(p)).toString("base64");
      return { url: `data:${imageContentType(p)};base64,${bytes}`, pageNo: i + 1 };
    });
    const version = process.env.EXTRACTION_PROMPT_VERSION ?? "v1";
    const prompts = loadPrompts(version, join(process.cwd(), "src/lib/extraction/prompts"));
    const result = await extractDocument(providerFromEnv(), prompts, images, "unknown");
    const draft = labelFromExtraction(image, pages, result);
    store.writeDraft(draft);
    return NextResponse.json({ draft, costUsd: result.costUsd, latencyMs: result.latencyMs, issues: result.issues });
  } catch (e) {
    // never echo model output: a check response could carry bank digits (SPEC §12)
    return NextResponse.json({ error: e instanceof Error ? e.message : "draft failed" }, { status: 422 });
  }
}
