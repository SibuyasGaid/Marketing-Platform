"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Anon-key client for the browser. Used only for direct-to-storage uploads
 * via signed upload tokens minted server-side — large VODs stream straight to
 * storage instead of through a server action (which can't hold a 2GB body).
 * The signed token authorizes the write; RLS is not relied on here.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
