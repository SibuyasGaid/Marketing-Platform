"use client";

import Image from "next/image";
import { useActionState, useRef, useState, useTransition } from "react";
import {
  createPreset,
  deletePreset,
  removeBrandReference,
  requestImageGeneration,
  updatePreset,
  uploadAvatarReference,
  uploadBrandReference,
  uploadReferenceImage,
  type ActionState,
} from "@/app/(app)/images/actions";
import { Button } from "@/components/ui/Button";
import { SubmitText } from "@/components/ui/SubmitButton";
import { IMAGE_PLATFORMS, type Brand, type ImagePlatform } from "@/lib/domain";

export interface AccountOption {
  slug: string;
  name: string;
}

export interface PresetView {
  id: string;
  name: string;
  tone: string;
  palette: string[];
  styleRules: string;
  campaignContext: string | null;
}

export interface AvatarView {
  id: string;
  personName: string;
  thumbUrl: string | null;
  /** Account this person belongs to; null = shown for every account. */
  accountSlug: string | null;
}

export interface BrandReferenceView {
  id: string;
  name: string;
  thumbUrl: string | null;
}

export interface OneoffRef {
  path: string;
  previewUrl: string;
  name: string;
}

const initialState: ActionState = { error: null };

const inputClass =
  "w-full rounded-xl border border-border-subtle bg-bg-base px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-border-strong";

