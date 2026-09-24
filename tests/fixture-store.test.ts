import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FixtureStore } from "@/lib/fixtures/store";
import { emptyLabel, finalizeLabel } from "@/lib/fixtures/label";

let root: string;
let store: FixtureStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "p2c-"));
  mkdirSync(join(root, "images"));
  for (const f of ["a.jpeg", "b.jpeg", "c.jpeg", "loose.png"]) writeFileSync(join(root, "images", f), "x");
  writeFileSync(join(root, "images", "manifest.json"), JSON.stringify([
    { file: "c.jpeg", sender: "Shaista", capturedAt: "2026-09-01T10:00:00", caption: "sudni", batch: "k1" },
    { file: "a.jpeg", sender: "Shaista", capturedAt: "2026-09-01T10:01:00", caption: null, batch: "k1" },
    { file: "b.jpeg", sender: null, capturedAt: "2026-08-10T09:00:00", caption: null, batch: "k2" },
  ]));
  store = new FixtureStore(root);
});

describe("FixtureStore", () => {
  it("lists in chat order with manifest metadata, loose files last", () => {
    expect(store.list().map((i) => [i.image, i.sender, i.status])).toEqual([
      ["c.jpeg", "Shaista", "unlabeled"], ["a.jpeg", "Shaista", "unlabeled"], ["b.jpeg", null, "unlabeled"], ["loose.png", null, "unlabeled"],
    ]);
  });

  it("a two-page label marks its second page, labels win over drafts", () => {
    store.writeDraft(emptyLabel("c.jpeg", ["c.jpeg"]));
    expect(store.list()[0]!.status).toBe("draft");
    store.writeLabel(finalizeLabel(emptyLabel("c.jpeg", ["c.jpeg", "a.jpeg"]), "2026-09-24T00:00:00Z"));
    const items = store.list();
    expect(items[0]!.status).toBe("labeled");
    expect(items[1]!.pageOf).toBe("c.jpeg");
    expect(store.labeled()).toHaveLength(1);
    expect(existsSync(join(root, "labels", "c.jpeg.json"))).toBe(true);
  });

  it("refuses unknown images and path tricks", () => {
    expect(() => store.imagePath("../images/a.jpeg")).toThrow();
    expect(() => store.imagePath("manifest.json")).toThrow();
    expect(() => store.writeLabel(emptyLabel("nope.jpeg", ["nope.jpeg"]))).toThrow(/unknown image/);
  });
});
