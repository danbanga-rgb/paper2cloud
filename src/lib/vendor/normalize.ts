/**
 * SPEC §7 step 1 — vendor name normalization (CONTRACT).
 * Pure. The same function must be used when writing aliases and when looking them up.
 */

const LEGAL_SUFFIXES = new Set([
  "INC", "INCORPORATED", "LLC", "L.L.C", "LTD", "LIMITED", "CO", "COMPANY", "CORP",
  "CORPORATION", "LP", "LLP", "PLC", "DBA", "USA", "US",
]);

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME",
  "MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA",
  "RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
]);

export interface NormalizeOptions {
  /** Tokens from the vendor address (city, state) to strip if they appear in the name. */
  addressTokens?: string[];
}

export function normalizeVendorName(raw: string | null | undefined, opts: NormalizeOptions = {}): string {
  if (!raw) return "";
  let s = raw.toUpperCase();
  s = s.replace(/&/g, " AND ");
  s = s.replace(/[^A-Z0-9 ]+/g, " "); // punctuation → space
  let tokens = s.split(/\s+/).filter(Boolean);

  const addr = new Set((opts.addressTokens ?? []).map((t) => t.toUpperCase().replace(/[^A-Z0-9]/g, "")));

  tokens = tokens.filter((t, i) => {
    if (LEGAL_SUFFIXES.has(t)) return false;
    if (addr.has(t)) return false;
    // A trailing state code is address noise ("SYSCO SAN FRANCISCO CA"); a leading one is not.
    if (i > 0 && US_STATES.has(t) && i === tokens.length - 1) return false;
    return true;
  });

  // Drop a trailing bare number that looks like a location/branch id ("SYSCO 042")
  if (tokens.length > 1 && /^\d{1,4}$/.test(tokens[tokens.length - 1]!)) tokens.pop();

  return tokens.join(" ").trim();
}

/** Tokens worth stripping, derived from a printed address line. */
export function addressTokensFrom(address: string | null | undefined): string[] {
  if (!address) return [];
  return address
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t)); // keep city words, drop street numbers/zips
}
