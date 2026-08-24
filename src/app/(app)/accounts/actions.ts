"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { listPages } from "@/lib/meta";
import { connectMetaPage } from "@/lib/metaConnect";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BUCKETS, removeFromBucket, uploadToBucket } from "@/lib/supabase/storage";
import { AccountRepository } from "@/repositories/AccountRepository";
import { AvatarReferenceRepository } from "@/repositories/AvatarReferenceRepository";
import { BrandReferenceRepository } from "@/repositories/BrandReferenceRepository";
import { ProfileRepository } from "@/repositories/ProfileRepository";
import { SocialConnectionRepository } from "@/repositories/SocialConnectionRepository";
import type { Profile } from "@/lib/domain";

export interface ActionState {
  error: string | null;
  ok?: boolean;
}

const OK: ActionState = { error: null, ok: true };
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_UPLOAD = 20;

function imageExt(mimeType: string): string {
  return mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
}

/**
 * Pulls every chosen image file from the form (the input is `multiple`), and
 * validates the whole batch up front. Returns the files, or an ActionState error
 * if any file is missing/oversized/wrong-type — nothing is uploaded on error.
 */
function collectFiles(formData: FormData): File[] | ActionState {
  const files = formData.getAll("file").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length === 0) return { error: "Choose at least one image to upload." };
  if (files.length > MAX_FILES_PER_UPLOAD) {
    return { error: `Upload up to ${MAX_FILES_PER_UPLOAD} images at once.` };
  }
  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return { error: "Only JPEG, PNG, or WebP images are allowed." };
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return { error: `"${file.name}" exceeds 10MB — resize it and retry.` };
    }
  }
  return files;
}

function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return /rate|429|too many|timeout|temporarily|network|fetch failed|econn|50[234]/.test(message);
}

/** Retries a transient failure (rate limit / network) a few times with backoff. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts - 1 || !isTransient(error)) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

/** A concise, user-safe reason for an upload/store failure (no internals/secrets). */
function uploadFailureReason(error: unknown): string {
  const raw = (error instanceof Error ? error.message : "").replace(/^Upload failed:\s*/i, "").trim();
  if (!raw) return "upload failed";
  if (/rate|429|too many/i.test(raw)) return "rate limited — wait a moment and retry the rest";
  if (/exceeded|maximum|too large|size limit/i.test(raw)) return "rejected by storage (too large)";
  if (/row-level security|\brls\b|not authorized|permission|forbidden/i.test(raw)) {
    return "not permitted for your role";
  }
  return raw.slice(0, 140);
}

/**
 * Uploads a validated image batch ONE AT A TIME — each stored before the next, so
 * a failure or rate limit mid-batch never loses the earlier ones — with a short
 * backoff retry per file for transient errors. A fresh storage path is generated
 * on each attempt, so a retry never trips an "already exists" upload. Returns how
 * many saved and which files failed (and why) for a real error message.
 */
async function uploadImageBatch(
  files: File[],
  storeOne: (file: File, index: number) => Promise<void>,
): Promise<{ uploaded: number; failures: { name: string; reason: string }[] }> {
  let uploaded = 0;
  const failures: { name: string; reason: string }[] = [];
  for (let index = 0; index < files.length; index += 1) {
    try {
      await withRetry(() => storeOne(files[index], index));
      uploaded += 1;
    } catch (error) {
      failures.push({ name: files[index].name, reason: uploadFailureReason(error) });
    }
  }
  return { uploaded, failures };
}

