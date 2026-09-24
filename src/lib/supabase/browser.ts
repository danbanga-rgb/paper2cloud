"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "../env";

let client: SupabaseClient | null = null;
export function browserClient(): SupabaseClient {
  const env = publicEnv();
  client ??= createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return client;
}
