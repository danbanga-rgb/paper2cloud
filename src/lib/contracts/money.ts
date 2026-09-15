/**
 * Money is integer cents everywhere in TypeScript. Convert only at boundaries:
 * model output (decimal number) → cents; Postgres numeric (string) → cents; cents → display.
 */

export type Cents = number & { readonly __brand: "Cents" };

export function toCents(decimal: number | string | null | undefined): Cents | null {
  if (decimal === null || decimal === undefined || decimal === "") return null;
  const n = typeof decimal === "string" ? Number(decimal.replace(/[$,\s]/g, "")) : decimal;
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) as Cents;
}

export function cents(n: number): Cents {
  if (!Number.isInteger(n)) throw new Error(`cents() requires an integer, got ${n}`);
  return n as Cents;
}

export function fromCents(c: Cents | number): string {
  const sign = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function formatUSD(c: Cents | number): string {
  const sign = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

export function sumCents(values: readonly (Cents | number)[]): Cents {
  return values.reduce<number>((a, b) => a + b, 0) as Cents;
}

/** Amounts written out on checks: "One thousand two hundred sixty-four and 50/100" → cents. */
export function parseWrittenAmount(text: string | null | undefined): Cents | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/[-,]/g, " ").replace(/\s+/g, " ").trim();
  const m = t.match(/^(.*?)(?:\s+and)?\s+(\d{1,2})\s*\/\s*100/);
  const dollarsText = m ? m[1]! : t.replace(/\s+(and\s+)?(no|xx)\s*\/\s*100.*$/, "");
  const centsPart = m ? Number(m[2]) : 0;
  const dollars = wordsToNumber(dollarsText);
  if (dollars === null) return null;
  return (dollars * 100 + centsPart) as Cents;
}

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fourty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALE: Record<string, number> = { hundred: 100, thousand: 1_000, million: 1_000_000 };

function wordsToNumber(text: string): number | null {
  const words = text.replace(/\bdollars?\b/g, "").split(" ").filter(Boolean);
  if (words.length === 0) return null;
  let total = 0;
  let current = 0;
  for (const w of words) {
    if (w in SMALL) current += SMALL[w]!;
    else if (w === "hundred") current = (current || 1) * 100;
    else if (w in SCALE) {
      total += (current || 1) * SCALE[w]!;
      current = 0;
    } else if (w === "and" || w === "only") continue;
    else return null; // unknown token → can't trust it
  }
  return total + current;
}
