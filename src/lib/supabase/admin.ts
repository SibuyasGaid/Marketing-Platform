import { createClient } from "@supabase/supabase-js";
import { createDemoSupabaseClient } from "@/lib/demo/demoClient";
import { isDemoMode } from "@/lib/demoMode";

/**
 * Service-role client. SERVER-ONLY: bypasses RLS — used exclusively by
 * repositories running in server actions, route handlers, and Inngest jobs.
 * Must never be imported from a "use client" file or components/
 * (docs/SECURITY.md §1). Grepped for in CI.
 *
 * Validates only the two vars it needs (names, never values) rather than the
 * full env, so the app shell works before every vendor key is configured.
 */
export function createSupabaseAdminClient() {
  // No database configured — serve the fixture-backed tour instead of throwing.
  if (isDemoMode()) return createDemoSupabaseClient();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("Missing environment variable: NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
