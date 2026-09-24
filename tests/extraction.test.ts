import { describe, expect, it } from "vitest";
import { anthropicProvider, extractJson, ExtractionRefused } from "@/lib/extraction/providers/anthropic";
import { costUsd } from "@/lib/extraction/providers/pricing";
import { mockProvider, DEFAULT_CLASSIFY, DEFAULT_INVOICE } from "@/lib/extraction/providers/mock";
import { extractDocument, redactMicr, type Prompts } from "@/lib/extraction/extract";
import { loadPrompts } from "@/lib/extraction/prompts";
import { InvoicePayloadSchema } from "@/lib/contracts/extraction";

const PROMPTS: Prompts = { version: "t", classify: "CLASSIFY", invoice: "INVOICE", check: "CHECK", statement: "STATEMENT", recordOnly: "RECORD" };
const IMG = [{ url: "data:image/jpeg;base64,AAAA", pageNo: 1 }];

function fakeClient(reply: Record<string, unknown>) {
  const calls: any[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: any) => {
          calls.push(params);
          return {
            model: "claude-opus-5",
            stop_reason: "end_turn",
            stop_details: null,
            usage: { input_tokens: 2000, output_tokens: 400 },
            content: [{ type: "text", text: "Here you go:\n```json\n{\"a\": \"}\", \"b\": [1]}\n```" }],
            ...reply,
          };
        },
      },
    },
  };
  return { client: client as any, calls };
}

describe("anthropic provider", () => {
  it("sends base64 image blocks and returns only the JSON, with cost", async () => {
    const { client, calls } = fakeClient({});
    const p = anthropicProvider({ apiKey: "x", model: "claude-opus-5", client });
    const r = await p.call({ system: "S", user: "U", images: IMG, jsonSchema: {} });
    expect(JSON.parse(r.text)).toEqual({ a: "}", b: [1] });
    expect(r.costUsd).toBe(0.02); // 2000×$5/M + 400×$25/M
    expect(calls[0].messages[0].content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } });
    expect(calls[0].system).toBe("S");
  });

  it("fetches signed URLs server-side", async () => {
    const { client, calls } = fakeClient({});
    const fetchImpl = (async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } })) as typeof fetch;
    const p = anthropicProvider({ apiKey: "x", model: "claude-opus-5", client, fetchImpl });
    await p.call({ system: "S", user: "U", images: [{ url: "https://x/signed?token=1", pageNo: 1 }], jsonSchema: {} });
    expect(calls[0].messages[0].content[0].source).toEqual({ type: "base64", media_type: "image/png", data: "AQID" });
  });

  it("raises on refusal", async () => {
    const { client } = fakeClient({ stop_reason: "refusal", stop_details: { category: "cyber" } });
    const p = anthropicProvider({ apiKey: "x", model: "claude-opus-5", client });
    await expect(p.call({ system: "S", user: "U", images: IMG, jsonSchema: {} })).rejects.toBeInstanceOf(ExtractionRefused);
  });

  it("extractJson handles arrays and rejects prose", () => {
    expect(extractJson('[{"x":"]"}] trailing')).toBe('[{"x":"]"}]');
    expect(() => extractJson("no json here")).toThrow();
  });

  it("unknown model → null cost", () => {
    expect(costUsd("some-other-model", { input_tokens: 1, output_tokens: 1 })).toBeNull();
  });
});

describe("extractDocument", () => {
  it("mock default invoice satisfies the contract", () => {
    expect(InvoicePayloadSchema.safeParse(DEFAULT_INVOICE).success).toBe(true);
  });

  it("composite photo: invoice with a check on top yields a check companion", async () => {
    const check = [{
      check_number: { value: "1047", confidence: 0.95 }, payee: { value: "Ever Kool", confidence: 0.9 },
      amount_numeric: { value: 460, confidence: 0.95 }, amount_written: { value: "Four hundred sixty and 00/100", confidence: 0.9 },
      date: { value: "2026-09-10", confidence: 0.9 }, memo: { value: "inv 3301", confidence: 0.8 },
      memo_invoice_numbers: ["3301"], signed: true, issues: [],
    }];
    const provider = {
      name: "fake",
      call: async ({ system }: { system: string }) => ({
        text: JSON.stringify(system === "CLASSIFY" ? { ...DEFAULT_CLASSIFY, also_contains: ["check"] } : system === "CHECK" ? check : DEFAULT_INVOICE),
        latencyMs: 1, costUsd: 0.01, model: "fake",
      }),
    };
    const r = await extractDocument(provider, PROMPTS, IMG, "invoice");
    expect(r.resolvedDocType).toBe("invoice");
    expect(r.companions).toHaveLength(1);
    expect(r.companions[0]!.docType).toBe("check");
    expect(r.costUsd).toBeCloseTo(0.03);
  });

  it("statement companion is parsed with the statement schema", async () => {
    const statement = {
      vendor_name_printed: { value: "SUDNI FOODS", confidence: 0.9 }, customer_name_printed: { value: null, confidence: 0 },
      statement_date: { value: "2026-09-01", confidence: 0.9 }, rows: [], total_balance: { value: 11386.36, confidence: 0.9 },
      handwritten_groups: [], handwritten_notes: [], issues: [],
    };
    const provider = {
      name: "fake",
      call: async ({ system }: { system: string }) => ({
        text: JSON.stringify(system === "CLASSIFY" ? { ...DEFAULT_CLASSIFY, also_contains: ["statement"] } : system === "STATEMENT" ? statement : DEFAULT_INVOICE),
        latencyMs: 1, costUsd: 0, model: "fake",
      }),
    };
    const r = await extractDocument(provider, PROMPTS, IMG, "invoice");
    expect(r.companions[0]!.payload).toMatchObject({ total_balance: { value: 11386.36 } });
  });

  it("works end to end with the mock provider and the v1 prompt files", async () => {
    const prompts = loadPrompts("v1", "src/lib/extraction/prompts");
    const r = await extractDocument(mockProvider({}), prompts, IMG, "invoice");
    expect(r.promptVersion).toBe("v1");
  });
});

describe("MICR redaction (SPEC §12)", () => {
  it("redacts MICR symbols and long digit runs, keeps invoice numbers", () => {
    expect(redactMicr("⑆121000358⑆ 0123456789⑈")).toBe("[redacted]");
    expect(redactMicr("acct 121000358 0123456789")).toBe("acct [redacted]");
    expect(redactMicr("inv 653279, 653301")).toBe("inv 653279, 653301");
    expect(redactMicr("inv 123456789")).toBe("inv 123456789");
  });
});
