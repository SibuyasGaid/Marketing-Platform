import { describe, expect, it } from "vitest";
import { CONTENT_STATUSES, type ContentStatus } from "@/lib/domain";
import { InvalidTransitionError } from "@/lib/errors";
import { assertTransition, canTransition, legalNextStatuses } from "@/lib/statusMachine";

/**
 * Exhaustive transition tests (docs/CODING_STANDARDS.md §6): every legal and
 * illegal (from, to) pair is asserted.
 */
const LEGAL: Record<ContentStatus, readonly ContentStatus[]> = {
  draft: ["pending_approval", "failed"],
  pending_approval: ["approved", "edits_requested"],
  approved: ["publishing", "scheduled"],
  scheduled: ["publishing", "pending_approval", "failed"],
  publishing: ["posted", "failed"],
  posted: [],
  edits_requested: ["regenerating"],
  regenerating: ["pending_approval", "failed"],
  failed: ["pending_approval"],
};

describe("statusMachine", () => {
  it("covers every status in the legal map", () => {
    expect(Object.keys(LEGAL).sort()).toEqual([...CONTENT_STATUSES].sort());
  });

  for (const from of CONTENT_STATUSES) {
    for (const to of CONTENT_STATUSES) {
      const isLegal = LEGAL[from].includes(to);
      it(`${from} → ${to} is ${isLegal ? "legal" : "illegal"}`, () => {
        expect(canTransition(from, to)).toBe(isLegal);
        if (isLegal) {
          expect(() => assertTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
        }
      });
    }
  }

  it("posted is terminal", () => {
    expect(legalNextStatuses("posted")).toEqual([]);
  });

  it("approval requires pending_approval — draft can never jump to approved or publishing", () => {
    expect(canTransition("draft", "approved")).toBe(false);
    expect(canTransition("draft", "publishing")).toBe(false);
    expect(canTransition("draft", "posted")).toBe(false);
  });
});