/** Turns a batch result into a clear ActionState (full success → OK). */
function batchResultToState(
  result: { uploaded: number; failures: { name: string; reason: string }[] },
  total: number,
): ActionState {
  if (result.failures.length === 0) return OK;
  const names = result.failures
    .slice(0, 3)
    .map((failure) => `"${failure.name}"`)
    .join(", ");
  const more = result.failures.length > 3 ? ` +${result.failures.length - 3} more` : "";
  const saved = result.uploaded > 0 ? `${result.uploaded} of ${total} saved. ` : "";
  return { error: `${saved}Couldn't upload ${names}${more}: ${result.failures[0].reason}` };
}

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
  const message = error instanceof Error ? error.message : "";
  if (/duplicate|unique/i.test(message)) {
    return { error: "An account with that name already exists. Try a different name." };
  }
  return { error: "Something went wrong — try again." };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function revalidateAccountConsumers() {
  // The account picker appears on every generating tab.
  for (const path of ["/accounts", "/images", "/content", "/queue"]) revalidatePath(path);
}

const AccountSchema = z.object({
  name: z.string().min(1, "Give the account a name.").max(120),
  description: z.string().max(4000),
  visualIdentity: z.string().max(4000),
});

export async function createAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") return { error: "Reviewers cannot add accounts." };
    const input = AccountSchema.parse({
      name: formData.get("name"),
      description: formData.get("description") ?? "",
      visualIdentity: formData.get("visualIdentity") ?? "",
    });
    const slug = slugify(input.name);
    if (!slug) return { error: "Use letters or numbers in the name." };

    const admin = createSupabaseAdminClient();
    await new AccountRepository(admin).create({
      name: input.name,
      slug,
      description: input.description,
      visualIdentity: input.visualIdentity,
      createdBy: profile.id,
    });
    revalidateAccountConsumers();
    return OK;
  } catch (error) {
    return toState(error);
  }
}

const UpdateAccountSchema = AccountSchema.extend({ slug: z.string().min(1) });

export async function updateAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") return { error: "Reviewers cannot edit accounts." };
    const input = UpdateAccountSchema.parse({
      slug: formData.get("slug"),
      name: formData.get("name"),
      description: formData.get("description") ?? "",
      visualIdentity: formData.get("visualIdentity") ?? "",
    });
    const admin = createSupabaseAdminClient();
    await new AccountRepository(admin).update(input.slug, {
      name: input.name,
      description: input.description,
      visualIdentity: input.visualIdentity,
    });
    revalidateAccountConsumers();
    revalidatePath(`/accounts/${input.slug}`);
    return OK;
  } catch (error) {
    return toState(error);
  }
}

const UploadRefSchema = z.object({
  accountSlug: z.string().min(1),
  name: z.string().min(1).max(80),
});

export async function uploadAccountReference(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") return { error: "Reviewers cannot manage reference photos." };
    const input = UploadRefSchema.parse({
      accountSlug: formData.get("accountSlug"),
      name: formData.get("name"),
    });
    // Accept one or many files; validate the batch before uploading any.
    const files = collectFiles(formData);
    if (!Array.isArray(files)) return files;

    const admin = createSupabaseAdminClient();
    const repo = new BrandReferenceRepository(admin);
    // One at a time (store before the next), retrying transient rate limits.
    // Label each file: single upload keeps the name; a batch gets "name 2", etc.
    const result = await uploadImageBatch(files, async (file, index) => {
      const path = `references/library/${randomUUID()}.${imageExt(file.type)}`;
      await uploadToBucket(admin, BUCKETS.brandAssets, path, Buffer.from(await file.arrayBuffer()), file.type);
      await repo.create({
        name: files.length > 1 ? `${input.name} ${index + 1}` : input.name,
        storagePath: path,
        createdBy: profile.id,
        accountSlug: input.accountSlug,
      });
    });
    revalidatePath(`/accounts/${input.accountSlug}`);
    return batchResultToState(result, files.length);
  } catch (error) {
    return toState(error);
  }
}

export async function removeAccountReference(formData: FormData): Promise<void> {
  const profile = await requireUser();
  if (profile.role === "reviewer") return;
  const id = z.uuid().parse(formData.get("referenceId"));
  const slug = z.string().min(1).parse(formData.get("accountSlug"));
  await new BrandReferenceRepository(createSupabaseAdminClient()).deactivate(id);
  revalidatePath(`/accounts/${slug}`);
}

