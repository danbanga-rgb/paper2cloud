import { describe, expect, it } from "vitest";
import { parseWhatsAppExport, suggestBatches } from "@/lib/ingest/whatsapp-export";

const ios = `[9/12/26, 3:41:07 PM] Maria: ‎<attached: 00000123-PHOTO-2026-09-12-15-41-07.jpg>
[9/12/26, 3:41:20 PM] Maria: ‎<attached: 00000124-PHOTO-2026-09-12-15-41-20.jpg>
page 2
[9/12/26, 3:50:00 PM] Jose: paid pepsi today
[9/12/26, 3:51:02 PM] Jose: ‎<attached: 00000125-PHOTO-2026-09-12-15-51-02.jpg>
[9/13/26, 9:02:11 AM] Maria: ‎<attached: 00000126-PHOTO-2026-09-13-09-02-11.jpg>`;

const android = `9/12/26, 3:41 PM - Maria: IMG-20260912-WA0012.jpg (file attached)
9/12/26, 12:05 AM - Jose: IMG-20260912-WA0013.jpg (file attached)
sysco invoice`;

describe("parseWhatsAppExport", () => {
  it("parses iOS format with captions and 12h times", () => {
    const e = parseWhatsAppExport(ios);
    expect(e).toHaveLength(4);
    expect(e[0]).toMatchObject({ sender: "Maria", capturedAt: "2026-09-12T15:41:07", filename: "00000123-PHOTO-2026-09-12-15-41-07.jpg", caption: null, line: 1 });
    expect(e[1]!.caption).toBe("page 2");
    expect(e[2]!.sender).toBe("Jose");
    expect(e[3]!.capturedAt).toBe("2026-09-13T09:02:11");
  });
  it("parses Android format and midnight", () => {
    const e = parseWhatsAppExport(android);
    expect(e).toHaveLength(2);
    expect(e[0]!.filename).toBe("IMG-20260912-WA0012.jpg");
    expect(e[1]!.capturedAt).toBe("2026-09-12T00:05:00");
    expect(e[1]!.caption).toBe("sysco invoice");
  });
  it("suggests batches by sender + 90s window", () => {
    const e = parseWhatsAppExport(ios);
    const b = suggestBatches(e);
    expect(b.get(1)).toBe(b.get(2));
    expect(b.get(2)).not.toBe(b.get(5));
    expect(b.get(5)).not.toBe(b.get(6));
  });
});

import { matchOmittedToDownloads } from "@/lib/ingest/whatsapp-export";

const withoutMedia = `Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.
[8/17/26, 12:08:01 PM] Shaista: <image omitted>
[8/17/26, 12:14:53 PM] Shaista: Hello Boss today I am writing two checks
[8/17/26, 12:15:01 PM] Shaista: <image omitted>
[8/17/26, 12:15:15 PM] Asheesh Banga: Ok
[8/22/26, 11:01:04 AM] Shaista: <image omitted>
[8/22/26, 11:01:31 AM] Shaista: <image omitted>`;

describe("without-media exports + WhatsApp Web downloads", () => {
  it("parses <image omitted> lines with filename null and ignores the encryption banner", () => {
    const e = parseWhatsAppExport(withoutMedia);
    expect(e).toHaveLength(4);
    expect(e[0]).toMatchObject({ sender: "Shaista", capturedAt: "2026-08-17T12:08:01", filename: null, line: 2 });
    expect(e[1]!.capturedAt).toBe("2026-08-17T12:15:01");
  });
  it("matches downloaded files by timestamp, closest wins, each file used once", () => {
    const e = parseWhatsAppExport(withoutMedia);
    const files = [
      "WhatsApp Image 2026-08-17 at 12.08.02 PM.jpeg",
      "WhatsApp Image 2026-08-17 at 12.15.01 PM.jpeg",
      "WhatsApp Image 2026-08-22 at 11.01.04 AM.jpeg",
      "WhatsApp Image 2026-08-22 at 11.01.04 AM (1).jpeg", // second photo same second → falls within tolerance of 11:01:31? no (27s)
      "IMG_0001.jpeg", // unmatchable name
    ];
    const m = matchOmittedToDownloads(e, files);
    expect(m[0]!.filename).toBe("WhatsApp Image 2026-08-17 at 12.08.02 PM.jpeg");
    expect(m[1]!.filename).toBe("WhatsApp Image 2026-08-17 at 12.15.01 PM.jpeg");
    expect(m[2]!.filename).toBe("WhatsApp Image 2026-08-22 at 11.01.04 AM.jpeg");
    expect(m[3]!.filename).toBeNull(); // 11:01:31 has no file within 3s
  });
});
