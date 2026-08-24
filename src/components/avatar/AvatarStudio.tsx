"use client";

import Image from "next/image";
import { useActionState, useState, useTransition } from "react";
import { requestAvatarVideo, type ActionState } from "@/app/(app)/avatar/actions";
import { uploadReferenceImage } from "@/app/(app)/images/actions";
import { Button } from "@/components/ui/Button";

export interface AvatarOption {
  id: string;
  personName: string;
  thumbUrl: string | null;
}

export interface AccountAvatars {
  slug: string;
  name: string;
  avatars: AvatarOption[];
}

const AVATAR_PLATFORMS = [
  { key: "instagram", label: "Instagram Reel" },
  { key: "facebook", label: "Facebook video" },
  { key: "youtube", label: "YouTube Short" },
] as const;

const initialState: ActionState = { error: null };
const inputClass =
  "w-full rounded-xl border border-border-subtle bg-bg-base px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-border-strong";

export function AvatarStudio({
  accounts,
  canCreate,
  onGenerated,
}: {
  accounts: AccountAvatars[];
  canCreate: boolean;
  /** Called after a generation is queued, so the tab can jump to Generated videos. */
  onGenerated?: () => void;
}) {
  const [brand, setBrand] = useState(accounts[0]?.slug ?? "");
  const [script, setScript] = useState("");
  const [avatarId, setAvatarId] = useState("");
  const [platforms, setPlatforms] = useState<Set<string>>(new Set(["instagram"]));
  const [bgMode, setBgMode] = useState<"original" | "color" | "image">("original");
  const [backgroundColor, setBackgroundColor] = useState("#1A0F3A");
  const [bgImage, setBgImage] = useState<{ path: string; previewUrl: string } | null>(null);
  const [bgUploading, startBgUpload] = useTransition();
  const [bgError, setBgError] = useState<string | null>(null);
  const [motionPrompt, setMotionPrompt] = useState("");
  const [expressiveness, setExpressiveness] = useState<"low" | "medium" | "high">("high");
  const [subtitles, setSubtitles] = useState(true);
  const [cover, setCover] = useState<{ path: string; previewUrl: string } | null>(null);
  const [coverUploading, startCoverUpload] = useTransition();
  const [coverError, setCoverError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [state, action, isSubmitting] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await requestAvatarVideo(prev, formData);
      if (result.ok) {
        setScript("");
        setAvatarId("");
        setMotionPrompt("");
        setCover(null);
        onGenerated?.();
      }
      return result;
    },
    initialState,
  );

  const current = accounts.find((a) => a.slug === brand);
  const avatars = current?.avatars ?? [];

  const togglePlatform = (key: string) =>
    setPlatforms((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const handleBgFile = (file: File | undefined) => {
    if (!file) return;
    setBgError(null);
    startBgUpload(async () => {
      const dataBase64 = await fileToBase64(file);
      const result = await uploadReferenceImage({
        mimeType: file.type,
        dataBase64,
        sizeBytes: file.size,
      });
      if (result.error || !result.path) {
        setBgError(result.error ?? "Upload failed.");
        return;
      }
      setBgImage({ path: result.path, previewUrl: `data:${file.type};base64,${dataBase64}` });
    });
  };

  const handleCoverFile = (file: File | undefined) => {
    if (!file) return;
    setCoverError(null);
    startCoverUpload(async () => {
      const dataBase64 = await fileToBase64(file);
      const result = await uploadReferenceImage({
        mimeType: file.type,
        dataBase64,
        sizeBytes: file.size,
      });
      if (result.error || !result.path) {
        setCoverError(result.error ?? "Upload failed.");
        return;
      }
      setCover({ path: result.path, previewUrl: `data:${file.type};base64,${dataBase64}` });
    });
  };

  if (accounts.length === 0) {
    return (
      <section className="rounded-2xl border border-border-subtle bg-bg-raised p-6">
        <p className="text-sm text-text-faint">No accounts yet. Create one first.</p>
      </section>
    );
  }

  return (
    <form action={action} className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <input type="hidden" name="brand" value={brand} />
      <input type="hidden" name="avatarReferenceId" value={avatarId} />
      {[...platforms].map((p) => (
        <input key={p} type="hidden" name="platforms" value={p} />
      ))}
      <input type="hidden" name="backgroundColor" value={bgMode === "color" ? backgroundColor : ""} />
      <input
        type="hidden"
        name="backgroundImagePath"
        value={bgMode === "image" && bgImage ? bgImage.path : ""}
      />
      <input type="hidden" name="motionPrompt" value={motionPrompt} />
      <input type="hidden" name="expressiveness" value={expressiveness} />
      <input type="hidden" name="subtitles" value={subtitles ? "on" : ""} />
      <input type="hidden" name="coverImagePath" value={cover ? cover.path : ""} />

      {/* Left: script + caption */}
      <section className="flex flex-col gap-4 rounded-2xl border border-border-subtle bg-bg-raised p-5">
        <div>
          <span className="type-utility font-semibold text-text-primary">Account / page</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {accounts.map((account) => (
              <button
                key={account.slug}
                type="button"
                onClick={() => {
                  setBrand(account.slug);
                  setAvatarId("");
                }}
                className={`rounded-full px-3.5 py-1.5 font-display text-[13px] font-medium transition-colors ${
                  brand === account.slug
                    ? "bg-primary text-text-primary"
                    : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                }`}
              >
                {account.name}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1.5 text-sm text-text-secondary">
          Script (what the avatar says)
          <textarea
            name="script"
            rows={6}
            required
            value={script}
            onChange={(event) => setScript(event.target.value)}
            placeholder="e.g. Most agencies lose clients in week one because there is no onboarding system. Here are the three messages that fix it."
            className={`${inputClass} resize-y`}
          />
          <span className="text-[12px] text-text-faint">
            Our AI polishes your script for natural spoken delivery and emotional pacing before it
            goes to the avatar, so the spoken wording may differ slightly from what you type.
          </span>
        </label>

        <div>
          <span className="type-utility font-semibold text-text-primary">Post to</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {AVATAR_PLATFORMS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => togglePlatform(option.key)}
                aria-pressed={platforms.has(option.key)}
                className={`rounded-full px-3.5 py-1.5 font-display text-[13px] font-medium transition-colors ${
                  platforms.has(option.key)
                    ? "bg-primary text-text-primary"
                    : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[13px] text-text-faint">
            Vertical 9:16 video — a Reel on Instagram, a video on Facebook, a Short on YouTube.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((open) => !open)}
          aria-expanded={showAdvanced}
          className="flex w-fit items-center gap-1.5 text-[13px] font-medium text-primary-soft hover:text-primary-bright"
        >
          <span className="text-base leading-none">{showAdvanced ? "−" : "+"}</span>
          Advanced options (background, motion, cover, subtitles)
        </button>

        {showAdvanced ? (
          <>
        <div>
          <span className="type-utility font-semibold text-text-primary">Background</span>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {(
              [
                { key: "original", label: "Keep original" },
                { key: "color", label: "Solid color" },
                { key: "image", label: "Upload image" },
              ] as const
            ).map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setBgMode(option.key)}
                aria-pressed={bgMode === option.key}
                className={`rounded-full px-3.5 py-1.5 font-display text-[13px] font-medium transition-colors ${
                  bgMode === option.key
                    ? "bg-primary text-text-primary"
                    : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {bgMode === "color" ? (
            <span className="mt-2 flex items-center gap-2">
              <input
                type="color"
                value={backgroundColor}
                onChange={(event) => setBackgroundColor(event.target.value)}
                aria-label="Background color"
                className="h-8 w-10 cursor-pointer rounded border border-border-subtle bg-bg-base"
              />
              <span className="text-[13px] text-text-faint">{backgroundColor}</span>
            </span>
          ) : null}

          {bgMode === "image" ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {bgImage ? (
                <span className="relative">
                  <Image
                    src={bgImage.previewUrl}
                    alt="Background"
                    width={64}
                    height={64}
                    unoptimized
                    className="h-16 w-16 rounded-lg object-cover"
                  />
                  <button
                    type="button"
                    aria-label="Remove background"
                    onClick={() => setBgImage(null)}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-bg-nav text-[13px] text-text-secondary hover:text-danger"
                  >
                    ×
                  </button>
                </span>
              ) : null}
              <label className="cursor-pointer rounded-full border border-border-subtle px-3.5 py-1.5 font-display text-[13px] font-medium text-text-primary hover:bg-bg-hover">
                {bgUploading ? "Uploading…" : bgImage ? "Replace image" : "Choose image"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(event) => handleBgFile(event.target.files?.[0] ?? undefined)}
                />
              </label>
              {bgError ? <span className="text-[13px] text-danger">{bgError}</span> : null}
            </div>
          ) : null}

          <p className="mt-1 text-[13px] text-text-faint">
            &ldquo;Keep original&rdquo; uses the photo&rsquo;s own background. Solid color or an
            uploaded image replaces it (use a vertical/tall image for Reels).
          </p>
        </div>

        <div>
          <span className="type-utility font-semibold text-text-primary">Motion &amp; energy</span>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={motionPrompt}
              onChange={(event) => setMotionPrompt(event.target.value)}
              placeholder="e.g. speaking to camera with natural hand gestures"
              maxLength={300}
              className={`${inputClass} flex-1`}
            />
            <select
              value={expressiveness}
              onChange={(event) =>
                setExpressiveness(event.target.value as "low" | "medium" | "high")
              }
              aria-label="Movement energy"
              className={`${inputClass} sm:w-40`}
            >
              <option value="low">Energy: Low</option>
              <option value="medium">Energy: Medium</option>
              <option value="high">Energy: High</option>
            </select>
          </div>
          <p className="mt-1 text-[13px] text-text-faint">
            Describes how the avatar moves (gestures, body language). Leave the box blank for natural
            gestures. Higher energy = more movement.
          </p>
        </div>

        <div>
          <span className="type-utility font-semibold text-text-primary">
            Thumbnail / cover (optional)
          </span>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            {cover ? (
              <span className="relative">
                <Image
                  src={cover.previewUrl}
                  alt="Cover"
                  width={54}
                  height={96}
                  unoptimized
                  className="h-24 w-[54px] rounded-lg object-cover"
                />
                <button
                  type="button"
                  aria-label="Remove cover"
                  onClick={() => setCover(null)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-bg-nav text-[13px] text-text-secondary hover:text-danger"
                >
                  ×
                </button>
              </span>
            ) : null}
            <label className="cursor-pointer rounded-full border border-border-subtle px-3.5 py-1.5 font-display text-[13px] font-medium text-text-primary hover:bg-bg-hover">
              {coverUploading ? "Uploading…" : cover ? "Replace cover" : "Upload cover"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => handleCoverFile(event.target.files?.[0] ?? undefined)}
              />
            </label>
            {coverError ? <span className="text-[13px] text-danger">{coverError}</span> : null}
          </div>
          <p className="mt-1 text-[13px] text-text-faint">
            The image shown before the video plays. Use a vertical 9:16 image for Reels. Instagram
            uses it as the Reel cover; Facebook uses it when it can, otherwise it picks a frame.
          </p>
        </div>

        <div>
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={subtitles}
              onChange={(event) => setSubtitles(event.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-sm text-text-primary">Plan to add subtitles</span>
          </label>
          <p className="mt-1 pl-6 text-[13px] text-text-faint">
            The video is generated first (faster). In the Approval Queue you’ll then see a
            “Generate captions” button to burn in bold subtitles — great for silent autoplay.
          </p>
        </div>
          </>
        ) : null}

        {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
        {state.ok ? (
          <p className="text-sm text-success">
            Generating. It appears in the Generated videos tab to review — add a caption there and
            send it to the Approval Queue.
          </p>
        ) : null}

        {canCreate ? (
          <Button
            type="submit"
            isLoading={isSubmitting}
            disabled={!script.trim() || platforms.size === 0}
            className="self-start"
          >
            Create avatar video
          </Button>
        ) : (
          <p className="text-[13px] text-text-faint">Reviewers can’t create content.</p>
        )}
      </section>

      {/* Right: pick the person */}
      <section className="h-fit rounded-2xl border border-border-subtle bg-bg-raised p-5">
        <span className="type-utility font-semibold text-text-primary">Avatar (who appears)</span>
        <p className="mt-1 text-[13px] text-text-faint">
          Pick a person added to this account. Their likeness is used for the video.
        </p>
        {avatars.length === 0 ? (
          <p className="mt-3 text-sm text-text-faint">
            No people for this account yet. Add photos on the account page.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {avatars.map((avatar) => {
              const selected = avatarId === avatar.id;
              return (
                <button
                  key={avatar.id}
                  type="button"
                  onClick={() => setAvatarId(selected ? "" : avatar.id)}
                  aria-pressed={selected}
                  className={`relative overflow-hidden rounded-xl border transition-colors ${
                    selected ? "border-primary" : "border-border-subtle hover:bg-bg-hover"
                  }`}
                >
                  {avatar.thumbUrl ? (
                    <Image
                      src={avatar.thumbUrl}
                      alt={avatar.personName}
                      width={96}
                      height={96}
                      unoptimized
                      className="aspect-square w-full object-cover"
                    />
                  ) : (
                    <span className="flex aspect-square w-full items-center justify-center bg-bg-base text-[11px] text-text-faint">
                      {avatar.personName}
                    </span>
                  )}
                  <span
                    className={`type-utility absolute inset-x-0 bottom-0 truncate px-1 py-0.5 ${
                      selected ? "bg-primary text-text-primary" : "bg-bg-nav/80 text-text-secondary"
                    }`}
                  >
                    {avatar.personName}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-[11px] text-text-faint">
          Leave unselected to use this account’s default person.
        </p>
      </section>
    </form>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
