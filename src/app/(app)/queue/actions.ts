"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inngest } from "@/inngest/client";
import {
  getContentApprovalService,
  getContentCalendarService,
  getContentProductionService,
  getUsageService,
} from "@/lib/container";
import { IMAGE_PLATFORMS, PLATFORMS, type Platform, type Profile } from "@/lib/domain";
import { AppError } from "@/lib/errors";
import { DemoModeError, isDemoMode } from "@/lib/demoMode";
import { sydneyLocalToUtcIso } from "@/lib/timezone";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BUCKETS, objectExists } from "@/lib/supabase/storage";
import { ContentItemRepository } from "@/repositories/ContentItemRepository";
import { ProfileRepository } from "@/repositories/ProfileRepository";

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
  if (error instanceof z.ZodError) return { error: "Check the form fields and try again." };
  // AppError messages are already safe for users (roles, transitions, limits).
  if (error instanceof AppError) return { error: error.message };
  return { error: "Something went wrong — try again." };
}

// ------------------------------------------------------------- approvals

const ItemSchema = z.object({ itemId: z.uuid() });

const ApproveSchema = z.object({
  itemId: z.uuid(),
  // ISO datetime from a datetime-local input; empty = publish now.
  scheduledFor: z.union([z.string().min(1), z.literal("")]).optional(),
});

export async function approveItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    const input = ApproveSchema.parse({
      itemId: formData.get("itemId"),
      scheduledFor: formData.get("scheduledFor") ?? "",
    });
    // The datetime-local value is Sydney wall-clock time; convert it to the
    // matching UTC instant so it publishes at that time in Sydney regardless of
    // where the server or reviewer's browser is.
    let scheduledFor: string | null = null;
    if (input.scheduledFor && input.scheduledFor.length > 0) {
      scheduledFor = sydneyLocalToUtcIso(input.scheduledFor);
      if (!scheduledFor) return { error: "That schedule time is not valid." };
    }
    // Role and status checks live in the service — the UI is never the gate.
    await getContentApprovalService().approve(input.itemId, profile, scheduledFor);
    revalidatePath("/queue");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

