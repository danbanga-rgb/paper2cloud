/**
 * Phase 0 fixture store on the local filesystem (used by the /label helper and the scorer).
 *   fixtures/images/            photos + manifest.json from `npm run import:whatsapp` (git-ignored)
 *   fixtures/drafts/<img>.json  the model's untouched draft, kept so scoring history can be audited
 *   fixtures/labels/<img>.json  owner-reviewed ground truth (committed)
 * Every image name is validated so nothing outside these folders can be read or written.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { LabelFileSchema, assertNoBankNumbers, labelFileName, type LabelFile } from "./label";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic"]);

export interface FixtureItem {
  image: string;
  sender: string | null;
  capturedAt: string | null;
  caption: string | null;
  /** suggested batch from the importer (consecutive photos by the same sender) */
  batch: string | null;
  status: "unlabeled" | "draft" | "labeled" | "skipped";
  /** set when this image is a later page of another image's label */
  pageOf: string | null;
}

interface ManifestEntry { file: string; sender?: string; capturedAt?: string; caption?: string | null; batch?: string }

export class FixtureStore {
  constructor(private readonly root = "fixtures") {}

  get imagesDir() { return join(this.root, "images"); }
  get labelsDir() { return join(this.root, "labels"); }
  get draftsDir() { return join(this.root, "drafts"); }

  list(): FixtureItem[] {
    const manifest = this.manifest();
    const files = existsSync(this.imagesDir)
      ? readdirSync(this.imagesDir).filter((f) => IMAGE_EXT.has(extname(f).toLowerCase())).sort()
      : [];
    const byFile = new Map(manifest.map((m) => [m.file, m]));
    // manifest order is chat order; files the manifest doesn't know go last
    const ordered = [...manifest.map((m) => m.file).filter((f) => files.includes(f)), ...files.filter((f) => !byFile.has(f))];

    const labels = new Map<string, LabelFile>();
    for (const f of ordered) {
      const l = this.readLabel(f) ?? this.readDraft(f);
      if (l) labels.set(f, l);
    }
    const pageOf = new Map<string, string>();
    for (const [img, l] of labels) for (const p of l.pages.slice(1)) pageOf.set(p, img);

    return ordered.map((image) => {
      const m = byFile.get(image);
      const l = labels.get(image);
      const status: FixtureItem["status"] = !l ? "unlabeled" : l.status;
      return {
        image,
        sender: m?.sender ?? null,
        capturedAt: m?.capturedAt ?? null,
        caption: m?.caption ?? null,
        batch: m?.batch ?? null,
        status,
        pageOf: pageOf.get(image) ?? null,
      };
    });
  }

  imagePath(image: string): string {
    this.assertKnownImage(image);
    return join(this.imagesDir, image);
  }

  readLabel(image: string): LabelFile | null {
    return this.readJson(join(this.labelsDir, labelFileName(image)));
  }

  readDraft(image: string): LabelFile | null {
    return this.readJson(join(this.draftsDir, labelFileName(image)));
  }

  writeDraft(label: LabelFile): void {
    this.write(this.draftsDir, label);
  }

  writeLabel(label: LabelFile): void {
    this.write(this.labelsDir, label);
  }

  /** Every label that is owner-reviewed (the scorer's input). */
  labeled(): LabelFile[] {
    if (!existsSync(this.labelsDir)) return [];
    return readdirSync(this.labelsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => LabelFileSchema.parse(JSON.parse(readFileSync(join(this.labelsDir, f), "utf8"))))
      .filter((l) => l.status === "labeled");
  }

  private write(dir: string, label: LabelFile): void {
    const parsed = LabelFileSchema.parse(label);
    for (const p of parsed.pages) this.assertKnownImage(p);
    assertNoBankNumbers(parsed);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, labelFileName(parsed.image)), JSON.stringify(parsed, null, 2) + "\n");
  }

  private readJson(path: string): LabelFile | null {
    if (!existsSync(path)) return null;
    return LabelFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  }

  private assertKnownImage(image: string): void {
    labelFileName(image); // rejects path separators
    if (!IMAGE_EXT.has(extname(image).toLowerCase()) || !existsSync(join(this.imagesDir, image))) {
      throw new Error(`unknown image ${image}`);
    }
  }

  private manifest(): ManifestEntry[] {
    const p = join(this.imagesDir, "manifest.json");
    if (!existsSync(p)) return [];
    return (JSON.parse(readFileSync(p, "utf8")) as ManifestEntry[]).filter((m) => typeof m.file === "string");
  }
}

export function imageContentType(image: string): string {
  const ext = extname(image).toLowerCase();
  return ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".heic" ? "image/heic" : "image/jpeg";
}
