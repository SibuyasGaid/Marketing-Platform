import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signedUrl } from "@/lib/supabase/storage";
import { ContentItemRepository } from "@/repositories/ContentItemRepository";

export const dynamic = "force-dynamic";

/**
 * Streams a content item's video with HTTP Range support. Supabase signed
 * object URLs don't range-serve reliably, which makes <video> stall/reset after
 * a second and fail to seek. We re-sign server-side per request and proxy the
 * bytes, forwarding the Range header so the browser can seek and play fully.
 * Auth-gated: only signed-in users, so signed URLs never reach the client.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { itemId } = await params;
  const admin = createSupabaseAdminClient();
  const item = await new ContentItemRepository(admin).getById(itemId).catch(() => null);
  const asset = item?.outputAssets[0] ?? null;
  if (!asset) return new NextResponse("Not found", { status: 404 });

  const url = await signedUrl(admin, asset.bucket, asset.path, 60 * 60);
  if (!url) return new NextResponse("Not available", { status: 404 });

  // Forward the browser's Range header so seeking/streaming works; storage
  // replies 206 with Content-Range, which we pass straight through.
  const range = request.headers.get("range");
  const upstream = await fetch(url, {
    headers: range ? { range } : {},
  });

  const headers = new Headers();
  headers.set("content-type", asset.mimeType || "video/mp4");
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=0, no-store");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers.set("content-range", contentRange);

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
