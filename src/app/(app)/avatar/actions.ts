"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inngest } from "@/inngest/client";
import {
  getContentProductionService,
  getPostCaptionService,
  getUsageService,
} from "@/lib/container";
import { AppError } from "@/lib/errors";
import { DemoModeError, isDemoMode } from "@/lib/demoMode";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BUCKETS, isOneoffReferencePath, objectExists } from "@/lib/supabase/storage";
import { AccountRepository } from "@/repositories/AccountRepository";
import { ContentItemRepository } from "@/repositories/ContentItemRepository";
import { ProfileRepository } from "@/repositories/ProfileRepository";
import type { ImagePlatform, Platform, Profile } from "@/lib/domain";

export interface ActionState {
  error: string | null;
  ok?: boolean;
}

const OK: ActionState = { error: null, ok: true };

async function requireUser(): Promise<Profile> {
  // Demo mode: every action funnels through here, so one throw covers them all.
  // DemoModeError extends AppError, so the toState below renders its message.
  if (isDemoMode()) throw new DemoModeError();

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new AppError("Not authenticated", "auth_error", 401);
  return new ProfileRepository(supabase).getById(user.id);
}

function toState(error: unknown): ActionState {
  if (error instanceof z.ZodError) return { error: "Check the fields and try again." };
  if (error instanceof AppError) return { error: error.message };
  const message = error instanceof Error ? error.message : "";
  return { error: message || "Something went wrong — try again." };
}

// Avatar videos are vertical short-form: IG Reels, FB video, YouTube Shorts.
const AVATAR_PLATFORMS = ["instagram", "facebook", "youtube"] as const;

// Captions are written for an image platform (YouTube uses the text as the video
// description). Pick a valid caption platform, defaulting to instagram when only
// YouTube is selected.
function captionPlatformFor(platforms: readonly string[]): ImagePlatform {
  const valid = platforms.find((p): p is ImagePlatform =>
    ["instagram", "facebook", "linkedin"].includes(p),
  );
  return valid ?? "instagram";
}

