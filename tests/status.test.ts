import { describe, expect, it } from "vitest";
import { canTransition, assertTransition, shouldAutoApprove, DOC_STATUSES, IllegalTransition } from "@/lib/contracts/status";

describe("state machine", () => {
  it("follows the happy path", () => {
    expect(canTransition("received", "extracting", "system")).toBe(true);
    expect(canTransition("extracting", "extracted", "system")).toBe(true);
    expect(canTransition("extracted", "needs_confirmation", "system")).toBe(true);
    expect(canTransition("needs_confirmation", "confirmed", "uploader")).toBe(true);
    expect(canTransition("confirmed", "approved", "system")).toBe(true);
    expect(canTransition("approved", "staged", "system")).toBe(true);
    expect(canTransition("staged", "pushed", "system")).toBe(true);
  });
  it("uploaders cannot approve, void, or touch pushed docs", () => {
    expect(canTransition("confirmed", "approved", "uploader")).toBe(false);
    expect(canTransition("needs_confirmation", "void", "uploader")).toBe(false);
    for (const s of DOC_STATUSES) expect(canTransition("pushed", s, "owner")).toBe(false);
  });
  it("void is reachable from every non-terminal state except staged, by owner only", () => {
    for (const s of DOC_STATUSES) {
      const expected = !["pushed", "void", "staged", "failed"].includes(s);
      expect(canTransition(s, "void", "owner"), s).toBe(expected);
      expect(canTransition(s, "void", "system")).toBe(false);
    }
  });
  it("QB failure routes to attention and can be retried by owner", () => {
    expect(canTransition("staged", "failed", "system")).toBe(true);
    expect(canTransition("failed", "needs_attention", "system")).toBe(true);
    expect(canTransition("failed", "staged", "owner")).toBe(true);
  });
  it("assertTransition throws", () => {
    expect(() => assertTransition("received", "pushed", "system")).toThrow(IllegalTransition);
  });
});

describe("shouldAutoApprove (SPEC §11)", () => {
  const ok = { autoPushEnabled: true, minConfidence: 0.9, overallConfidence: 0.95, allLowConfidenceFieldsEdited: false, vendorHasQbListId: true, openExceptionCount: 0, applicationsBalanced: true };
  it("approves the clean case", () => expect(shouldAutoApprove(ok)).toBe(true));
  it("never when the flag is off", () => expect(shouldAutoApprove({ ...ok, autoPushEnabled: false })).toBe(false));
  it("low confidence passes only if the uploader edited every low field", () => {
    expect(shouldAutoApprove({ ...ok, overallConfidence: 0.6 })).toBe(false);
    expect(shouldAutoApprove({ ...ok, overallConfidence: 0.6, allLowConfidenceFieldsEdited: true })).toBe(true);
  });
  it("blocks on new vendor, open exceptions, unbalanced checks", () => {
    expect(shouldAutoApprove({ ...ok, vendorHasQbListId: false })).toBe(false);
    expect(shouldAutoApprove({ ...ok, openExceptionCount: 1 })).toBe(false);
    expect(shouldAutoApprove({ ...ok, applicationsBalanced: false })).toBe(false);
  });
});
