import { NextResponse } from "next/server";
import { z } from "zod";
import { devOnlyGuard } from "@/lib/fixtures/dev-only";
import { FixtureStore } from "@/lib/fixtures/store";
import { LabelFileSchema, finalizeLabel } from "@/lib/fixtures/label";

/**
 * POST { label } → normalizes to ground truth (finalizeLabel) and writes fixtures/labels/<image>.json.
 * A label with status `skipped` is saved as skipped (excluded from scoring) and needs a reason.
 */
const Body = z.object({ label: LabelFileSchema });

export async function POST(req: Request) {
  const blocked = devOnlyGuard();
  if (blocked) return blocked;
  try {
    const { label } = Body.parse(await req.json());
    if (label.status === "skipped" && !label.skip_reason?.trim()) throw new Error("say why this photo is skipped");
    const unanswered = label.status === "skipped" ? [] : label.questions.filter((q) => !q.answer?.trim());
    if (unanswered.length) throw new Error(`answer the open question(s) first: ${unanswered.map((q) => q.text).join(" / ")}`);
    const final = finalizeLabel(label, new Date().toISOString());
    new FixtureStore().writeLabel(final);
    return NextResponse.json({ label: final });
  } catch (e) {
    const message =
      e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : e instanceof Error ? e.message : "save failed";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
