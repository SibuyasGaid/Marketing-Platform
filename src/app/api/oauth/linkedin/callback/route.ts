import { NextResponse, type NextRequest } from "next/server";
import {
  exchangeCodeForToken,
  listOrganizations,
  type LinkedInOrganization,
} from "@/lib/linkedin";
import { verifyState } from "@/lib/oauthState";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AccountRepository } from "@/repositories/AccountRepository";
import { SocialConnectionRepository } from "@/repositories/SocialConnectionRepository";

interface StatePayload {
  accountSlug: string;
  userId: string;
}

/** Picks the org whose name best matches the account; falls back to the first. */
function pickOrg(orgs: LinkedInOrganization[], accountName: string): LinkedInOrganization | null {
  if (orgs.length === 0) return null;
  const target = accountName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const match = orgs.find((org) => {
    const name = (org.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    return name.length > 0 && (name.includes(target) || target.includes(name));
  });
  return match ?? orgs[0];
}

function backTo(request: NextRequest, slug: string | null, status: string): NextResponse {
  const path = slug ? `/accounts/${slug}` : "/accounts";
  return NextResponse.redirect(new URL(`${path}?linkedin=${status}`, request.url));
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
    const tokens = await exchangeCodeForToken(code);
    const orgs = await listOrganizations(tokens.accessToken);

    const admin = createSupabaseAdminClient();
    const account = await new AccountRepository(admin).getBySlug(state.accountSlug).catch(() => null);
    const org = pickOrg(orgs, account?.name ?? state.accountSlug);
    if (!org) return backTo(request, state.accountSlug, "noorgs");

    const expiresAt = tokens.expiresInS
      ? new Date(Date.now() + tokens.expiresInS * 1000).toISOString()
      : null;

    await new SocialConnectionRepository(admin).upsert({
      accountSlug: state.accountSlug,
      platform: "linkedin",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt,
      externalId: org.urn,
      externalName: org.name ?? org.urn,
      meta: { organization_urn: org.urn },
      connectedBy: user.id,
    });

    return backTo(request, state.accountSlug, "connected");
  } catch {
    return backTo(request, state.accountSlug, "error");
  }
}
