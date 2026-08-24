import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ContentItemRepository } from "@/repositories/ContentItemRepository";
import { JobRepository } from "@/repositories/JobRepository";

export const dynamic = "force-dynamic";

/**
 * Lightweight status signatures for the client generation polls. The images
 * (HistoryGrid) and Generate Videos (VideoStudioTabs) pages poll this instead of
 * calling router.refresh() every few seconds: the tiny JSON here is cheap, and a
 * full-page refresh only fires when a signature actually changes (a generation
 * started, finished, or failed). Auth-gated — signed-in users only.
 */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const admin = createSupabaseAdminClient();
  const [images, videos] = await Promise.all([
    new JobRepository(admin).activeImageJobsSignature().catch(() => ""),
    new ContentItemRepository(admin).renderingStudioVideosSignature().catch(() => ""),
  ]);

  return NextResponse.json({ images, videos }, { headers: { "cache-control": "no-store" } });
}
