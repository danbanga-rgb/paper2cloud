/**
 * Route-level authorization (SPEC §12: owner-only routes are server-checked, not just hidden).
 * There is no self-signup: an `app_users` row, created by the owner, is what makes a login usable.
 */
import { NextResponse } from "next/server";
import { userClient } from "../supabase/server";

export type Role = "uploader" | "owner";
export interface AppUser {
  id: string;
  displayName: string;
  role: Role;
}

export async function currentUser(): Promise<AppUser | null> {
  const supabase = await userClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from("app_users")
    .select("id, display_name, role, active")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (!data || !data.active) return null;
  return { id: data.id, displayName: data.display_name, role: data.role };
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

/** Throws HttpError(401/403); `roles` omitted = any active user. */
export async function requireUser(roles?: readonly Role[]): Promise<AppUser> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Not signed in");
  if (roles && !roles.includes(user.role)) throw new HttpError(403, "Not allowed");
  return user;
}

/** Wrap a route handler so HttpError / ZodError become JSON responses. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e && typeof e === "object" && "issues" in e && (e as { name?: string }).name === "ZodError") {
        return NextResponse.json({ error: "Invalid request", issues: (e as { issues: unknown }).issues }, { status: 400 });
      }
      console.error("route error", e instanceof Error ? e.message : "unknown");
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
  };
}
