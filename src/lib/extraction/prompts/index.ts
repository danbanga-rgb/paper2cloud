/**
 * Prompt loader. Prompts are markdown files named <name>.<version>.md. Changing a prompt means a
 * new version file (CLAUDE.md rule 9). The version string is recorded on every extraction row.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Prompts } from "../extract";

export function loadPrompts(version: string, dir = __dirname): Prompts {
  const read = (name: string) => readFileSync(join(dir, `${name}.${version}.md`), "utf8");
  return {
    version,
    classify: read("classify"),
    invoice: read("invoice"),
    check: read("check"),
    statement: read("statement"),
    recordOnly: read("record-only"),
  };
}
