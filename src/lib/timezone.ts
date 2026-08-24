/**
 * The business operates in Sydney, so every scheduled publish time is entered,
 * stored, and shown in Australia/Sydney regardless of where the server (UTC on
 * Vercel) or the reviewer's browser happens to be. Stored values are always UTC
 * ISO strings; conversion to/from Sydney wall-clock time lives here.
 */
export const APP_TIME_ZONE = "Australia/Sydney";

/** Sydney's UTC offset in minutes for a given instant (handles AEST/AEDT DST). */
function sydneyOffsetMinutes(at: Date): number {
  // Format the instant as Sydney wall-clock, read it back as if it were UTC,
  // and the difference is the offset. Robust across daylight-saving changes.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  let hour = get("hour");
  if (hour === 24) hour = 0; // Intl may emit "24" for midnight.
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - at.getTime()) / 60000);
}

/**
 * Converts a `datetime-local` value (Sydney wall-clock, e.g. "2026-07-29T09:00")
 * into the matching UTC instant (ISO string). Returns null if unparseable.
 */
export function sydneyLocalToUtcIso(localValue: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(localValue);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  // Guess the instant as if the wall-clock were UTC, then correct by Sydney's
  // offset at that instant. A DST-boundary error is at most an hour and self-
  // corrects to the nearest valid instant, which is acceptable for scheduling.
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offsetMin = sydneyOffsetMinutes(new Date(guess));
  return new Date(guess - offsetMin * 60000).toISOString();
}

/** Current time as a Sydney `datetime-local` string (for an input `min`/value). */
export function nowSydneyLocal(): string {
  return utcIsoToSydneyLocal(new Date().toISOString());
}

/**
 * The Sydney calendar date ("YYYY-MM-DD") of a UTC instant. Used so a scheduled
 * item lands in the correct day column — the board buckets by this date, and it
 * must be the Sydney day, not the UTC day (e.g. 00:00 UTC is already "tomorrow"
 * in Sydney).
 */
export function sydneyDateOf(utcIso: string): string {
  return utcIsoToSydneyLocal(utcIso).slice(0, 10);
}

/** A UTC ISO string as a Sydney `datetime-local` value ("YYYY-MM-DDTHH:mm"). */
export function utcIsoToSydneyLocal(utcIso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcIso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/** Human-readable Sydney time for display, e.g. "29 Jul 2026, 9:00 am AEST". */
export function formatSydney(utcIso: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: APP_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...opts,
  }).format(new Date(utcIso));
}
