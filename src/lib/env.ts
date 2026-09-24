/**
 * Environment, validated with Zod at first use (CLAUDE.md: Zod for every boundary).
 * Server-only values never reach the browser: `serverEnv()` must only be imported by route handlers,
 * server components and scripts.
 */
import { z } from "zod";

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
});

const ServerEnvSchema = PublicEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  EXTRACTION_PROVIDER: z.enum(["anthropic", "mock"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  EXTRACTION_MODEL: z.string().optional(),
  EXTRACTION_PROMPT_VERSION: z.string().default("v1"),
  EXTRACTION_DAILY_SPEND_ALERT_USD: z.coerce.number().default(5),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
});

export type PublicEnv = z.infer<typeof PublicEnvSchema>;
export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export function publicEnv(): PublicEnv {
  // Next inlines NEXT_PUBLIC_* only when referenced literally.
  return PublicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  });
}

let cached: ServerEnv | null = null;
export function serverEnv(): ServerEnv {
  cached ??= ServerEnvSchema.parse(process.env);
  return cached;
}
