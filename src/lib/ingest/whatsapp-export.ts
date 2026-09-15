/**
 * Phase 0 — parse a WhatsApp "Export chat (with media)" text file into image references.
 * Pure: takes the chat text, returns entries. The script in scripts/ does the file moves.
 *
 * iOS export lines look like:
 *   [9/12/26, 3:41:07 PM] Maria: ‎<attached: 00000123-PHOTO-2026-09-12-15-41-07.jpg>
 * Android export lines look like:
 *   9/12/26, 3:41 PM - Maria: IMG-20260912-WA0012.jpg (file attached)
 * Both may carry invisible LRM/RLM marks (‎, ‏). Multi-line messages continue without a prefix.
 */

export interface ExportEntry {
  sender: string;
  /** ISO timestamp, local time of the exporting phone (no zone info in the file). */
  capturedAt: string;
  filename: string;
  /** free text on the same message (caption), if any */
  caption: string | null;
  /** 1-based line number in the export, for original_message_ref */
  line: number;
}

const IOS = /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?\]\s+([^:]+?):\s+(.*)$/i;
const ANDROID = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s+(\d{1,2}):(\d{2})\s*([AP]M)?\s+-\s+([^:]+?):\s+(.*)$/i;
const ATTACHED_IOS = /<attached:\s*([^>]+)>/i;
const ATTACHED_ANDROID = /([\w.-]+\.(?:jpe?g|png|heic|pdf))\s*\(file attached\)/i;

export function parseWhatsAppExport(text: string): ExportEntry[] {
  const out: ExportEntry[] = [];
  const lines = text.split(/\r?\n/);
  let last: ExportEntry | null = null;

  lines.forEach((rawLine, idx) => {
    const line = rawLine.replace(/[‎‏]/g, "").trim();
    if (!line) return;

    let m = IOS.exec(line);
    let sender: string, body: string, ts: string;
    if (m) {
      ts = toIso(m[3]!, m[1]!, m[2]!, m[4]!, m[5]!, m[6] ?? "00", m[7]);
      sender = m[8]!.trim();
      body = m[9]!;
    } else if ((m = ANDROID.exec(line))) {
      ts = toIso(m[3]!, m[1]!, m[2]!, m[4]!, m[5]!, "00", m[6]);
      sender = m[7]!.trim();
      body = m[8]!;
    } else {
      // continuation line → caption of the previous attachment
      if (last) last.caption = (last.caption ? last.caption + "\n" : "") + line;
      return;
    }

    const att = ATTACHED_IOS.exec(body) ?? ATTACHED_ANDROID.exec(body);
    if (!att) {
      last = null; // a text message; don't attach later lines to an old image
      return;
    }
    const filename = att[1]!.trim();
    const caption = body.replace(att[0], "").trim() || null;
    last = { sender, capturedAt: ts, filename, caption, line: idx + 1 };
    out.push(last);
  });
  return out;
}

function toIso(y: string, mo: string, d: string, h: string, mi: string, s: string, ampm?: string): string {
  let hour = Number(h);
  if (ampm) {
    const pm = ampm.toUpperCase() === "PM";
    if (pm && hour < 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  }
  const year = y.length === 2 ? `20${y}` : y;
  const pad = (n: string | number) => String(n).padStart(2, "0");
  return `${year}-${pad(mo)}-${pad(d)}T${pad(hour)}:${pad(mi)}:${pad(s)}`;
}

/**
 * Group consecutive images from the same sender within `windowSec` into a batch key — a hint for
 * the labeler that they may be pages of one document. The labeler decides; this only suggests.
 */
export function suggestBatches(entries: ExportEntry[], windowSec = 90): Map<number, string> {
  const keys = new Map<number, string>();
  let prev: ExportEntry | null = null;
  let key = "";
  for (const e of entries) {
    const t = Date.parse(e.capturedAt);
    const near = prev && prev.sender === e.sender && t - Date.parse(prev.capturedAt) <= windowSec * 1000;
    if (!near) key = `${e.sender}-${e.capturedAt}`;
    keys.set(e.line, key);
    prev = e;
  }
  return keys;
}
