/**
 * Phase 0: node scripts/import-whatsapp-export.ts fixtures/raw/_chat.txt
 * Copies referenced media into fixtures/images/ and writes fixtures/images/manifest.json.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { readdirSync } from "node:fs";
import { matchOmittedToDownloads, parseWhatsAppExport, suggestBatches } from "../src/lib/ingest/whatsapp-export";

const chatPath = process.argv[2];
if (!chatPath) {
  console.error("usage: import-whatsapp-export <path/to/_chat.txt>");
  process.exit(1);
}
const outDir = join("fixtures", "images");
mkdirSync(outDir, { recursive: true });
let entries = parseWhatsAppExport(readFileSync(chatPath, "utf8"));
// "Without media" export + photos downloaded from WhatsApp Web sitting in the same folder
const siblings = readdirSync(dirname(chatPath));
entries = matchOmittedToDownloads(entries, siblings);
const unmatched = entries.filter((e) => !e.filename).length;
if (unmatched) console.warn(`${unmatched} image messages have no matching file (download them from the group's Media panel into ${dirname(chatPath)})`);
const batches = suggestBatches(entries);
const manifest = entries.flatMap((e) => {
  if (!e.filename) return [];
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