const RequestSchema = z.object({
  script: z.string().min(1, "Enter what the avatar should say.").max(4000),
  brand: z.string().min(1, "Pick an account."),
  avatarReferenceId: z.union([z.uuid(), z.literal("")]).optional(),
  platforms: z.array(z.enum(AVATAR_PLATFORMS)).min(1, "Pick at least one platform."),
  // Optional caption; if blank, one is generated from the script.
  caption: z.string().max(4000).optional(),
  // Optional solid background color (hex). Blank = HeyGen default.
  backgroundColor: z
    .union([z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #0B2A4A."), z.literal("")])
    .optional(),
  // Optional uploaded background image (one-off storage path). Wins over color.
  backgroundImagePath: z.union([z.string().max(200), z.literal("")]).optional(),
  // Optional body-motion direction + energy (HeyGen Avatar IV). Blank = defaults.
  motionPrompt: z.string().max(300).optional(),
  expressiveness: z.union([z.enum(["low", "medium", "high"]), z.literal("")]).optional(),
  // Optional custom cover/thumbnail (one-off storage path).
  coverImagePath: z.union([z.string().max(200), z.literal("")]).optional(),
  // Burn auto-generated subtitles into the video.
  subtitles: z.union([z.literal("on"), z.literal("")]).optional(),
});

export async function requestAvatarVideo(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") return { error: "Reviewers cannot create content." };

    const input = RequestSchema.parse({
      script: formData.get("script"),
      brand: formData.get("brand"),
      avatarReferenceId: formData.get("avatarReferenceId") ?? "",
      platforms: formData.getAll("platforms"),
      caption: formData.get("caption") ?? "",
      backgroundColor: formData.get("backgroundColor") ?? "",
      backgroundImagePath: formData.get("backgroundImagePath") ?? "",
      motionPrompt: formData.get("motionPrompt") ?? "",
      expressiveness: formData.get("expressiveness") ?? "",
      coverImagePath: formData.get("coverImagePath") ?? "",
      subtitles: formData.get("subtitles") ?? "",
    });

    // Studio videos are generated WITHOUT a caption — the user adds one later in
    // the Generated Videos sub-page when moving the clip to the Approval Queue.
    const caption = (input.caption ?? "").trim();

    // Only accept a server-generated one-off path (SECURITY §6).
    const backgroundImagePath =
      input.backgroundImagePath && isOneoffReferencePath(input.backgroundImagePath)
        ? input.backgroundImagePath
        : null;
    const coverImagePath =
      input.coverImagePath && isOneoffReferencePath(input.coverImagePath)
        ? input.coverImagePath
        : null;

    const itemId = await getContentProductionService().createAvatarVideo({
      script: input.script,
      caption,
      brand: input.brand,
      platforms: [...input.platforms],
      avatarReferenceId: input.avatarReferenceId || null,
      backgroundColor: input.backgroundColor || null,
      backgroundImagePath,
      coverImagePath,
      motionPrompt: input.motionPrompt || null,
      expressiveness: input.expressiveness || null,
      subtitles: input.subtitles === "on",
      requestedBy: profile.id,
    });

    await inngest.send({ name: "avatar/video-requested", data: { contentItemId: itemId } });

    revalidatePath("/avatar");
    revalidatePath("/queue");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

// ------------------------------------------------------- prompt-driven clips

const ClipSchema = z.object({
  visualsPrompt: z.string().min(1, "Describe the visuals.").max(4000),
  script: z.string().max(4000).optional(),
  textToDisplay: z.string().max(500).optional(),
  brand: z.string().min(1, "Pick an account."),
  platforms: z.array(z.enum(AVATAR_PLATFORMS)).min(1, "Pick at least one platform."),
  // Optional reference images (one-off storage paths) that steer the look.
  referenceImagePaths: z.array(z.string().max(200)).max(4).optional(),
});

/** Creates a prompt-driven visual clip (HeyGen Video Agent) into the studio. */
export async function requestClipVideo(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") return { error: "Reviewers cannot create content." };

    const input = ClipSchema.parse({
      visualsPrompt: formData.get("visualsPrompt"),
      script: formData.get("script") ?? "",
      textToDisplay: formData.get("textToDisplay") ?? "",
      brand: formData.get("brand"),
      platforms: formData.getAll("platforms"),
      referenceImagePaths: formData.getAll("referenceImagePaths").map(String),
    });

    // Only accept server-generated one-off paths (SECURITY §6).
    const referenceImagePaths = (input.referenceImagePaths ?? []).filter(isOneoffReferencePath);

    const itemId = await getContentProductionService().createClipVideo({
      visualsPrompt: input.visualsPrompt,
      script: input.script ?? "",
      textToDisplay: input.textToDisplay ?? "",
      brand: input.brand,
      platforms: [...input.platforms],
      referenceImagePaths,
      requestedBy: profile.id,
    });

    await inngest.send({ name: "clip/video-requested", data: { contentItemId: itemId } });
    revalidatePath("/avatar");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

// -------------------------------------------------- studio (generated) videos

/**
 * Moves a generated studio video to the Approval Queue with the caption the user
 * wrote in the sub-page. Stays gate-safe: it lands in pending_approval, which
 * still requires human approval to publish. The caption may be left blank and
 * edited later in the queue.
 */
export async function moveStudioVideoToQueue(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") return { error: "Reviewers cannot edit content." };
    const itemId = z.uuid().parse(formData.get("itemId"));
    const caption = z.string().max(4000).parse(formData.get("caption") ?? "");
    await getContentProductionService().moveStudioVideoToQueue(itemId, caption);
    revalidatePath("/avatar");
    revalidatePath("/queue");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

/** Re-runs generation for a studio video (clip or avatar) that failed or needs a re-roll. */
export async function regenerateStudioVideo(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") return { error: "Reviewers cannot edit content." };
    const itemId = z.uuid().parse(formData.get("itemId"));
    const kind = await getContentProductionService().resetStudioVideoForRegeneration(itemId);
    await inngest.send({
      name:
        kind === "clip_video"
          ? "clip/video-requested"
          : kind === "merged_video"
            ? "merge/requested"
            : "avatar/video-requested",
      data: { contentItemId: itemId },
    });
    revalidatePath("/avatar");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

/**
 * Suggests a caption for a generated studio video, on demand (the sub-page's
 * "Suggest caption" button). Derives the topic from the item itself — the avatar
 * script, or a clip's visuals + on-screen text + narration — so it works for both
 * kinds. On-demand only: no caption AI call is spent unless the user asks.
 */
export async function suggestStudioCaption(
  itemId: string,
): Promise<{ error: string | null; caption?: string }> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") return { error: "Reviewers cannot edit content." };
    const id = z.uuid().parse(itemId);

    const admin = createSupabaseAdminClient();
    const item = await new ContentItemRepository(admin).getById(id).catch(() => null);
    if (!item) return { error: "Video not found." };
    if (item.rawGenerationInputs.studio !== true) {
      return { error: "This is not a generated studio video." };
    }

    // Topic = what the video is about. Avatar → its script; clip → its visuals,
    // on-screen text, and narration combined.
    const gi = item.rawGenerationInputs;
    const topic =
      gi.kind === "clip_video"
        ? [gi.visualsPrompt, gi.textToDisplay, gi.script]
            .map((value) => String(value ?? "").trim())
            .filter(Boolean)
            .join(". ")
        : String(gi.rawScript ?? gi.script ?? "").trim();
    if (!topic) return { error: "Nothing to base a caption on yet." };

    const account = await new AccountRepository(admin).getBySlug(item.brand).catch(() => null);
    const platform = captionPlatformFor(item.targetPlatforms);
    const captions = await getPostCaptionService().generate({
      brand: item.brand,
      brandName: account?.name,
      brandContext: account?.description ?? undefined,
      topic,
      tone: "confident, direct",
      platforms: [platform],
      idempotencyKey: `studiocap:${id}:${Date.now()}`,
      createdBy: profile.id,
    });
    return { error: null, caption: captions[platform] ?? "" };
  } catch (error) {
    return { error: toState(error).error };
  }
}

// ----------------------------------------------------- combine (merge) videos

const VIDEO_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};
const MAX_SOURCE_BYTES = 1024 * 1024 * 1024; // 1 GB (direct-to-storage upload)
const MAX_MERGE_SOURCES = 6; // keeps the whole ffmpeg merge inside one function run
const MERGE_SOURCE_PATH = /^merge-sources\/[0-9a-fA-F-]{36}\.(mp4|mov|webm)$/;

const MergeUploadUrlSchema = z.object({
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
});

/**
 * Mints a signed URL so the client can upload a one-off merge source straight to
 * storage (bypasses the server-action body limit). Path is server-generated.
 */
export async function createMergeSourceUploadUrl(input: {
  mimeType: string;
  sizeBytes: number;
}): Promise<{ error: string | null; token?: string; path?: string }> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") return { error: "Reviewers cannot add content." };
    const parsed = MergeUploadUrlSchema.parse(input);
    const ext = VIDEO_EXT[parsed.mimeType];
    if (!ext) return { error: "Use an mp4, mov, or webm video." };
    if (parsed.sizeBytes > MAX_SOURCE_BYTES) return { error: "Each video must be under 1 GB." };

    const path = `merge-sources/${randomUUID()}.${ext}`;
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.storage
      .from(BUCKETS.generatedMedia)
      .createSignedUploadUrl(path);
    if (error || !data) {
      await getUsageService()
        .reportStorageIssue(`Could not prepare a merge upload: ${error?.message ?? "unknown"}`)
        .catch(() => {});
      return { error: "Could not prepare the upload — storage may be unavailable. Try again shortly." };
    }
    return { error: null, token: data.token, path };
  } catch (error) {
    return { error: toState(error).error };
  }
}

const CombineSchema = z.object({
  brand: z.string().min(1, "Pick an account."),
  platforms: z.array(z.enum(AVATAR_PLATFORMS)).min(1, "Pick at least one platform."),
  sources: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("library"), itemId: z.uuid() }),
        z.object({ kind: z.literal("upload"), path: z.string().regex(MERGE_SOURCE_PATH) }),
      ]),
    )
    .min(2, "Pick at least two videos to combine.")
    .max(MAX_MERGE_SOURCES, `Combine up to ${MAX_MERGE_SOURCES} videos at once.`),
});

