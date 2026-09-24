import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { devOnlyGuard } from "@/lib/fixtures/dev-only";
import { FixtureStore, imageContentType } from "@/lib/fixtures/store";

/** GET ?name=<image> → the image bytes (dev only; never cached, may be a check photo). */
export async function GET(req: Request) {
  const blocked = devOnlyGuard();
  if (blocked) return blocked;
  const name = new URL(req.url).searchParams.get("name") ?? "";
  let path: string;
  try {
    path = new FixtureStore().imagePath(name);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new Response(readFileSync(path), {
    headers: { "content-type": imageContentType(name), "cache-control": "no-store" },
  });
}
