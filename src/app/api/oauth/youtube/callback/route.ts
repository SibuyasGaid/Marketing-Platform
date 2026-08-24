import { NextResponse, type NextRequest } from "next/server";
import { exchangeCodeForToken, getChannel } from "@/lib/youtube";
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
  return NextResponse.redirect(new URL(`${path}?youtube=${status}`, request.url));
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
    const channel = await getChannel(tokens.accessToken);
    if (!channel) return backTo(request, state.accountSlug, "nochannel");

    const expiresAt = tokens.expiresInS
      ? new Date(Date.now() + tokens.expiresInS * 1000).toISOString()
      : null;

    await new SocialConnectionRepository(createSupabaseAdminClient()).upsert({
      accountSlug: state.accountSlug,
      platform: "youtube",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt,
      externalId: channel.id,
      externalName: channel.title ?? channel.id,
      meta: { channel_id: channel.id },
      connectedBy: user.id,
    });

    return backTo(request, state.accountSlug, "connected");
  } catch (error) {
    // Surface the real reason in the server logs (no secrets — provider message
    // only) so a failed connect is diagnosable. The most common cause when Google
    // login succeeds but this step fails is the YouTube Data API v3 not being
    // enabled on the Google Cloud project, or a wrong GOOGLE_CLIENT_SECRET.
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[youtube-oauth] connect failed for ${state.accountSlug}: ${message}`);
    return backTo(request, state.accountSlug, "error");
  }
}
