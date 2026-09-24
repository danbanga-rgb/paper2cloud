import { anthropicProvider } from "./anthropic";
import { mockProvider } from "./mock";
import type { ExtractionProvider } from "../extract";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): ExtractionProvider {
  switch (env.EXTRACTION_PROVIDER ?? "anthropic") {
    case "mock":
      return mockProvider({});
    case "anthropic": {
      if (!env.ANTHROPIC_API_KEY || !env.EXTRACTION_MODEL) throw new Error("ANTHROPIC_API_KEY and EXTRACTION_MODEL required");
      const effort = EFFORTS.find((e) => e === env.EXTRACTION_EFFORT);
      return anthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.EXTRACTION_MODEL, effort });
    }
    default:
      throw new Error(`Unknown EXTRACTION_PROVIDER ${env.EXTRACTION_PROVIDER}`);
  }
}