/**
 * Combines the chosen videos (in order) into one via ffmpeg — no AI credits.
 * Resolves each source server-side so the client can't inject arbitrary paths:
 * a "library" source is resolved to its content item's own output (never
 * cleaned up); an "upload" is a validated merge-sources/ path (deleted after a
 * successful merge). Creates a studio merged_video that renders into the
 * Generated videos holding, then fires merge/requested.
 */
export async function requestCombineVideo(input: {
  brand: string;
  platforms: string[];
  sources: Array<{ kind: "library"; itemId: string } | { kind: "upload"; path: string }>;
}): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") return { error: "Reviewers cannot create content." };
    const parsed = CombineSchema.parse(input);

    const admin = createSupabaseAdminClient();
    const contentRepo = new ContentItemRepository(admin);
    const resolved: { bucket: string; path: string; cleanup: boolean }[] = [];
    for (const source of parsed.sources) {
      if (source.kind === "library") {
        const item = await contentRepo.getById(source.itemId).catch(() => null);
        const asset = item?.outputAssets[0] ?? null;
        if (!item || !asset) return { error: "One of the selected videos has no rendered file yet." };
        resolved.push({ bucket: asset.bucket, path: asset.path, cleanup: false });
      } else {
        const landed = await objectExists(admin, BUCKETS.generatedMedia, source.path);
        if (!landed) {
          await getUsageService()
            .reportStorageIssue("A merge source upload did not land in storage — the bucket may be full.")
            .catch(() => {});
          return { error: "An uploaded clip didn't finish landing in storage. Try again." };
        }
        resolved.push({ bucket: BUCKETS.generatedMedia, path: source.path, cleanup: true });
      }
    }

    const itemId = await getContentProductionService().createMergedVideo({
      brand: parsed.brand,
      platforms: [...parsed.platforms] as Platform[],
      sources: resolved,
      requestedBy: profile.id,
    });
    await inngest.send({ name: "merge/requested", data: { contentItemId: itemId } });
    revalidatePath("/avatar");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

/** Burns styled subtitles into a ready studio video (transcribe → burn), on demand. */
export async function addStudioVideoSubtitles(itemId: string): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") return { error: "Reviewers cannot edit content." };
    const id = z.uuid().parse(itemId);
    await inngest.send({ name: "video/captions-requested", data: { contentItemId: id } });
    revalidatePath("/avatar");
    return OK;
  } catch (error) {
    return toState(error);
  }
}
