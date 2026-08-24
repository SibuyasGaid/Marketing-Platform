import { InvalidTransitionError } from "@/lib/errors";
import type { ContentStatus } from "@/lib/domain";

/**
 * Explicit content lifecycle state machine (docs/CODING_STANDARDS.md §3).
 * Every status write in the app must pass through assertTransition —
 * no ad-hoc `status = "posted"` anywhere.
 *
 * draft → pending_approval → approved → publishing → posted | failed
 * draft → failed (generation never produced an asset, e.g. HeyGen timed out)
 * approved → scheduled → publishing (cron, when due) → posted | failed
 * scheduled → pending_approval (schedule cancelled) ; scheduled → failed
 * pending_approval → edits_requested → regenerating → pending_approval
 * publishing → failed; regenerating → failed (generation errors)
 * failed → pending_approval (manual retry after a failed publish/regeneration)
 */
const TRANSITIONS: Record<ContentStatus, readonly ContentStatus[]> = {
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

export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ContentStatus, to: ContentStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function legalNextStatuses(from: ContentStatus): readonly ContentStatus[] {
  return TRANSITIONS[from];
}