/**
 * Designates a reference photo as the account's logo (or clears it). The logo
 * is always included in that account's generations and the prompt tells the
 * model to place it unaltered. Only one logo per account.
 */
export async function setAccountLogo(formData: FormData): Promise<void> {
  const profile = await requireUser();
  if (profile.role === "reviewer") return;
  const id = z.uuid().parse(formData.get("referenceId"));
  const slug = z.string().min(1).parse(formData.get("accountSlug"));
  const makeLogo = formData.get("makeLogo") === "true";
  await new BrandReferenceRepository(createSupabaseAdminClient()).setLogo(id, slug, makeLogo);
  revalidatePath(`/accounts/${slug}`);
  revalidatePath("/images");
}

// ------------------------------------------------------------- outro clip

const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const MAX_OUTRO_BYTES = 50 * 1024 * 1024;

/**
 * Uploads (or replaces) the account's outro clip — a short mp4 appended to the
 * end of avatar videos on demand ("Add outro" in the queue). Admin/editor only.
 */
export async function uploadAccountOutro(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role === "reviewer") return { error: "Reviewers cannot manage the outro." };
    const slug = z.string().min(1).parse(formData.get("accountSlug"));
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a video file." };
    if (!ALLOWED_VIDEO_TYPES.has(file.type)) {
      return { error: "Use an mp4, mov, or webm video." };
    }
    if (file.size > MAX_OUTRO_BYTES) return { error: "Outro must be under 50 MB." };

    const admin = createSupabaseAdminClient();
    const repo = new AccountRepository(admin);
    const account = await repo.getBySlug(slug);
    if (!account) return { error: "Account not found." };

    const ext = file.type === "video/quicktime" ? "mov" : file.type === "video/webm" ? "webm" : "mp4";
    const path = `outros/${slug}/${randomUUID()}.${ext}`;
    await uploadToBucket(admin, BUCKETS.brandAssets, path, Buffer.from(await file.arrayBuffer()), file.type);

    // Best-effort cleanup of the previous outro before swapping the pointer.
    if (account.outroVideoPath) {
      await removeFromBucket(admin, BUCKETS.brandAssets, [account.outroVideoPath]).catch(() => {});
    }
    await repo.setOutroVideoPath(slug, path);
    revalidatePath(`/accounts/${slug}`);
    return OK;
  } catch (error) {
    return toState(error);
  }
}

export async function removeAccountOutro(formData: FormData): Promise<void> {
  const profile = await requireUser();
  if (profile.role === "reviewer") return;
  const slug = z.string().min(1).parse(formData.get("accountSlug"));
  const admin = createSupabaseAdminClient();
  const repo = new AccountRepository(admin);
  const account = await repo.getBySlug(slug);
  if (account?.outroVideoPath) {
    await removeFromBucket(admin, BUCKETS.brandAssets, [account.outroVideoPath]).catch(() => {});
  }
  await repo.setOutroVideoPath(slug, null);
  revalidatePath(`/accounts/${slug}`);
}

// ------------------------------------------------- people (avatar likenesses)

const PersonSchema = z.object({
  personName: z.string().min(1).max(80),
  accountSlug: z.string().min(1),
});

/**
 * A photo of a real person (e.g. an owner) who can appear in generated posts.
 * Stored as an avatar reference so the composer can select them and generation
 * depicts them accurately. Admin-only (a real likeness). Scoped to the account
 * it's added under. Upload several photos per person for the model to draw from.
 */
