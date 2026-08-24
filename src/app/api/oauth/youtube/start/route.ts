import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { youtubeAuthUrl } from "@/lib/youtube";
import { signState } from "@/lib/oauthState";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProfileRepository } from "@/repositories/ProfileRepository";

/** Begins the YouTube (Google) OAuth connect for a given account. Requires a
 * logged-in admin/editor (a credential action). */
export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const profile = await new ProfileRepository(supabase).getById(user.id);
  const accountSlug = request.nextUrl.searchParams.get("account");
  if (!accountSlug || profile.role === "reviewer") {
    return NextResponse.redirect(new URL("/accounts", request.url));
  }

  const state = signState({ accountSlug, userId: user.id, nonce: randomUUID(), ts: Date.now() });
  return NextResponse.redirect(youtubeAuthUrl(state));
}
