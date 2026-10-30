"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestClipVideo } from "@/app/(app)/avatar/actions";
import { OneoffReferences, type OneoffRef } from "@/components/images/ImageWorkspace";
import { Button } from "@/components/ui/Button";

export interface ClipAccountOption {
  slug: string;
  name: string;
}

const CLIP_PLATFORMS = [
  { key: "instagram", label: "Instagram Reel" },
  { key: "facebook", label: "Facebook video" },
  { key: "youtube", label: "YouTube Short" },
] as const;

const inputClass =
  "w-full rounded-xl border border-border-subtle bg-bg-base px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-border-strong";

interface ClipSection {
  /** Stable React key so removing a middle clip doesn't shuffle the upload
   *  widgets' internal state onto the wrong section. */
  id: number;
  visualsPrompt: string;
  script: string;
  textToDisplay: string;
  refs: OneoffRef[];
}

let sectionSeq = 0;
const emptySection = (): ClipSection => ({
  id: sectionSeq++,
  visualsPrompt: "",
  script: "",
  textToDisplay: "",
  refs: [],
});

/**
 * Composes one or more prompt-driven visual clips (HeyGen Video Agent). Each
 * section is an independent clip; the + button adds another. On generate, every
 * filled section is sent off and lands in the Generated videos tab. No captions
 * here — those are added later when moving a clip to the Approval Queue.
 */
export function ClipStudio({
  accounts,
  canCreate,
  onGenerated,
}: {
  accounts: ClipAccountOption[];
  canCreate: boolean;
  /** Called after clips are queued, so the tab can jump to Generated videos. */
  onGenerated?: () => void;
}) {
  const router = useRouter();
  const [brand, setBrand] = useState(accounts[0]?.slug ?? "");
  const [platforms, setPlatforms] = useState<Set<string>>(new Set(["instagram"]));
  const [sections, setSections] = useState<ClipSection[]>([emptySection()]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const updateSection = (index: number, patch: Partial<ClipSection>) =>
    setSections((cur) => cur.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const togglePlatform = (key: string) =>
    setPlatforms((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const filled = sections.filter((s) => s.visualsPrompt.trim().length > 0);
  const canSubmit = canCreate && brand && platforms.size > 0 && filled.length > 0;

  const submit = () => {
    setError(null);
    setOk(null);
    startSubmit(async () => {
      // Keep every section we don't successfully send — a failure partway through
      // (or an unfilled section) must never wipe the user's un-generated work.
      const remaining: ClipSection[] = [];
      let created = 0;
      let stop = false;
      for (const section of sections) {
        if (stop) {
          remaining.push(section);
          continue;
        }
        if (section.visualsPrompt.trim().length === 0) {
          // Drop a fully empty section; keep one that has partial content.
          const hasContent =
            section.script.trim() || section.textToDisplay.trim() || section.refs.length > 0;
          if (hasContent) remaining.push(section);
          continue;
        }
        const formData = new FormData();
        formData.set("brand", brand);
        for (const p of platforms) formData.append("platforms", p);
        formData.set("visualsPrompt", section.visualsPrompt);
        formData.set("script", section.script);
        formData.set("textToDisplay", section.textToDisplay);
        for (const ref of section.refs) formData.append("referenceImagePaths", ref.path);
        const result = await requestClipVideo({ error: null }, formData);
        if (!result.ok) {
          setError(result.error ?? "Could not start this clip — the ones above it are generating.");
          remaining.push(section); // keep the failed one so it can be retried
          stop = true;
          continue;
        }
        created += 1;
      }
      if (created > 0) {
        setOk(
          `${created} clip${created === 1 ? "" : "s"} generating — see the Generated videos tab.`,
        );
        onGenerated?.();
        router.refresh();
      }
      setSections(remaining.length > 0 ? remaining : [emptySection()]);
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
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-4 rounded-2xl border border-border-subtle bg-bg-raised p-5">
        <div>
          <span className="type-utility font-semibold text-text-primary">Account / page</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {accounts.map((account) => (
              <button
                key={account.slug}
                type="button"
                onClick={() => setBrand(account.slug)}
                className={`rounded-full px-3.5 py-1.5 font-display text-[13px] font-medium transition-colors ${
                  brand === account.slug
                    ? "bg-primary text-on-primary"
                    : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                }`}
              >
                {account.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="type-utility font-semibold text-text-primary">Post to</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {CLIP_PLATFORMS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => togglePlatform(option.key)}
                aria-pressed={platforms.has(option.key)}
                className={`rounded-full px-3.5 py-1.5 font-display text-[13px] font-medium transition-colors ${
                  platforms.has(option.key)
                    ? "bg-primary text-on-primary"
                    : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[13px] text-text-faint">
            Vertical 9:16 clips. Each one below is generated separately so you can stitch and edit
            them however you like.
          </p>
        </div>
      </section>

      {sections.map((section, index) => (
        <section
          key={section.id}
          className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-bg-raised p-5"
        >
          <div className="flex items-center justify-between">
            <span className="type-utility font-semibold text-text-primary">Clip {index + 1}</span>
            {sections.length > 1 ? (
              <button
                type="button"
                onClick={() => setSections((cur) => cur.filter((_, i) => i !== index))}
                className="text-[13px] text-text-faint hover:text-danger"
              >
                Remove
              </button>
            ) : null}
          </div>

          <label className="flex flex-col gap-1.5 text-sm text-text-secondary">
            Visuals (what the scene looks like)
            <textarea
              value={section.visualsPrompt}
              onChange={(event) => updateSection(index, { visualsPrompt: event.target.value })}
              rows={3}
              placeholder="e.g. Cinematic slow push-in on a modern office at golden hour, laptop with charts glowing, calm and premium."
              className={`${inputClass} resize-y`}
            />
            <span className="text-[12px] text-text-faint">
              Describe the shot, mood, colors, and motion. Reference images below make it more
              predictable.
            </span>
          </label>

          <label className="flex flex-col gap-1.5 text-sm text-text-secondary">
            Voiceover script (optional)
            <textarea
              value={section.script}
              onChange={(event) => updateSection(index, { script: event.target.value })}
              rows={2}
              placeholder="What the narrator says over this clip. Leave blank for visuals only."
              className={`${inputClass} resize-y`}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm text-text-secondary">
            On-screen text (optional)
            <input
              type="text"
              value={section.textToDisplay}
              onChange={(event) => updateSection(index, { textToDisplay: event.target.value })}
              maxLength={500}
              placeholder="Text to show on the clip, e.g. Busy is not the same as booked."
              className={inputClass}
            />
            <span className="text-[12px] text-text-faint">
              The AI draws this into the video, so exact spelling and placement can vary. Keep it
              short (a few words) for the most reliable result.
            </span>
          </label>

          <OneoffReferences
            refs={section.refs}
            onChange={(refs) => updateSection(index, { refs })}
            label="Reference images (optional)"
            hint="Upload look/style references to steer the visuals. Makes the result more predictable."
          />
        </section>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setSections((cur) => [...cur, emptySection()])}
          className="rounded-lg border border-border-subtle px-3.5 py-1.5 font-display text-[13px] font-medium text-text-primary hover:bg-bg-hover"
        >
          + Add another clip
        </button>
        {canCreate ? (
          <Button type="button" onClick={submit} isLoading={submitting} disabled={!canSubmit}>
            Generate {filled.length > 1 ? `${filled.length} clips` : "clip"}
          </Button>
        ) : (
          <p className="text-[13px] text-text-faint">Reviewers can’t create content.</p>
        )}
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {ok ? <p className="text-sm text-success">{ok}</p> : null}
    </div>
  );
}
