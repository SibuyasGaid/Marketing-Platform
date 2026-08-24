import type { ContentStatus } from "@/lib/domain";

/**
 * The single source of truth for status pill treatments (docs/DESIGN.md §3).
 * Imported only by StatusPill — status colors never appear ad-hoc elsewhere.
 */
export interface StatusStyle {
  label: string;
  /** Tailwind classes for the pill container (tokens only, no hex). */
  pillClass: string;
  dot?: "pulse" | "spinner";
  icon?: "check" | "comment";
}

export const statusStyles: Record<ContentStatus, StatusStyle> = {
  draft: {
    label: "Draft",
    pillClass: "border border-text-faint text-text-faint",
  },
  pending_approval: {
    label: "Pending approval",
    pillClass: "bg-warning/12 text-warning",
    dot: "pulse",
  },
  approved: {
    label: "Approved",
    pillClass: "bg-primary-soft/12 text-primary-soft",
  },
  scheduled: {
    label: "Scheduled",
    pillClass: "bg-info/12 text-info",
    icon: "check",
  },
  publishing: {
    label: "Publishing",
    pillClass: "bg-info/12 text-info",
    dot: "spinner",
  },
  posted: {
    label: "Posted",
    pillClass: "bg-success/12 text-success",
    icon: "check",
  },
  edits_requested: {
    label: "Edits requested",
    pillClass: "border border-warning text-warning",
    icon: "comment",
  },
  regenerating: {
    label: "Regenerating",
    pillClass: "border border-info text-info",
    dot: "spinner",
  },
  failed: {
    label: "Failed",
    pillClass: "bg-danger/12 text-danger",
  },
};
