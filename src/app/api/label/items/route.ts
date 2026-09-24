import { NextResponse } from "next/server";
import { devOnlyGuard } from "@/lib/fixtures/dev-only";
import { FixtureStore } from "@/lib/fixtures/store";

/** GET → every fixture image in chat order with its labeling status (dev only). */
export async function GET() {
  const blocked = devOnlyGuard();
  if (blocked) return blocked;
  const items = new FixtureStore().list();
  const counts = items.reduce<Record<string, number>>((c, i) => ((c[i.status] = (c[i.status] ?? 0) + 1), c), {});
  return NextResponse.json({ items, counts, draftsEnabled: draftsEnabled() });
}

function draftsEnabled(): boolean {
  const p = process.env.EXTRACTION_PROVIDER ?? "anthropic";
  return p === "mock" || (p === "anthropic" && !!process.env.ANTHROPIC_API_KEY && !!process.env.EXTRACTION_MODEL);
}