export async function uploadPersonReference(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const profile = await requireUser();
    if (profile.role !== "admin") return { error: "Only admins can manage people." };
    const { personName, accountSlug } = PersonSchema.parse({
      personName: formData.get("personName"),
      accountSlug: formData.get("accountSlug"),
    });
    // Several photos per person help the model use the best angle, so accept a
    // batch. Validate all before uploading any.
    const files = collectFiles(formData);
    if (!Array.isArray(files)) return files;

    const personSlug = personName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const admin = createSupabaseAdminClient();
    const repo = new AvatarReferenceRepository(admin);
    // One at a time (store before the next), retrying transient rate limits.
    const result = await uploadImageBatch(files, async (file) => {
      const path = `${personSlug}/${randomUUID()}.${imageExt(file.type)}`;
      await uploadToBucket(admin, BUCKETS.avatarReferences, path, Buffer.from(await file.arrayBuffer()), file.type);
      await repo.create({ personName, storagePath: path, accountSlug });
    });

    revalidatePath(`/accounts/${accountSlug}`);
    revalidatePath("/accounts");
    revalidatePath("/images");
    return batchResultToState(result, files.length);
  } catch (error) {
    return toState(error);
  }
}

export async function removePersonReference(formData: FormData): Promise<void> {
  const profile = await requireUser();
  if (profile.role !== "admin") return;
  const id = z.uuid().parse(formData.get("referenceId"));
  const slug = formData.get("accountSlug");
  await new AvatarReferenceRepository(createSupabaseAdminClient()).deactivate(id);
  if (typeof slug === "string" && slug) revalidatePath(`/accounts/${slug}`);
  revalidatePath("/images");
}

// -------------------------------------------------------- social connections

/** Disconnects Meta (removes the Facebook + Instagram tokens for the account). */
export async function disconnectMeta(formData: FormData): Promise<void> {
  const profile = await requireUser();
  if (profile.role === "reviewer") return;
  const slug = z.string().min(1).parse(formData.get("accountSlug"));
  const repo = new SocialConnectionRepository(createSupabaseAdminClient());
  await repo.remove(slug, "facebook");
  await repo.remove(slug, "instagram");
  await repo.remove(slug, "meta_pending");
  revalidatePath(`/accounts/${slug}`);
}

/**
 * Completes a multi-Page Meta connect: the callback stashed the user token +
 * candidate Pages under `meta_pending`; here the admin picks which Page maps to
 * this account. Re-fetches Pages with the stored token to get a fresh Page
 * access token, stores facebook (+ instagram) for the chosen one, and clears
 * the pending record.
 */
export async function chooseMetaPage(formData: FormData): Promise<void> {
  const profile = await requireUser();
  if (profile.role === "reviewer") return;
  const slug = z.string().min(1).parse(formData.get("accountSlug"));
  const pageId = z.string().min(1).parse(formData.get("pageId"));

  const repo = new SocialConnectionRepository(createSupabaseAdminClient());
  const pending = await repo.get(slug, "meta_pending");
  if (!pending) {
    revalidatePath(`/accounts/${slug}`);
    return;
  }
  // The stored access_token is the (decrypted) long-lived user token.
  const pages = await listPages(pending.accessToken).catch(() => []);
  const page = pages.find((candidate) => candidate.id === pageId);
  if (!page) {
    revalidatePath(`/accounts/${slug}`);
    return;
  }
  await connectMetaPage({ repo, accountSlug: slug, userId: profile.id, page, expiresInS: null });
  revalidatePath(`/accounts/${slug}`);
}

/** Disconnects LinkedIn (removes the Company Page token for the account). */
export async function disconnectLinkedIn(formData: FormData): Promise<void> {
  const profile = await requireUser();
  if (profile.role === "reviewer") return;
  const slug = z.string().min(1).parse(formData.get("accountSlug"));
  await new SocialConnectionRepository(createSupabaseAdminClient()).remove(slug, "linkedin");
  revalidatePath(`/accounts/${slug}`);
}

/** Disconnects YouTube (removes the channel token for the account). */
export async function disconnectYouTube(formData: FormData): Promise<void> {
  const profile = await requireUser();
  if (profile.role === "reviewer") return;
  const slug = z.string().min(1).parse(formData.get("accountSlug"));
  await new SocialConnectionRepository(createSupabaseAdminClient()).remove(slug, "youtube");
  revalidatePath(`/accounts/${slug}`);
}
