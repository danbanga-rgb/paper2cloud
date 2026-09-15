/**
 * Phase 0: node scripts/import-whatsapp-export.ts fixtures/raw/_chat.txt
 * Copies referenced media into fixtures/images/ and writes fixtures/images/manifest.json.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseWhatsAppExport, suggestBatches } from "../src/lib/ingest/whatsapp-export";

const chatPath = process.argv[2];
if (!chatPath) {
  console.error("usage: import-whatsapp-export <path/to/_chat.txt>");
  process.exit(1);
}
const outDir = join("fixtures", "images");
mkdirSync(outDir, { recursive: true });
const entries = parseWhatsAppExport(readFileSync(chatPath, "utf8"));
const batches = suggestBatches(entries);
const manifest = entries.flatMap((e) => {
  const src = join(dirname(chatPath), e.filename);
  if (!existsSync(src)) {
    console.warn(`missing media: ${e.filename}`);
    return [];
  }
  const dest = join(outDir, basename(e.filename));
  copyFileSync(src, dest);
  return [{ ...e, file: basename(dest), batch: batches.get(e.line) }];
});
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`${manifest.length} images → ${outDir}/manifest.json`);
