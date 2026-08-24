/**
 * Per-run cost display used everywhere a generation's spend appears —
 * admin runs table now, output cards in later phases. Sub-cent costs get
 * four decimals so cheap runs don't all read as "$0.00".
 */
export function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function CostBadge({ usd }: { usd: number }) {
  return (
    <span className="type-utility inline-flex items-center rounded-full border border-border-subtle px-2 py-0.5 text-text-secondary">
      {formatUsd(usd)}
    </span>
  );
}
