"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getImageGenerationService } from "@/lib/container";
import { IMAGE_PLATFORMS } from "@/lib/domain";
import { AppError } from "@/lib/errors";
import { DemoModeError, isDemoMode } from "@/lib/demoMode";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  BUCKETS,
  ONEOFF_REFERENCE_PREFIX,
  isOneoffReferencePath,
  uploadToBucket,
} from "@/lib/supabase/storage";
import { AvatarReferenceRepository } from "@/repositories/AvatarReferenceRepository";
import { BrandPresetRepository } from "@/repositories/BrandPresetRepository";
import { BrandReferenceRepository } from "@/repositories/BrandReferenceRepository";
import { ProfileRepository } from "@/repositories/ProfileRepository";
import type { Profile } from "@/lib/domain";

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
  if (error instanceof z.ZodError) {
    return { error: "Check the form fields and try again." };
  }
  if (error instanceof AppError) return { error: error.message };
  return { error: "Something went wrong — try again." };
}

// ---------------------------------------------------------------- presets

const CreatePresetSchema = z.object({
  name: z.string().min(1).max(120),
  tone: z.string().min(1).max(300),
  palette: z
    .string()
    .transform((raw) =>
      raw
        .split(",")
        .map((color) => color.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().max(40)).max(8)),
  styleRules: z.string().max(2000),
  campaignContext: z.string().max(2000),
});

export async function createPreset(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") {
      return { error: "Reviewers cannot create presets." };
    }
    const input = CreatePresetSchema.parse({
      name: formData.get("name"),
      tone: formData.get("tone"),
      palette: formData.get("palette") ?? "",
      styleRules: formData.get("styleRules") ?? "",
      campaignContext: formData.get("campaignContext") ?? "",
    });
    const supabase = await createSupabaseServerClient();
    await new BrandPresetRepository(supabase).create({
      name: input.name,
      tone: input.tone,
      palette: input.palette,
      styleRules: input.styleRules,
      campaignContext: input.campaignContext || null,
      createdBy: profile.id,
    });
    revalidatePath("/images");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

const UpdatePresetSchema = CreatePresetSchema.extend({ presetId: z.uuid() });

export async function updatePreset(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") return { error: "Reviewers cannot edit presets." };
    const input = UpdatePresetSchema.parse({
      presetId: formData.get("presetId"),
      name: formData.get("name"),
      tone: formData.get("tone"),
      palette: formData.get("palette") ?? "",
      styleRules: formData.get("styleRules") ?? "",
      campaignContext: formData.get("campaignContext") ?? "",
    });
    const supabase = await createSupabaseServerClient();
    await new BrandPresetRepository(supabase).update(input.presetId, {
      name: input.name,
      tone: input.tone,
      palette: input.palette,
      styleRules: input.styleRules,
      campaignContext: input.campaignContext || null,
    });
    revalidatePath("/images");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

export async function deletePreset(formData: FormData): Promise<void> {
  const profile = await requireUser();
  if (profile.role === "reviewer") return;
  const presetId = z.uuid().parse(formData.get("presetId"));
  // Soft delete so past generations that referenced it are untouched.
  await new BrandPresetRepository(await createSupabaseServerClient()).deactivate(presetId);
  revalidatePath("/images");
}

// ------------------------------------------------------- avatar references

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

function imageExtension(mimeType: string): string {
  return mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
}

const MAX_FILES_PER_UPLOAD = 20;

/** Shared validation for reference/avatar image uploads. */
function validateImageFile(file: FormDataEntryValue | null): ActionState | File {
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image file to upload." };
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return { error: "Only JPEG, PNG, or WebP images are allowed." };
  }
  if (file.size > MAX_AVATAR_BYTES) return { error: "Image exceeds 10MB — resize it and retry." };
  return file;
}

/**
 * Collects every chosen image (the input is `multiple`) and validates the whole
 * batch up front. Returns the files, or an ActionState error if any is invalid —
 * nothing is uploaded on error.
 */
