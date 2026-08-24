import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isDemoMode } from "@/lib/demoMode";

/**
 * Auth proxy (Next 16 replacement for middleware.ts).
 * Refreshes the Supabase session cookie and redirects unauthenticated
 * requests to /login. No allow-listed "temporary" open app routes
 * (docs/SECURITY.md §3). Webhook/Inngest endpoints are excluded via the
 * matcher — they verify their own signatures instead.
 */
export default async function proxy(request: NextRequest) {
  // Demo mode has no auth provider to check against, and every route is a
  // read-only tour, so the gate is skipped rather than redirecting forever.
  // Writes are refused in the server actions themselves, not here.
  if (isDemoMode()) {
    if (request.nextUrl.pathname.startsWith("/login")) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginRoute = request.nextUrl.pathname.startsWith("/login");

  if (!user && !isLoginRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isLoginRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, Inngest, signature-verified webhooks, and
    // the public legal pages (required to be reachable without login for Meta).
    "/((?!_next/static|_next/image|favicon.ico|api/inngest|api/webhooks|privacy|data-deletion).*)",
  ],
};
