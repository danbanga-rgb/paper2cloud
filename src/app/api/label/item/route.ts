import { NextResponse } from "next/server";
import { devOnlyGuard } from "@/lib/fixtures/dev-only";
import { FixtureStore } from "@/lib/fixtures/store";
import { emptyLabel } from "@/lib/fixtures/label";

/**
 * GET ?image=<image> → { label, draft, working }: `working` is what the editor starts from —
 * the saved label if any, else the model draft, else an empty invoice label.
 */
export async function GET(req: Request) {
  const blocked = devOnlyGuard();
  if (blocked) return blocked;
  const image = new URL(req.url).searchParams.get("image") ?? "";
  const store = new FixtureStore();
  try {
    store.imagePath(image);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const label = store.readLabel(image);
  const draft = store.readDraft(image);
  return NextResponse.json({ label, draft, working: label ?? draft ?? emptyLabel(image, [image]) });
}
