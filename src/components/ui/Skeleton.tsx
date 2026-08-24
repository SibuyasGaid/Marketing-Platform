/** Shimmer placeholder matching real layout (docs/DESIGN.md §3). */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse-dot rounded-xl bg-bg-hover ${className}`}
      aria-hidden
    />
  );
}

/** Full-page loading state reused by route-level loading.tsx files. */
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-label="Loading" role="status">
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
