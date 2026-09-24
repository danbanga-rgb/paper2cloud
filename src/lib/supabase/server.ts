/**
 * Supabase clients for server code.
 * - `userClient()` acts as the signed-in user (cookies) → RLS applies. Use for reads.
 * - `serviceClient()` bypasses RLS. Use only after the route has checked the caller's role and
 *   validated the body (writes to bills/payments/aliases, extraction worker, storage signing).
 */
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publicEnv, serverEnv } from "../env";

export async function userClient(): Promise<SupabaseClient> {
  const env = publicEnv();
  const store = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
        try {
          for (const c of list) store.set(c.name, c.value, c.options);
        } catch {
          // called from a server component: cookies are read-only there; middleware refreshes the session
        }
      },
    },
  });
}

let service: SupabaseClient | null = null;
export function serviceClient(): SupabaseClient {
  const env = serverEnv();
  service ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return service;
}

/** Private bucket holding page images (SPEC §12). */
export const PAGES_BUCKET = "pages";
/** Signed read URLs live at most 10 minutes (SPEC §12). */
export const SIGNED_URL_TTL_S = 600;
