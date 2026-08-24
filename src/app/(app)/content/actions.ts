"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inngest } from "@/inngest/client";
import {
  getTranscriptionService,
  getUsageService,
} from "@/lib/container";
import { PLATFORMS, type Profile } from "@/lib/domain";
import { AppError } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BUCKETS } from "@/lib/supabase/storage";
import { CompetitorRepository } from "@/repositories/CompetitorRepository";
import { ProfileRepository } from "@/repositories/ProfileRepository";

export interface ActionState {
  error: string | null;
  ok?: boolean;
}

const OK: ActionState = { error: null, ok: true };

async function requireUser(): Promise<Profile> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new AppError("Not authenticated", "auth_error", 401);
  return new ProfileRepository(supabase).getById(user.id);
}

function toState(error: unknown): ActionState {
  if (error instanceof z.ZodError) return { error: "Check the form fields and try again." };
  if (error instanceof AppError) return { error: error.message };
  return { error: "Something went wrong — try again." };
}

// ------------------------------------------------------------ competitors

const AddCompetitorSchema = z.object({
  name: z.string().min(1).max(120),
  // Lenient: accept a bare domain ("example.com") or a full URL — this is
  // reference data for the digest research, not a strict link.
  websiteUrl: z.string().max(200),
  socialHandles: z
    .string()
    .transform((raw) => raw.split(",").map((handle) => handle.trim()).filter(Boolean))
    .pipe(z.array(z.string().max(120)).max(8)),
  notes: z.string().max(500),
});

export async function addCompetitor(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") return { error: "Reviewers cannot edit the watchlist." };
    const input = AddCompetitorSchema.parse({
      name: formData.get("name"),
      websiteUrl: formData.get("websiteUrl") ?? "",
      socialHandles: formData.get("socialHandles") ?? "",
      notes: formData.get("notes") ?? "",
    });
    await new CompetitorRepository(createSupabaseAdminClient()).create({
      name: input.name,
      websiteUrl: input.websiteUrl.trim() || null,
      socialHandles: input.socialHandles,
      notes: input.notes || null,
      createdBy: profile.id,
    });
    revalidatePath("/content");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

export async function removeCompetitor(formData: FormData): Promise<void> {
  const profile = await requireUser();
  if (profile.role === "reviewer") return;
  const id = z.uuid().parse(formData.get("competitorId"));
  await new CompetitorRepository(createSupabaseAdminClient()).deactivate(id);
  revalidatePath("/content");
}

// ------------------------------------------------------------- ingestion

const ALLOWED_VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
};
const MAX_VOD_BYTES = 2 * 1024 * 1024 * 1024; // 2GB, per docs/SECURITY.md §6

const UploadUrlSchema = z.object({
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
});

export async function createVodUploadUrl(input: {
  mimeType: string;
  sizeBytes: number;
}): Promise<{ error: string | null; token?: string; path?: string }> {
  try {
    await requireUser();
    const parsed = UploadUrlSchema.parse(input);
    const extension = ALLOWED_VIDEO_TYPES[parsed.mimeType];
    if (!extension) {
      return { error: "Unsupported file type — use MP4, MOV, WebM, MP3, M4A, or WAV." };
    }
    if (parsed.sizeBytes > MAX_VOD_BYTES) {
      return { error: "Video upload failed — file exceeds 2GB. Compress it or paste a source URL instead." };
    }
    // Server-generated path — never a user-supplied filename (SECURITY §6).
    const path = `uploads/${randomUUID()}.${extension}`;
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.storage
      .from(BUCKETS.sourceVideos)
      .createSignedUploadUrl(path);
    if (error || !data) return { error: "Could not prepare the upload — try again." };
    // The token authorizes uploadToSignedUrl on the client (the reliable,
    // officially-supported path for direct-to-storage uploads).
    return { error: null, token: data.token, path };
  } catch (error) {
    return { error: toState(error).error };
  }
}

const CompleteIngestSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000),
  storagePath: z.string().min(1).nullable(),
  sourceUrl: z.union([z.url(), z.literal("")]),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().positive().nullable(),
});

export async function completeVodIngest(input: {
  title: string;
  description: string;
  storagePath: string | null;
  sourceUrl: string;
  mimeType: string | null;
  sizeBytes: number | null;
}): Promise<ActionState> {
  try {
    const profile = await requireUser();
    const parsed = CompleteIngestSchema.parse(input);
    if (!parsed.storagePath && !parsed.sourceUrl) {
      return { error: "Upload a file or paste a direct media URL." };
    }
    await getTranscriptionService().ingest({
      title: parsed.title,
      description: parsed.description || null,
      storagePath: parsed.storagePath,
      sourceUrl: parsed.sourceUrl || null,
      mimeType: parsed.mimeType,
      sizeBytes: parsed.sizeBytes,
      userId: profile.id,
    });
    revalidatePath("/content");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

// ------------------------------------------------------ segment selection

const SelectSegmentsSchema = z.object({
  sourceVideoId: z.uuid(),
  segmentIds: z.array(z.string().min(1)).min(1, "Select at least one segment."),
  brand: z.string().min(1),
  platforms: z.array(z.enum(PLATFORMS)).min(1, "Pick at least one platform."),
  generateHeygenHook: z.boolean(),
  vertical: z.boolean(),
  generateThumbnail: z.boolean(),
});

export async function createContentFromSegments(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    const input = SelectSegmentsSchema.parse({
      sourceVideoId: formData.get("sourceVideoId"),
      segmentIds: formData.getAll("segmentIds"),
      brand: formData.get("brand"),
      platforms: formData.getAll("platforms"),
      generateHeygenHook: formData.get("generateHeygenHook") === "on",
      vertical: formData.get("vertical") === "on",
      generateThumbnail: formData.get("generateThumbnail") === "on",
    });
    await getUsageService().assertCanGenerate(profile.id);
    await inngest.send({
      name: "segments/selected",
      data: { ...input, requestedBy: profile.id },
    });
    revalidatePath("/content");
    revalidatePath("/queue");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

// ----------------------------------------------------------- weekly batch

const BatchSchema = z.object({
  theme: z.string().min(1, "Give the week a theme or focus.").max(1000),
  brand: z.string().min(1),
});

export async function requestWeeklyBatch(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    const input = BatchSchema.parse({
      theme: formData.get("theme"),
      brand: formData.get("brand"),
    });
    await getUsageService().assertCanGenerate(profile.id);
    await inngest.send({
      name: "week/batch-requested",
      data: {
        weekStartDate: nextMonday(),
        requestedBy: profile.id,
        brand: input.brand,
        theme: input.theme,
      },
    });
    revalidatePath("/content");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

function nextMonday(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  now.setUTCDate(now.getUTCDate() + daysUntilMonday);
  return now.toISOString().slice(0, 10);
}
