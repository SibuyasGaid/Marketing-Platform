import type { ContentStatus } from "@/lib/domain";
import { statusStyles } from "@/components/ui/statusStyles";

/**
 * The one status pill used everywhere a status appears — queue, cards,
 * detail views, admin (docs/DESIGN.md §3).
 */
export function StatusPill({ status }: { status: ContentStatus }) {
  const style = statusStyles[status];

  return (
    <span
      className={`type-utility inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${style.pillClass}`}
    >
      {style.dot === "pulse" ? (
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-current" />
      ) : null}
      {style.dot === "spinner" ? (
        <span
          aria-hidden
          className="h-2 w-2 animate-spinner-dot rounded-full border border-current border-t-transparent"
        />
      ) : null}
      {style.icon === "check" ? (
        <svg aria-hidden viewBox="0 0 12 12" className="h-2.5 w-2.5 fill-none stroke-current stroke-2">
          <path d="M2 6.5 4.5 9 10 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
      {style.icon === "comment" ? (
        <svg aria-hidden viewBox="0 0 12 12" className="h-2.5 w-2.5 fill-none stroke-current stroke-2">
          <path
            d="M1.5 2.5h9v6h-5l-2.5 2v-2h-1.5z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      {style.label}
    </span>
  );
}