export async function cancelSchedule(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    const { itemId } = ItemSchema.parse({ itemId: formData.get("itemId") });
    await getContentApprovalService().cancelSchedule(itemId, profile);
    revalidatePath("/queue");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

export async function retryFailedItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    const { itemId } = ItemSchema.parse({ itemId: formData.get("itemId") });
    await getContentApprovalService().retryFailed(itemId, profile);
    revalidatePath("/queue");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

const EditCaptionSchema = z.object({
  itemId: z.uuid(),
  caption: z.string().max(4000),
});

export async function editCaption(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    const input = EditCaptionSchema.parse({
      itemId: formData.get("itemId"),
      caption: formData.get("caption") ?? "",
    });
    await getContentApprovalService().editCaption(input.itemId, profile, input.caption);
    revalidatePath("/queue");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

const RequestEditsSchema = z.object({
  itemId: z.uuid(),
  comment: z.string().min(1, "Describe the changes needed.").max(2000),
});

export async function requestEdits(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    const input = RequestEditsSchema.parse({
      itemId: formData.get("itemId"),
      comment: formData.get("comment"),
    });
    await getContentApprovalService().requestEdits(input.itemId, profile, input.comment);
    revalidatePath("/queue");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

// -------------------------------------------------------- destinations

const UpdatePlatformsSchema = z.object({
  itemId: z.uuid(),
  platforms: z.array(z.enum(PLATFORMS)).min(1, "Pick at least one platform."),
});

/**
 * Changes the destination platforms of a queued item before it publishes (in
 * case a reviewer changes their mind). Image posts can't target YouTube
 * (video-only); videos can target any platform. Publishing/posted items are
 * locked.
 */
export async function updateTargetPlatforms(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (!["admin", "reviewer"].includes(profile.role)) {
      return { error: "Only admins and reviewers can change destinations." };
    }
    const input = UpdatePlatformsSchema.parse({
      itemId: formData.get("itemId"),
      platforms: formData.getAll("platforms"),
    });
    const admin = createSupabaseAdminClient();
    const repo = new ContentItemRepository(admin);
    const item = await repo.getById(input.itemId);
    if (item.status === "publishing" || item.status === "posted") {
      return { error: "This post is already publishing — its destinations can't be changed." };
    }
    // Image posts are image-only platforms; videos can go anywhere.
    const isImage = item.type === "image_post";
    const allowed = input.platforms.filter((p) => (isImage ? p !== "youtube" : true));
    if (allowed.length === 0) {
      return { error: "Pick at least one valid platform for this post type." };
    }
    await repo.setTargetPlatforms(input.itemId, [...new Set(allowed)]);
    revalidatePath("/queue");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

/**
 * Reposts an already-posted item to additional platforms it wasn't sent to
 * before. Publishing action, so admin/reviewer only; the service re-checks the
 * approval gate and skips platforms already posted (no duplicates). Runs in the
 * background via Inngest.
 */
export async function repostToMorePlatforms(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (!["admin", "reviewer"].includes(profile.role)) {
      return { error: "Only admins and reviewers can publish." };
    }
    const input = UpdatePlatformsSchema.parse({
      itemId: formData.get("itemId"),
      platforms: formData.getAll("platforms"),
    });
    await inngest.send({
      name: "content/repost-requested",
      data: { contentItemId: input.itemId, platforms: input.platforms },
    });
    revalidatePath("/queue");
    revalidatePath("/library");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

// ---------------------------------------------------------- video captions

/**
 * Adds burned-in styled captions to an already-rendered video that has none.
 * Runs in the background (transcribe + ffmpeg burn) via Inngest; the tracker /
 * a refresh shows the captioned version once it lands. The original is kept.
 */
export async function addVideoCaptions(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") return { error: "Reviewers cannot edit content." };
    const input = ItemSchema.parse({ itemId: formData.get("itemId") });
    await inngest.send({ name: "video/captions-requested", data: { contentItemId: input.itemId } });
    revalidatePath("/queue");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

/**
 * Appends the account's outro clip to the end of the video (background ffmpeg
 * concat via Inngest). The queue shows progress until the outro version lands.
 */
export async function addVideoOutro(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") return { error: "Reviewers cannot edit content." };
    const input = ItemSchema.parse({ itemId: formData.get("itemId") });
    await inngest.send({ name: "video/outro-requested", data: { contentItemId: input.itemId } });
    revalidatePath("/queue");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

// Direct-to-storage upload: the client PUTs the video straight to the bucket via
// a short-lived signed token, so this cap is NOT bound by the server-action
// bodySizeLimit anymore — only by storage. 1 GB is plenty for an edited clip.
const VIDEO_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
// Server-issued upload paths only (never a user-supplied filename, SECURITY §6).
const UPLOAD_PATH = /^queue-uploads\/[0-9a-fA-F-]{36}\.(mp4|mov|webm)$/;

const UploadUrlSchema = z.object({
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
});

/**
 * Step 1: mint a short-lived signed upload URL so the client can PUT the edited
 * video straight to storage (bypasses the server-action body limit). Returns the
 * server-generated path + token, or a clear error.
 */
export async function createQueueVideoUploadUrl(input: {
  mimeType: string;
  sizeBytes: number;
}): Promise<{ error: string | null; token?: string; path?: string }> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") return { error: "Reviewers cannot add content." };
    const parsed = UploadUrlSchema.parse(input);
    const ext = VIDEO_EXT[parsed.mimeType];
    if (!ext) return { error: "Use an mp4, mov, or webm video." };
    if (parsed.sizeBytes > MAX_VIDEO_BYTES) return { error: "Video must be under 1 GB." };

    const path = `queue-uploads/${randomUUID()}.${ext}`;
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.storage
      .from(BUCKETS.generatedMedia)
      .createSignedUploadUrl(path);
    if (error || !data) {
      await getUsageService()
        .reportStorageIssue(`Could not prepare a video upload: ${error?.message ?? "unknown"}`)
        .catch(() => {});
      return { error: "Could not prepare the upload — storage may be unavailable. Try again shortly." };
    }
    return { error: null, token: data.token, path };
  } catch (error) {
    return { error: toState(error).error };
  }
}

/**
 * Called by the client when a direct upload fails in a way that looks like the
 * storage quota is full — raises the app-wide storage alert so an admin sees it.
 */
export async function flagQueueStorageFull(message: string): Promise<void> {
  try {
    await requireUser();
    await getUsageService().reportStorageIssue(
      message.slice(0, 200) || "A video upload was rejected — storage may be full.",
    );
  } catch {
    // Best-effort telemetry; never block the user's flow on this.
  }
}

const CreateFromUploadSchema = z.object({
  storagePath: z.string().regex(UPLOAD_PATH, "Unexpected upload path."),
  mimeType: z.enum(["video/mp4", "video/quicktime", "video/webm"]),
  brand: z.string().min(1, "Pick an account."),
  platforms: z.array(z.enum(PLATFORMS)).min(1, "Pick at least one platform."),
  caption: z.string().max(4000).optional(),
});

/**
 * Step 2: after the bytes are in storage, create the queue item from the path.
 * Gate-safe — it lands in pending_approval and still needs approval to publish;
 * once queued, the usual video controls apply (Add outro, Generate captions,
 * schedule). Verifies the object actually landed as a storage-full safeguard.
 */
export async function createQueueVideoFromUpload(input: {
  storagePath: string;
  mimeType: string;
  brand: string;
  platforms: string[];
  caption?: string;
}): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") return { error: "Reviewers cannot add content." };
    const parsed = CreateFromUploadSchema.parse(input);

    // Safeguard: the bytes must actually be in storage. A missing object usually
    // means the upload was interrupted or storage rejected it (e.g. it's full).
    const admin = createSupabaseAdminClient();
    const landed = await objectExists(admin, BUCKETS.generatedMedia, parsed.storagePath);
    if (!landed) {
      await getUsageService()
        .reportStorageIssue("A queue video upload did not land in storage — the bucket may be full.")
        .catch(() => {});
      return {
        error: "The upload didn't finish landing in storage (it may be full). Try again, or free up space.",
      };
    }

    await getContentProductionService().createUploadedVideoFromPath({
      brand: parsed.brand,
      platforms: [...parsed.platforms] as Platform[],
      caption: (parsed.caption ?? "").trim(),
      storagePath: parsed.storagePath,
      mimeType: parsed.mimeType,
      requestedBy: profile.id,
    });
    revalidatePath("/queue");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

/** Toggles the active (served + published) version between captioned/original. */
export async function switchVideoVersion(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") return { error: "Reviewers cannot edit content." };
    const input = ItemSchema.parse({ itemId: formData.get("itemId") });
    await getContentProductionService().switchVideoVersion(input.itemId);
    revalidatePath("/queue");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

// -------------------------------------------------------------- calendar

const AddCalendarEntrySchema = z.object({
  calendarDate: z.iso.date(),
  brand: z.string().min(1),
  platforms: z.array(z.enum(IMAGE_PLATFORMS)).min(1, "Pick at least one platform."),
  prompt: z.string().max(2000),
  brandPresetId: z.union([z.uuid(), z.literal("")]),
});

export async function addCalendarEntry(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") {
      return { error: "Reviewers cannot edit the content calendar." };
    }
    const input = AddCalendarEntrySchema.parse({
      calendarDate: formData.get("calendarDate"),
      brand: formData.get("brand"),
      platforms: formData.getAll("platforms"),
      prompt: formData.get("prompt") ?? "",
      brandPresetId: formData.get("brandPresetId") ?? "",
    });
    await getContentCalendarService().addEntry({
      calendarDate: input.calendarDate,
      brand: input.brand,
      platforms: input.platforms,
      prompt: input.prompt,
      brandPresetId: input.brandPresetId || null,
      createdBy: profile.id,
    });
    revalidatePath("/queue");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

export async function removeCalendarEntry(formData: FormData): Promise<void> {
  const profile = await requireUser();
  if (profile.role === "reviewer") return;
  const id = z.uuid().parse(formData.get("entryId"));
  await getContentCalendarService().removeEntry(id);
  revalidatePath("/queue");
}

const GenerateDaySchema = z.object({ calendarDate: z.iso.date() });

/** Manual "Generate now" — runs a scheduled day immediately (same path as the cron). */
export async function generateCalendarDay(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") {
      return { error: "Reviewers cannot trigger generation." };
    }
    const { calendarDate } = GenerateDaySchema.parse({
      calendarDate: formData.get("calendarDate"),
    });
    await inngest.send({
      name: "calendar/generate-requested",
      data: { calendarDate, requestedBy: profile.id },
    });
    revalidatePath("/queue");
    return OK;
  } catch (error) {
    return toState(error);
  }
}
