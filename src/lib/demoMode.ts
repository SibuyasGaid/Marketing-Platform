import { AppError } from "@/lib/errors";

/**
 * Demo mode — the app runs with no database.
 *
 * This repo ships without credentials, so a fresh clone (and the hosted
 * portfolio deployment) has no Supabase project to talk to. Rather than
 * white-screening on the first query, the app serves a read-only tour: pages
 * render against in-memory fixtures, auth is bypassed, and anything that would
 * write explains that nothing is saved.
 *
 * Active whenever Supabase is not configured. Supplying a real
 * NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY turns it off with no
 * code change, so a real deployment is never accidentally in demo mode.
 */
export function isDemoMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return !url || !serviceRoleKey;
}

/** Shown wherever a write would have happened. */
export const DEMO_MESSAGE =
  "Demo mode — this build has no database connected, so nothing is saved. Everything you see is sample data.";

/**
 * Thrown by the server actions' auth guard while in demo mode. Extends AppError
 * so each action's existing `toState` catch renders the message as-is, which is
 * why guarding 95 actions costs one line per action file instead of 95 edits.
 */
export class DemoModeError extends AppError {
  constructor(message: string = DEMO_MESSAGE) {
    super(message, "auth_error", 403);
  }
}
