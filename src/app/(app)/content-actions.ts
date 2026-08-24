"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { DEMO_MESSAGE, isDemoMode } from "@/lib/demoMode";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BUCKETS, removeFromBucket } from "@/lib/supabase/storage";
import { ContentItemRepository, type OutputAsset } from "@/repositories/ContentItemRepository";
import { ProfileRepository } from "@/repositories/ProfileRepository";
import { SourceVideoRepository } from "@/repositories/SourceVideoRepository";

export interface DeleteState {
  error: string | null;
  ok?: boolean;
}

const OK: DeleteState = { error: null, ok: true };
const DeleteSchema = z.object({ itemId: z.uuid() });

/**
 * Permanently deletes a content item. Removes it from every tab at once
 * (history, content engine, queue, library all read content_items) and cleans
 * up its generated media in storage. Admin/editor only; reviewers cannot.
 */
export async function deleteContentItem(
  _prev: DeleteState,
  formData: FormData,
): Promise<DeleteState> {
  try {
    if (isDemoMode()) return { error: DEMO_MESSAGE };

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError("Not authenticated", "auth_error", 401);
    const profile = await new ProfileRepository(supabase).getById(user.id);
    if (profile.role === "reviewer") {
      return { error: "Reviewers cannot delete content." };
    }

    const { itemId } = DeleteSchema.parse({ itemId: formData.get("itemId") });
    const admin = createSupabaseAdminClient();
    const repo = new ContentItemRepository(admin);
    const item = await repo.getById(itemId);

    // Remove the generated media (grouped by bucket), then the row. Storage
    // cleanup is best-effort; the row delete is authoritative.
    const byBucket = new Map<string, string[]>();
    for (const asset of item.outputAssets as OutputAsset[]) {
      const list = byBucket.get(asset.bucket) ?? [];
      list.push(asset.path);
      byBucket.set(asset.bucket, list);
    }
    // Video thumbnails live in generated-media under rawGenerationInputs.
    const thumbPath = item.rawGenerationInputs.thumbnailPath;
    if (typeof thumbPath === "string" && thumbPath) {
      const list = byBucket.get(BUCKETS.generatedMedia) ?? [];
      list.push(thumbPath);
      byBucket.set(BUCKETS.generatedMedia, list);
    }
    for (const [bucket, paths] of byBucket) {
      await removeFromBucket(admin, bucket, paths);
    }

    await repo.deleteById(itemId);

    // Refresh every tab that lists content items.
    for (const path of ["/images", "/content", "/queue", "/library"]) revalidatePath(path);
    return OK;
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Could not delete — try again." };
  }
}

/**
 * Deletes a source video (recording) from the Content Engine. Its transcript
 * and analysis cascade; clips/videos already generated from it detach and stay
 * in the queue/library (delete those there). Admin/editor only.
 */
export async function deleteSourceVideo(
  _prev: DeleteState,
  formData: FormData,
): Promise<DeleteState> {
  try {
    if (isDemoMode()) return { error: DEMO_MESSAGE };

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError("Not authenticated", "auth_error", 401);
    const profile = await new ProfileRepository(supabase).getById(user.id);
    if (profile.role === "reviewer") return { error: "Reviewers cannot delete content." };

    const { itemId } = DeleteSchema.parse({ itemId: formData.get("itemId") });
    const admin = createSupabaseAdminClient();
    const repo = new SourceVideoRepository(admin);
    const video = await repo.getById(itemId);

    // Remove the uploaded file (URL-sourced videos have no stored object).
    if (video.storagePath) {
      await removeFromBucket(admin, BUCKETS.sourceVideos, [video.storagePath]);
    }
    await repo.deleteById(itemId);

    revalidatePath("/content");
    return OK;
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Could not delete — try again." };
  }
}
