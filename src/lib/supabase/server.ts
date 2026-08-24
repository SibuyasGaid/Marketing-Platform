import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createDemoSupabaseClient } from "@/lib/demo/demoClient";
import { isDemoMode } from "@/lib/demoMode";

/**
 * Anon-key client bound to the current user's session cookies.
 * Use in Server Components, server actions, and route handlers.
 */
export async function createSupabaseServerClient() {
  // No database configured — a demo user is always "signed in" (see demoMode.ts).
  if (isDemoMode()) return createDemoSupabaseClient();

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — session refresh is handled by proxy.ts.
          }
        },
      },
    },
  );
}
