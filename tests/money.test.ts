import { describe, expect, it } from "vitest";
import { toCents, fromCents, formatUSD, parseWrittenAmount, sumCents } from "@/lib/contracts/money";

describe("money", () => {
  it("converts decimals and strings to cents without float drift", () => {
    expect(toCents(842.1)).toBe(84210);
    expect(toCents("1,264.50")).toBe(126450);
    expect(toCents("$0.29")).toBe(29);
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(null)).toBeNull();
    expect(toCents("abc")).toBeNull();
  });
  it("formats", () => {
    expect(fromCents(84210)).toBe("842.10");
    expect(fromCents(5)).toBe("0.05");
    expect(formatUSD(126450)).toBe("$1,264.50");
    expect(formatUSD(-300)).toBe("-$3.00");
  });
  it("sums", () => {
    expect(sumCents([1, 2, 3])).toBe(6);
  });
  it("parses written check amounts", () => {
    expect(parseWrittenAmount("One thousand two hundred sixty-four and 50/100")).toBe(126450);
    expect(parseWrittenAmount("Eight hundred forty-two and 10/100 dollars")).toBe(84210);
    expect(parseWrittenAmount("Three hundred and no/100")).toBe(30000);
    expect(parseWrittenAmount("Twelve thousand five hundred and xx/100")).toBe(1250000);
    expect(parseWrittenAmount("Two million and 00/100")).toBe(200000000);
    expect(parseWrittenAmount("Forty dollars only")).toBe(4000);
    expect(parseWrittenAmount("gibberish 50/100")).toBeNull();
    expect(parseWrittenAmount(null)).toBeNull();
  });
});
