/**
 * Hard safety net for generated copy: strip em/en dashes (a giveaway of
 * AI-written text the brand wants to avoid) and replace them with ordinary
 * punctuation. The generation prompts also ask the model to avoid them; this
 * guarantees it regardless of what the model returns.
 *
 * - " — " / "—" (em dash, spaced or not) → hyphen, so "big — bold" reads
 *   "big - bold" and "word—word" reads "word-word".
 * - En dash "–" is normalized the same way.
 */
export function stripEmDashes(text: string): string {
  return text
    .replace(/\s*—\s*/g, " - ")
    .replace(/\s*–\s*/g, " - ")
    // Tidy any doubled spaces the replacement may introduce.
    .replace(/ {2,}/g, " ")
    .trim();
}

/** Recursively strip em dashes from all string values in a copy object. */
export function stripEmDashesDeep<T>(value: T): T {
  if (typeof value === "string") return stripEmDashes(value) as T;
  if (Array.isArray(value)) return value.map((item) => stripEmDashesDeep(item)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = stripEmDashesDeep(item);
    }
    return out as T;
  }
  return value;
}
