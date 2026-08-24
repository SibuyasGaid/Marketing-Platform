/**
 * Indeterminate progress bar. Our generation providers (Gemini, HeyGen) don't
 * report a percentage, so this shows continuous motion to signal "still working,
 * not stuck" — used across every long-running generation (images, avatar videos,
 * visual clips). Pass `className` to set the track width/background for its
 * context (default: a 40-unit bar on the base surface).
 */
export function ProgressBar({ className }: { className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label="Generating"
      className={`h-1.5 overflow-hidden rounded-full ${className ?? "w-40 bg-bg-base"}`}
    >
      <div className="h-full w-1/2 animate-progress-indeterminate rounded-full bg-primary" />
    </div>
  );
}
