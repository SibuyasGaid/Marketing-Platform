import type { SupabaseClient } from "@supabase/supabase-js";
import { ProviderError } from "@/lib/errors";

export const BUCKETS = {
  brandAssets: "brand-assets",
  avatarReferences: "avatar-references",
  sourceVideos: "source-videos",
  generatedMedia: "generated-media",
} as const;

/**
 * One-off reference uploads (attached to a single generation) live under this
 * prefix in the brand-assets bucket. Paths handed back to a generation are
 * validated against it so a client can't smuggle an arbitrary storage path in
 * to be downloaded and leaked into a render.
 */
export const ONEOFF_REFERENCE_PREFIX = "references/oneoff/";

export function isOneoffReferencePath(path: string): boolean {
  return /^references\/oneoff\/[a-f0-9-]+\.(png|jpe?g|webp)$/.test(path);
}

/** Server-side storage helpers. Buckets are private; the UI only ever sees signed URLs. */

export async function uploadToBucket(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  bytes: Uint8Array | Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, Buffer.from(bytes), { contentType, upsert: false });
  if (error) throw new ProviderError("supabase-storage", `Upload failed: ${error.message}`);
}

export async function downloadFromBucket(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
): Promise<{ base64Data: string; mimeType: string }> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    throw new ProviderError("supabase-storage", `Download failed for ${bucket}/${path}`);
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  return { base64Data: buffer.toString("base64"), mimeType: data.type || "image/png" };
}

/**
 * Best-effort delete of objects from a bucket. Used when an item is deleted so
 * its generated media doesn't linger. Never throws — a missing object or a
 * storage hiccup must not block the DB row deletion.
 */
export async function removeFromBucket(
  supabase: SupabaseClient,
  bucket: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  try {
    await supabase.storage.from(bucket).remove(paths);
  } catch {
    // Swallow — orphaned files are harmless; the row delete is what matters.
  }
}

/** Short-lived signed URL for UI display (docs/SECURITY.md §2). */
export async function signedUrl(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  expiresInSeconds = 60 * 60,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data.signedUrl;
}

/**
 * True if an object exists at `path` in the bucket. Best-effort (false on error).
 * Used to verify a direct-to-storage upload actually landed before we create a
 * record pointing at it — a missing object usually means the upload was
 * interrupted or storage rejected it (e.g. the bucket is full).
 */
export async function objectExists(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(folder, { search: name, limit: 100 });
  if (error) return false;
  return (data ?? []).some((entry) => entry.name === name);
}

/**
 * Batch-signs many paths in ONE bucket with a single API call
 * (`createSignedUrls`) instead of one round-trip per path — use this for grids
 * and carousels that would otherwise sign dozens of assets in a loop. Returns a
 * `path → url` map; a path that fails to sign (or is missing) maps to `null`.
 * Duplicate/blank paths are de-duped. On a total failure the map still contains
 * every requested path (as `null`), so callers can look up unconditionally.
 */
export async function signedUrls(
  supabase: SupabaseClient,
  bucket: string,
  paths: string[],
  expiresInSeconds = 60 * 60,
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return result;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(unique, expiresInSeconds);
  if (error || !data) {
    for (const path of unique) result.set(path, null);
    return result;
  }
  for (const row of data) {
    if (row.path) result.set(row.path, row.error ? null : (row.signedUrl ?? null));
  }
  // Guarantee every requested path is present even if the API omitted one.
  for (const path of unique) if (!result.has(path)) result.set(path, null);
  return result;
}
