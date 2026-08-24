import { NextResponse, type NextRequest } from "next/server";
import { exchangeCodeForToken, listPages, longLivedToken } from "@/lib/meta";
import { connectMetaPage } from "@/lib/metaConnect";
import { verifyState } from "@/lib/oauthState";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SocialConnectionRepository } from "@/repositories/SocialConnectionRepository";

interface StatePayload {
  accountSlug: string;
  userId: string;
}

function backTo(request: NextRequest, slug: string | null, status: string): NextResponse {
  const path = slug ? `/accounts/${slug}` : "/accounts";
  return NextResponse.redirect(new URL(`${path}?meta=${status}`, request.url));
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const rawState = params.get("state");
  const state = rawState ? verifyState<StatePayload>(rawState) : null;

  // Reject a tampered/forged/mismatched callback.
  if (params.get("error") || !code || !state || state.userId !== user.id) {
    return backTo(request, state?.accountSlug ?? null, "error");
  }

  try {
    const shortToken = await exchangeCodeForToken(code);
    const { token: longToken, expiresInS } = await longLivedToken(shortToken);
    const pages = await listPages(longToken);
    if (pages.length === 0) return backTo(request, state.accountSlug, "nopages");

    const admin = createSupabaseAdminClient();
    const repo = new SocialConnectionRepository(admin);

    // One Page → connect it directly. Multiple Pages under this login → stash a
    // short-lived pending record (holds the user token, encrypted) and send the
    // user to a picker so they choose which Page maps to THIS account. This is
    // what makes one FB login serve two accounts (Agency + Acquisition).
    if (pages.length > 1) {
      await repo.upsert({
        accountSlug: state.accountSlug,
        platform: "meta_pending",
        accessToken: longToken, // user token, encrypted at rest by the repo
        expiresAt: expiresInS ? new Date(Date.now() + expiresInS * 1000).toISOString() : null,
        externalId: null,
        externalName: null,
        meta: {
          pages: pages.map((page) => ({
            id: page.id,
            name: page.name,
            hasInstagram: Boolean(page.igUserId),
          })),
        },
        connectedBy: user.id,
      });
      return NextResponse.redirect(new URL(`/accounts/${state.accountSlug}?meta=choose`, request.url));
    }

    const status = await connectMetaPage({
      repo,
      accountSlug: state.accountSlug,
      userId: user.id,
      page: pages[0],
      expiresInS,
    });
    return backTo(request, state.accountSlug, status);
  } catch {
    return backTo(request, state.accountSlug, "error");
  }
}