export function ImageWorkspace({
  presets,
  avatars,
  brandReferences,
  accounts,
  isAdmin,
  canManageReferences,
}: {
  presets: PresetView[];
  avatars: AvatarView[];
  brandReferences: BrandReferenceView[];
  accounts: AccountOption[];
  isAdmin: boolean;
  canManageReferences: boolean;
}) {
  const [selectedPresetId, setSelectedPresetId] = useState<string>(presets[0]?.id ?? "");
  const [selectedAvatarIds, setSelectedAvatarIds] = useState<Set<string>>(new Set());
  const [selectedBrandRefIds, setSelectedBrandRefIds] = useState<Set<string>>(new Set());
  const [oneoffRefs, setOneoffRefs] = useState<OneoffRef[]>([]);
  // People to feature in this specific post (faces matched, not style refs).
  const [personRefs, setPersonRefs] = useState<OneoffRef[]>([]);
  const [brand, setBrand] = useState<Brand>(accounts[0]?.slug ?? "");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<ImagePlatform>>(
    new Set(["instagram"]),
  );
  const [isPresetFormOpen, setIsPresetFormOpen] = useState(false);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [isCarousel, setIsCarousel] = useState(false);
  // Per-slide CONTENT (the exact text to render); start with two (carousel needs 2+).
  const [slides, setSlides] = useState<string[]>(["", ""]);
  // Per-slide DESIGN NOTES (styling only), parallel to slides. Blank = account design.
  const [slideDesigns, setSlideDesigns] = useState<string[]>(["", ""]);
  // Single-image design note (styling only). Blank = follow the account design.
  const [designNote, setDesignNote] = useState("");
  // Which slide indexes get the account logo. Default: cover (slide 0) only.
  const [logoSlides, setLogoSlides] = useState<Set<number>>(new Set([0]));

  const [generateState, generateAction, isGenerating] = useActionState(
    requestImageGeneration,
    initialState,
  );

  function toggle<T>(setter: React.Dispatch<React.SetStateAction<Set<T>>>) {
    return (value: T) => {
      setter((current) => {
        const next = new Set(current);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return next;
      });
    };
  }
  const toggleAvatar = toggle(setSelectedAvatarIds);
  const toggleBrandRef = toggle(setSelectedBrandRefIds);
  const togglePlatform = toggle(setSelectedPlatforms);

  // A carousel needs at least two non-empty slides; single mode has none to check.
  const hasEnoughSlides = !isCarousel || slides.filter((slide) => slide.trim()).length >= 2;

  // People are per-account: show this account's people plus any legacy shared
  // ones (accountSlug null). Keeps the composer's picker relevant to the brand.
  const visibleAvatars = avatars.filter(
    (avatar) => avatar.accountSlug === null || avatar.accountSlug === brand,
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      {/* Left column: preset picker + avatar library */}
      <div className="flex flex-col gap-4">
        <section className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-text-primary">
              Brand preset
            </h3>
            <button
              type="button"
              onClick={() => setIsPresetFormOpen((open) => !open)}
              className="text-[13px] text-primary-soft hover:text-primary-bright"
            >
              {isPresetFormOpen ? "Close" : "+ New preset"}
            </button>
          </div>

          {isPresetFormOpen ? <PresetForm onDone={() => setIsPresetFormOpen(false)} /> : null}

          <div className="mt-3 flex flex-col gap-2">
            {presets.length === 0 && !isPresetFormOpen ? (
              <p className="text-sm text-text-faint">
                No presets yet. Create one to start generating.
              </p>
            ) : null}
            {presets.map((preset) =>
              editingPresetId === preset.id ? (
                <PresetForm
                  key={preset.id}
                  preset={preset}
                  onDone={() => setEditingPresetId(null)}
                />
              ) : (
                <div
                  key={preset.id}
                  className={`rounded-xl border p-3 transition-colors ${
                    selectedPresetId === preset.id
                      ? "border-border-strong bg-bg-hover"
                      : "border-border-subtle hover:bg-bg-hover"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedPresetId(preset.id)}
                    className="block w-full text-left"
                  >
                    <span className="flex h-2 overflow-hidden rounded-full">
                      {preset.palette.length > 0 ? (
                        preset.palette.map((color, index) => (
                          <span
                            key={`${color}-${index}`}
                            className="flex-1"
                            style={{ backgroundColor: color }}
                          />
                        ))
                      ) : (
                        <span className="flex-1 bg-bg-hover" />
                      )}
                    </span>
                    <span className="mt-2 block text-sm font-medium text-text-primary">
                      {preset.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-text-faint">
                      {preset.tone}
                    </span>
                  </button>
                  {canManageReferences ? (
                    <div className="mt-2 flex items-center gap-3 border-t border-border-subtle pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingPresetId(preset.id);
                          setIsPresetFormOpen(false);
                        }}
                        className="text-[13px] text-primary-soft hover:text-primary-bright"
                      >
                        Edit
                      </button>
                      <form action={deletePreset}>
                        <input type="hidden" name="presetId" value={preset.id} />
                        <SubmitText
                          spinner
                          pendingLabel="Deleting…"
                          className="text-[13px] text-text-faint hover:text-danger"
                          aria-label={`Delete ${preset.name}`}
                        >
                          Delete
                        </SubmitText>
                      </form>
                    </div>
                  ) : null}
                </div>
              ),
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
          <h3 className="font-display text-base font-semibold text-text-primary">
            Avatar references
          </h3>
          <p className="mt-1 text-[13px] text-text-faint">
            Select who should appear in the image. Shows people added to this account.
            {visibleAvatars.length > 0 ? ` (${visibleAvatars.length})` : ""}
          </p>
          <div className="mt-3 grid max-h-80 grid-cols-3 gap-2 overflow-y-auto pr-1">
            {visibleAvatars.map((avatar) => {
              const isSelected = selectedAvatarIds.has(avatar.id);
              return (
                <button
                  key={avatar.id}
                  type="button"
                  onClick={() => toggleAvatar(avatar.id)}
                  aria-pressed={isSelected}
                  className={`relative overflow-hidden rounded-xl border transition-colors ${
                    isSelected ? "border-border-strong" : "border-border-subtle"
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
                    <span className="flex aspect-square w-full items-center justify-center bg-bg-base text-xs text-text-faint">
                      {avatar.personName}
                    </span>
                  )}
                  <span
                    className={`type-utility absolute inset-x-0 bottom-0 truncate px-1 py-0.5 ${
                      isSelected ? "bg-primary text-text-primary" : "bg-bg-nav/80 text-text-secondary"
                    }`}
                  >
                    {avatar.personName}
                  </span>
                </button>
              );
            })}
          </div>
          {visibleAvatars.length === 0 ? (
            <p className="mt-2 text-sm text-text-faint">
              No people for this account yet
              {isAdmin ? ". Add one below or on the account page." : ". Ask an admin to add one."}
            </p>
          ) : null}

          {isAdmin ? <AvatarUploadForm accountSlug={brand} /> : null}
        </section>

        <section className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
          <h3 className="font-display text-base font-semibold text-text-primary">
            Brand references
          </h3>
          <p className="mt-1 text-[13px] text-text-faint">
            Reusable logos, product shots, or style boards to guide the look.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {brandReferences.map((ref) => {
              const isSelected = selectedBrandRefIds.has(ref.id);
              return (
                <div key={ref.id} className="relative">
                  <button
                    type="button"
                    onClick={() => toggleBrandRef(ref.id)}
                    aria-pressed={isSelected}
                    className={`relative block w-full overflow-hidden rounded-xl border transition-colors ${
                      isSelected ? "border-border-strong" : "border-border-subtle"
                    }`}
                  >
                    {ref.thumbUrl ? (
                      <Image
                        src={ref.thumbUrl}
                        alt={ref.name}
                        width={96}
                        height={96}
                        unoptimized
                        className="aspect-square w-full object-cover"
                      />
                    ) : (
                      <span className="flex aspect-square w-full items-center justify-center bg-bg-base text-xs text-text-faint">
                        {ref.name}
                      </span>
                    )}
                    <span
                      className={`type-utility absolute inset-x-0 bottom-0 truncate px-1 py-0.5 ${
                        isSelected ? "bg-primary text-text-primary" : "bg-bg-nav/80 text-text-secondary"
                      }`}
                    >
                      {ref.name}
                    </span>
                  </button>
                  {canManageReferences ? (
                    <form action={removeBrandReference} className="absolute right-1 top-1">
                      <input type="hidden" name="referenceId" value={ref.id} />
                      <SubmitText
                        spinner
                        aria-label={`Remove ${ref.name}`}
                        className="flex h-5 w-5 items-center justify-center rounded-full bg-bg-nav/80 text-[13px] text-text-secondary hover:text-danger"
                      >
                        ×
                      </SubmitText>
                    </form>
                  ) : null}
                </div>
              );
            })}
          </div>
          {brandReferences.length === 0 ? (
            <p className="mt-2 text-sm text-text-faint">
              No saved references yet
              {canManageReferences ? ". Add one below." : "."}
            </p>
          ) : null}
          {canManageReferences ? <BrandReferenceUploadForm /> : null}
        </section>
      </div>

      {/* Right column: prompt composer */}
      <section className="h-fit rounded-2xl border border-border-subtle bg-bg-raised p-5">
        <h3 className="font-display text-base font-semibold text-text-primary">Compose</h3>
        <form action={generateAction} className="mt-3 flex flex-col gap-4">
          <input type="hidden" name="brandPresetId" value={selectedPresetId} />
          <input type="hidden" name="brand" value={brand} />
          {[...selectedPlatforms].map((platform) => (
            <input key={platform} type="hidden" name="platforms" value={platform} />
          ))}
          {[...selectedAvatarIds].map((id) => (
            <input key={id} type="hidden" name="avatarReferenceIds" value={id} />
          ))}
          {[...selectedBrandRefIds].map((id) => (
            <input key={id} type="hidden" name="brandReferenceIds" value={id} />
          ))}
          {oneoffRefs.map((ref) => (
            <input key={ref.path} type="hidden" name="referenceImagePaths" value={ref.path} />
          ))}
          {personRefs.map((ref) => (
            <input key={ref.path} type="hidden" name="personImagePaths" value={ref.path} />
          ))}
          {isCarousel
            ? slides
                .map((slide, rawIndex) => ({
                  text: slide.trim(),
                  note: (slideDesigns[rawIndex] ?? "").trim(),
                  rawIndex,
                }))
                .filter((entry) => entry.text.length > 0)
                .map((entry, filteredIndex) => (
                  <span key={filteredIndex}>
                    <input type="hidden" name="slides" value={entry.text} />
                    {/* Parallel to slides so the server keeps them aligned. */}
                    <input type="hidden" name="slideDesignNotes" value={entry.note} />
                    {/* Logo index tracks the filtered slide order the server sees. */}
                    {logoSlides.has(entry.rawIndex) ? (
                      <input type="hidden" name="logoSlideIndexes" value={filteredIndex} />
                    ) : null}
                  </span>
                ))
            : null}

          <div>
            <span className="type-utility font-semibold text-text-primary">Account / page</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {accounts.map((option) => (
                <button
                  key={option.slug}
                  type="button"
                  onClick={() => setBrand(option.slug)}
                  className={`rounded-full px-3.5 py-1.5 font-display text-[13px] font-medium transition-colors ${
                    brand === option.slug
                      ? "bg-primary text-text-primary"
                      : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  {option.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="type-utility font-semibold text-text-primary">Platforms (pick one or more)</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {IMAGE_PLATFORMS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => togglePlatform(option)}
                  aria-pressed={selectedPlatforms.has(option)}
                  className={`rounded-full px-3.5 py-1.5 font-display text-[13px] font-medium capitalize transition-colors ${
                    selectedPlatforms.has(option)
                      ? "bg-primary text-text-primary"
                      : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[13px] text-text-faint">
              One post is created and published to every platform you pick.
            </p>
          </div>

          <div>
            <span className="type-utility font-semibold text-text-primary">Post type</span>
            <div className="mt-1.5 flex gap-1.5">
              <button
                type="button"
                onClick={() => setIsCarousel(false)}
                aria-pressed={!isCarousel}
                className={`rounded-full px-3.5 py-1.5 font-display text-[13px] font-medium transition-colors ${
                  !isCarousel
                    ? "bg-primary text-text-primary"
                    : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                }`}
              >
                Single image
              </button>
              <button
                type="button"
                onClick={() => setIsCarousel(true)}
                aria-pressed={isCarousel}
                className={`rounded-full px-3.5 py-1.5 font-display text-[13px] font-medium transition-colors ${
                  isCarousel
                    ? "bg-primary text-text-primary"
                    : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                }`}
              >
                Carousel
              </button>
            </div>
          </div>

          {isCarousel ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <span className="type-utility font-semibold text-text-primary">Slides (2–10, in order)</span>
                  <p className="mt-1 text-[13px] text-text-faint">
                    For each slide, put the exact wording in <strong>Content</strong> (the only text
                    drawn on the image). Use <strong>Design note</strong> for styling only — leave it
                    blank to follow the account design. Toggle the logo per slide.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[12px]">
                  <button
                    type="button"
                    onClick={() => setLogoSlides(new Set(slides.map((_, i) => i)))}
                    className="text-primary-soft hover:text-primary-bright"
                  >
                    Logo: all
                  </button>
                  <span className="text-text-faint">·</span>
                  <button
                    type="button"
                    onClick={() => setLogoSlides(new Set())}
                    className="text-primary-soft hover:text-primary-bright"
                  >
                    none
                  </button>
                </div>
              </div>
              {slides.map((slide, index) => (
                <div key={index} className="flex items-start gap-2">
                  <span className="mt-2.5 w-5 shrink-0 text-right text-[13px] font-medium text-text-faint">
                    {index + 1}
                  </span>
                  <div className="flex flex-1 flex-col gap-1">
                    <textarea
                      value={slide}
                      onChange={(event) =>
                        setSlides((current) =>
                          current.map((value, i) => (i === index ? event.target.value : value)),
                        )
                      }
                      rows={2}
                      placeholder={
                        index === 0
                          ? "Content — cover hook text (exact words to show)"
                          : `Content — slide ${index + 1} text (exact words to show)`
                      }
                      className={`${inputClass} resize-y`}
                    />
                    <textarea
                      value={slideDesigns[index] ?? ""}
                      onChange={(event) =>
                        setSlideDesigns((current) => {
                          const next = [...current];
                          while (next.length < slides.length) next.push("");
                          next[index] = event.target.value;
                          return next;
                        })
                      }
                      rows={1}
                      placeholder="Design note (optional) — styling only, e.g. big yellow stat, speaker cutout"
                      className={`${inputClass} resize-y text-[13px]`}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setLogoSlides((current) => {
                          const next = new Set(current);
                          if (next.has(index)) next.delete(index);
                          else next.add(index);
                          return next;
                        })
                      }
                      aria-pressed={logoSlides.has(index)}
                      className={`w-fit rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors ${
                        logoSlides.has(index)
                          ? "bg-primary/20 text-primary-soft"
                          : "border border-border-subtle text-text-faint hover:text-text-secondary"
                      }`}
                    >
                      {logoSlides.has(index) ? "✓ Logo on this slide" : "Add logo to this slide"}
                    </button>
                  </div>
                  {slides.length > 2 ? (
                    <button
                      type="button"
                      aria-label={`Remove slide ${index + 1}`}
                      onClick={() => {
                        setSlides((current) => current.filter((_, i) => i !== index));
                        setSlideDesigns((current) => current.filter((_, i) => i !== index));
                      }}
                      className="mt-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-faint hover:text-danger"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
              {slides.length < 10 ? (
                <button
                  type="button"
                  onClick={() => {
                    setSlides((current) => [...current, ""]);
                    setSlideDesigns((current) => [...current, ""]);
                  }}
                  className="self-start rounded-full border border-border-subtle px-3.5 py-1.5 font-display text-[13px] font-medium text-text-primary hover:bg-bg-hover"
                >
                  + Add slide
                </button>
              ) : null}

              <label className="flex flex-col gap-1.5 text-sm text-text-secondary">
                Caption topic
                <textarea
                  name="prompt"
                  rows={2}
                  required
                  placeholder="What the whole carousel is about — used to write the caption."
                  className={`${inputClass} resize-y`}
                />
              </label>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5 text-sm text-text-secondary">
                Content (the exact text/message on the image)
                <textarea
                  name="prompt"
                  rows={4}
                  required
                  placeholder="e.g. Busy is not the same as booked. One, maybe two clients."
                  className={`${inputClass} resize-y`}
                />
                <span className="text-[12px] text-text-faint">
                  This is the only text drawn on the image. It also writes the caption. No extra
                  text, numbers, or percentages are added.
                </span>
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-text-secondary">
                Design note (optional)
                <textarea
                  name="designNote"
                  value={designNote}
                  onChange={(event) => setDesignNote(event.target.value)}
                  rows={2}
                  placeholder="Styling only — e.g. big yellow stat number, speaker cutout, hexagon texture. Leave blank to follow the account design."
                  className={`${inputClass} resize-y`}
                />
              </label>
            </div>
          )}

          <OneoffReferences
            refs={personRefs}
            onChange={setPersonRefs}
            label="People in this post (faces matched)"
            hint="Upload photos of the specific people to feature. Their faces are reproduced accurately. Use this for speakers, hosts, or guests."
          />

          <OneoffReferences
            refs={oneoffRefs}
            onChange={setOneoffRefs}
            label="Style / brand reference images (this generation)"
            hint="Logos, layouts, or mood images to guide the look. These are style guidance, not people to depict."
          />

          {generateState.error ? (
            <p className="text-sm text-danger">{generateState.error}</p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              isLoading={isGenerating}
              disabled={!selectedPresetId || selectedPlatforms.size === 0 || !hasEnoughSlides}
            >
              {isCarousel ? "Generate carousel" : "Generate image"}
            </Button>
            {!selectedPresetId ? (
              <span className="text-[13px] text-text-faint">Pick a preset first.</span>
            ) : isCarousel && !hasEnoughSlides ? (
              <span className="text-[13px] text-text-faint">Fill in at least 2 slides.</span>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  );
}

function PresetForm({ onDone, preset }: { onDone: () => void; preset?: PresetView }) {
  const isEdit = Boolean(preset);
  const [state, action, isPending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = isEdit ? await updatePreset(prev, formData) : await createPreset(prev, formData);
      if (result.ok) onDone();
      return result;
    },
    initialState,
  );

  return (
    <form action={action} className="mt-3 flex flex-col gap-2 rounded-xl border border-border-strong bg-bg-base p-3">
      {isEdit ? <input type="hidden" name="presetId" value={preset!.id} /> : null}
      <input
        name="name"
        required
        defaultValue={preset?.name}
        placeholder="Preset name"
        className={inputClass}
      />
      <input
        name="tone"
        required
        defaultValue={preset?.tone}
        placeholder="Tone (e.g. confident, premium)"
        className={inputClass}
      />
      <input
        name="palette"
        defaultValue={preset?.palette.join(", ")}
        placeholder="Palette hex values, comma-separated"
        className={inputClass}
      />
      <textarea
        name="styleRules"
        rows={2}
        defaultValue={preset?.styleRules}
        placeholder="Style rules"
        className={`${inputClass} resize-y`}
      />
      <textarea
        name="campaignContext"
        rows={2}
        defaultValue={preset?.campaignContext ?? ""}
        placeholder="Campaign context (optional)"
        className={`${inputClass} resize-y`}
      />
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" isLoading={isPending} className="self-start">
          {isEdit ? "Save changes" : "Save preset"}
        </Button>
        {isEdit ? (
          <button
            type="button"
            onClick={onDone}
            className="text-[13px] text-text-faint hover:text-text-primary"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

function AvatarUploadForm({ accountSlug }: { accountSlug: string }) {
  const [state, action, isPending] = useActionState(uploadAvatarReference, initialState);

  return (
    <form action={action} className="mt-4 flex flex-col gap-2 border-t border-border-subtle pt-3">
      <span className="type-utility text-text-faint">Add person for this account (admin)</span>
      <input type="hidden" name="accountSlug" value={accountSlug} />
      <input name="personName" required placeholder="Person name (e.g. Alex)" className={inputClass} />
      <input
        type="file"
        name="file"
        required
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="text-[13px] text-text-secondary file:mr-2 file:rounded-full file:border-0 file:bg-bg-hover file:px-3 file:py-1.5 file:font-display file:text-[13px] file:text-text-primary"
      />
      <span className="text-[11px] text-text-faint">
        Select several angles at once for better likeness.
      </span>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" variant="secondary" isLoading={isPending} className="self-start">
        Upload
      </Button>
    </form>
  );
}

function BrandReferenceUploadForm() {
  const [state, action, isPending] = useActionState(uploadBrandReference, initialState);

  return (
    <form action={action} className="mt-4 flex flex-col gap-2 border-t border-border-subtle pt-3">
      <span className="type-utility text-text-faint">Add reference</span>
      <input name="name" required placeholder="Label (e.g. Logo, Product shot)" className={inputClass} />
      <input
        type="file"
        name="file"
        required
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="text-[13px] text-text-secondary file:mr-2 file:rounded-full file:border-0 file:bg-bg-hover file:px-3 file:py-1.5 file:font-display file:text-[13px] file:text-text-primary"
      />
      <span className="text-[11px] text-text-faint">
        Select several at once. Multiple uploads are numbered (e.g. &ldquo;Logo 1&rdquo;).
      </span>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" variant="secondary" isLoading={isPending} className="self-start">
        Save reference
      </Button>
    </form>
  );
}

/**
 * One-off reference uploads for this generation only. Uploads immediately
 * (base64 → server action) so the composer holds a validated storage path;
 * files never touch the library. Exported so the history regenerate panel can
 * attach person/reference photos too.
 */
export function OneoffReferences({
  refs,
  onChange,
  label,
  hint,
}: {
  refs: OneoffRef[];
  onChange: (refs: OneoffRef[]) => void;
  label: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const remaining = 4 - refs.length;
    const chosen = Array.from(files).slice(0, Math.max(0, remaining));

    startTransition(async () => {
      const uploaded: OneoffRef[] = [];
      for (const file of chosen) {
        const dataBase64 = await fileToBase64(file);
        const result = await uploadReferenceImage({
          mimeType: file.type,
          dataBase64,
          sizeBytes: file.size,
        });
        if (result.error || !result.path) {
          setError(result.error ?? "Upload failed.");
          continue;
        }
        uploaded.push({
          path: result.path,
          previewUrl: `data:${file.type};base64,${dataBase64}`,
          name: file.name,
        });
      }
      if (uploaded.length > 0) onChange([...refs, ...uploaded]);
      if (inputRef.current) inputRef.current.value = "";
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="type-utility font-semibold text-text-primary">{label}</span>
      {hint ? <span className="text-[12px] text-text-secondary">{hint}</span> : null}
      {refs.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {refs.map((ref) => (
            <div key={ref.path} className="relative">
              <Image
                src={ref.previewUrl}
                alt={ref.name}
                width={56}
                height={56}
                unoptimized
                className="h-14 w-14 rounded-lg object-cover"
              />
              <button
                type="button"
                aria-label={`Remove ${ref.name}`}
                onClick={() => onChange(refs.filter((r) => r.path !== ref.path))}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-bg-nav text-[13px] text-text-secondary hover:text-danger"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {refs.length < 4 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isPending}
          className="self-start rounded-full border border-border-subtle px-3.5 py-1.5 font-display text-[13px] font-medium text-text-primary hover:bg-bg-hover disabled:opacity-50"
        >
          {isPending ? "Uploading…" : `+ Attach reference (${refs.length}/4)`}
        </button>
      ) : (
        <span className="type-utility self-start text-text-faint">4/4 — max reached</span>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(event) => handleFiles(event.target.files)}
      />
      {error ? <p className="text-[13px] text-danger">{error}</p> : null}
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:<mime>;base64," prefix — server wants raw base64.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
