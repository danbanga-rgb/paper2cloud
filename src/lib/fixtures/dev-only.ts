import { NextResponse } from "next/server";

/**
 * The /label helper reads and writes the local fixtures folder and can serve check photos.
 * It must never run in a deployed build: every /api/label route starts with this guard.
 */
export function devOnlyGuard(): Response | null {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return null;
}