function collectImageFiles(formData: FormData): File[] | ActionState {
  const files = formData.getAll("file").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length === 0) return { error: "Choose at least one image file to upload." };
  if (files.length > MAX_FILES_PER_UPLOAD) {
    return { error: `Upload up to ${MAX_FILES_PER_UPLOAD} images at once.` };
  }
  for (const file of files) {
    const validated = validateImageFile(file);
    if (!(validated instanceof File)) return validated;
  }
  return files;
}

const UploadAvatarSchema = z.object({
  personName: z.string().min(1).max(80),
  // The account this person belongs to (people are per-account). The composer
  // passes the selected account; optional so older callers still work.
  accountSlug: z.union([z.string().min(1), z.literal("")]).optional(),
});

export async function uploadAvatarReference(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    // Real people's likenesses: admin-only (docs/SECURITY.md §2).
    if (profile.role !== "admin") {
      return { error: "Only admins can manage avatar references." };
    }
    const { personName, accountSlug } = UploadAvatarSchema.parse({
      personName: formData.get("personName"),
      accountSlug: formData.get("accountSlug") ?? "",
    });
    // Accept several angles at once; validate the batch before uploading any.
    const files = collectImageFiles(formData);
    if (!Array.isArray(files)) return files;

    // Server-generated paths; never a user-supplied filename (SECURITY §6).
    const slug = personName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const admin = createSupabaseAdminClient();
    const repo = new AvatarReferenceRepository(admin);
    for (const file of files) {
      const path = `${slug}/${randomUUID()}.${imageExtension(file.type)}`;
      await uploadToBucket(
        admin,
        BUCKETS.avatarReferences,
        path,
        Buffer.from(await file.arrayBuffer()),
        file.type,
      );
      await repo.create({ personName, storagePath: path, accountSlug: accountSlug || null });
    }
    revalidatePath("/images");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

// ------------------------------------------------------- brand references

const UploadBrandReferenceSchema = z.object({ name: z.string().min(1).max(80) });

/** Saved, reusable brand reference (logo, product shot, style board). */
export async function uploadBrandReference(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    // Not people's likenesses — admin/editor may manage these.
    if (profile.role === "reviewer") {
      return { error: "Reviewers cannot manage brand references." };
    }
    const { name } = UploadBrandReferenceSchema.parse({ name: formData.get("name") });
    // Accept one or many; validate the batch before uploading any.
    const files = collectImageFiles(formData);
    if (!Array.isArray(files)) return files;

    const admin = createSupabaseAdminClient();
    const repo = new BrandReferenceRepository(admin);
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const path = `references/library/${randomUUID()}.${imageExtension(file.type)}`;
      await uploadToBucket(
        admin,
        BUCKETS.brandAssets,
        path,
        Buffer.from(await file.arrayBuffer()),
        file.type,
      );
      // A single upload keeps the label; a batch is numbered ("Logo 1", ...).
      await repo.create({
        name: files.length > 1 ? `${name} ${index + 1}` : name,
        storagePath: path,
        createdBy: profile.id,
      });
    }
    revalidatePath("/images");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

/**
 * One-off reference upload attached to a single generation. Returns the stored
 * path; the composer holds it and submits it with the generate request. The
 * path is server-generated under the oneoff prefix and re-validated in the
 * service before it is ever downloaded.
 */
export async function uploadReferenceImage(input: {
  mimeType: string;
  dataBase64: string;
  sizeBytes: number;
}): Promise<{ error: string | null; path?: string }> {
  try {
    await requireUser();
    if (!ALLOWED_IMAGE_TYPES.has(input.mimeType)) {
      return { error: "Only JPEG, PNG, or WebP images are allowed." };
    }
    if (input.sizeBytes > MAX_AVATAR_BYTES) {
      return { error: "Image exceeds 10MB — resize it and retry." };
    }
    const path = `${ONEOFF_REFERENCE_PREFIX}${randomUUID()}.${imageExtension(input.mimeType)}`;
    if (!isOneoffReferencePath(path)) return { error: "Could not prepare the upload." };

    const admin = createSupabaseAdminClient();
    await uploadToBucket(
      admin,
      BUCKETS.brandAssets,
      path,
      Buffer.from(input.dataBase64, "base64"),
      input.mimeType,
    );
    return { error: null, path };
  } catch (error) {
    return { error: toState(error).error };
  }
}

export async function removeBrandReference(formData: FormData): Promise<void> {
  const profile = await requireUser();
  if (profile.role === "reviewer") return;
  const id = z.uuid().parse(formData.get("referenceId"));
  await new BrandReferenceRepository(createSupabaseAdminClient()).deactivate(id);
  revalidatePath("/images");
}

// ------------------------------------------------------------- generation

const GenerateSchema = z.object({
  prompt: z.string().min(1, "Describe the image you want.").max(4000),
  // Single image: optional design note (styling only; blank follows account design).
  designNote: z.string().max(2000).optional(),
  brand: z.string().min(1),
  platforms: z.array(z.enum(IMAGE_PLATFORMS)).min(1, "Pick at least one platform."),
  brandPresetId: z.uuid("Pick a brand preset first."),
  avatarReferenceIds: z.array(z.uuid()).max(6),
  brandReferenceIds: z.array(z.uuid()).max(6),
  referenceImagePaths: z.array(z.string().max(200)).max(4),
  // One-off uploads of people to depict accurately for this generation.
  personImagePaths: z.array(z.string().max(200)).max(4),
  // Per-slide content for a carousel. 2+ = carousel; 0/1 = single image.
  slides: z.array(z.string().min(1).max(4000)).max(10),
  // Per-slide design notes, parallel to `slides` (may be blank per slide).
  slideDesignNotes: z.array(z.string().max(2000)).max(10),
  // Carousel slide indexes (into `slides`) that should carry the account logo.
  logoSlideIndexes: z.array(z.coerce.number().int().min(0).max(9)).max(10),
});

export async function requestImageGeneration(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    // slides (content) and slideDesignNotes are parallel arrays from the composer.
    // Zip them and keep only pairs with non-empty content, so the design note
    // stays aligned to its slide (a blank design note is valid).
    const rawSlides = formData.getAll("slides").map((s) => String(s).trim());
    const rawSlideNotes = formData.getAll("slideDesignNotes").map((s) => String(s).trim());
    const slidePairs = rawSlides
      .map((content, i) => ({ content, note: rawSlideNotes[i] ?? "" }))
      .filter((pair) => pair.content.length > 0);
    const input = GenerateSchema.parse({
      prompt: formData.get("prompt"),
      designNote: formData.get("designNote") ?? "",
      brand: formData.get("brand"),
      platforms: formData.getAll("platforms"),
      brandPresetId: formData.get("brandPresetId"),
      avatarReferenceIds: formData.getAll("avatarReferenceIds"),
      brandReferenceIds: formData.getAll("brandReferenceIds"),
      referenceImagePaths: formData.getAll("referenceImagePaths"),
      personImagePaths: formData.getAll("personImagePaths"),
      slides: slidePairs.map((pair) => pair.content),
      slideDesignNotes: slidePairs.map((pair) => pair.note),
      logoSlideIndexes: formData.getAll("logoSlideIndexes"),
    });
    await getImageGenerationService().requestGeneration({
      ...input,
      userId: profile.id,
    });
    revalidatePath("/images");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

const RegenerateSchema = z.object({
  itemId: z.uuid(),
  adjustmentNote: z.string().min(1, "Describe what to change.").max(2000),
  // Optional photos to add before re-rolling (fix wrong faces / add references).
  personImagePaths: z.array(z.string().max(200)).max(4),
  referenceImagePaths: z.array(z.string().max(200)).max(4),
  // Carousel: which slide indexes to regenerate (empty = all slides).
  slideIndexes: z.array(z.coerce.number().int().min(0).max(9)).max(10),
  // Carousel: optional per-slide new content (parallel arrays index↔text).
  slidePromptIndexes: z.array(z.coerce.number().int().min(0).max(9)).max(10),
  slidePromptTexts: z.array(z.string().max(4000)).max(10),
  // Carousel: optional per-slide new design note (parallel arrays index↔text).
  slideDesignIndexes: z.array(z.coerce.number().int().min(0).max(9)).max(10),
  slideDesignTexts: z.array(z.string().max(2000)).max(10),
});

export async function regenerateImage(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    const input = RegenerateSchema.parse({
      itemId: formData.get("itemId"),
      adjustmentNote: formData.get("adjustmentNote"),
      personImagePaths: formData.getAll("personImagePaths"),
      referenceImagePaths: formData.getAll("referenceImagePaths"),
      slideIndexes: formData.getAll("slideIndexes"),
      slidePromptIndexes: formData.getAll("slidePromptIndexes"),
      slidePromptTexts: formData.getAll("slidePromptTexts"),
      slideDesignIndexes: formData.getAll("slideDesignIndexes"),
      slideDesignTexts: formData.getAll("slideDesignTexts"),
    });
    // Zip the parallel arrays into { [slideIndex]: newContent }.
    const slidePrompts: Record<number, string> = {};
    input.slidePromptIndexes.forEach((slideIndex, i) => {
      const text = input.slidePromptTexts[i];
      if (typeof text === "string" && text.trim()) slidePrompts[slideIndex] = text;
    });
    // Same for per-slide design notes. A blank here means "leave the note as is";
    // clearing a note isn't supported from regen (keep the original styling).
    const slideDesigns: Record<number, string> = {};
    input.slideDesignIndexes.forEach((slideIndex, i) => {
      const text = input.slideDesignTexts[i];
      if (typeof text === "string" && text.trim()) slideDesigns[slideIndex] = text;
    });
    await getImageGenerationService().requestRegeneration(
      input.itemId,
      input.adjustmentNote,
      profile.id,
      {
        personImagePaths: input.personImagePaths,
        referenceImagePaths: input.referenceImagePaths,
        slideIndexes: input.slideIndexes,
        slidePrompts,
        slideDesigns,
      },
    );
    revalidatePath("/images");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

const EditSchema = z.object({
  itemId: z.uuid(),
  instruction: z.string().min(1, "Describe the change you want.").max(2000),
  // Optional region mask (a one-off upload path); ignored if not the oneoff shape.
  maskPath: z.union([z.string().max(200), z.literal("")]).optional(),
});

/** True in-place edit: feeds the current image back with the instruction. */
export async function editImage(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    const input = EditSchema.parse({
      itemId: formData.get("itemId"),
      instruction: formData.get("instruction"),
      maskPath: formData.get("maskPath") ?? "",
    });
    const maskPath =
      input.maskPath && isOneoffReferencePath(input.maskPath) ? input.maskPath : undefined;
    await getImageGenerationService().requestEdit(
      input.itemId,
      input.instruction,
      profile.id,
      maskPath,
    );
    revalidatePath("/images");
    return OK;
  } catch (error) {
    return toState(error);
  }
}

/** Uploads a region mask PNG (base64) and returns its one-off path. */
export async function uploadEditMask(input: {
  dataBase64: string;
}): Promise<{ error: string | null; path?: string }> {
  // A mask is a small PNG; reuse the one-off reference uploader.
  return uploadReferenceImage({
    mimeType: "image/png",
    dataBase64: input.dataBase64,
    sizeBytes: Math.ceil((input.dataBase64.length * 3) / 4),
  });
}

const SendToQueueSchema = z.object({
  itemId: z.uuid(),
  // Optional planned day (YYYY-MM-DD). Empty = no date. Planning aid only —
  // approval is still required before publishing.
  plannedDate: z.union([z.iso.date(), z.literal("")]).optional(),
});

export async function sendToQueue(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await requireUser();
    const input = SendToQueueSchema.parse({
      itemId: formData.get("itemId"),
      plannedDate: formData.get("plannedDate") ?? "",
    });
    await getImageGenerationService().sendToQueue(
      input.itemId,
      input.plannedDate ? input.plannedDate : null,
    );
    revalidatePath("/images");
    revalidatePath("/queue");
    return OK;
  } catch (error) {
    return toState(error);
  }
}
