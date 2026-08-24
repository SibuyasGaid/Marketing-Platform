"use client";

import { useActionState, useState } from "react";
import {
  addCalendarEntry,
  generateCalendarDay,
  removeCalendarEntry,
  type ActionState,
} from "@/app/(app)/queue/actions";
import { Button } from "@/components/ui/Button";
import { SubmitText } from "@/components/ui/SubmitButton";
import { BRAND_NAMES, IMAGE_PLATFORMS, type Brand, type ImagePlatform } from "@/lib/domain";
import type { AccountOption } from "@/components/images/ImageWorkspace";

export interface CalendarEntryView {
  id: string;
  calendarDate: string;
  brand: Brand;
  platforms: ImagePlatform[];
  prompt: string | null;
}

export interface PresetOption {
  id: string;
  name: string;
}

const initialState: ActionState = { error: null };

const inputClass =
  "w-full rounded-xl border border-border-subtle bg-bg-base px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-border-strong";

/**
 * Content calendar: enter a prompt or template preset per day ahead of time.
 * The daily cron (06:00 UTC) turns each entry into content in this queue.
 */
export function CalendarPanel({
  entries,
  presets,
  accounts,
  canEdit,
}: {
  entries: CalendarEntryView[];
  presets: PresetOption[];
  accounts: AccountOption[];
  canEdit: boolean;
}) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [brand, setBrand] = useState<Brand>(accounts[0]?.slug ?? "");
  const nameOf = (slug: string) =>
    accounts.find((account) => account.slug === slug)?.name ?? BRAND_NAMES[slug] ?? slug;
  const [platforms, setPlatforms] = useState<Set<ImagePlatform>>(new Set(["instagram"]));
  const [state, action, isPending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await addCalendarEntry(prev, formData);
      if (result.ok) {
        setIsFormOpen(false);
        setPlatforms(new Set(["instagram"]));
      }
      return result;
    },
    initialState,
  );

  const togglePlatform = (platform: ImagePlatform) =>
    setPlatforms((current) => {
      const next = new Set(current);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });

  return (
    <section className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-semibold text-text-primary">
Content calendar · schedule ahead
          </h3>
          <p className="mt-0.5 text-[13px] text-text-faint">
            Enter a prompt (and optional template) for a specific day. It generates automatically
            at 06:00 UTC and lands here for approval, or hit <strong>Generate now</strong> to run
            a day on demand.
          </p>
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setIsFormOpen((open) => !open)}
            className="text-[13px] text-primary-soft hover:text-primary-bright"
          >
            {isFormOpen ? "Close" : "+ Plan a day"}
          </button>
        ) : null}
      </div>

      {isFormOpen ? (
        <form
          action={action}
          className="mt-3 grid gap-2 rounded-xl border border-border-subtle bg-bg-base p-3 sm:grid-cols-2"
        >
          <input type="hidden" name="brand" value={brand} />
          {[...platforms].map((platform) => (
            <input key={platform} type="hidden" name="platforms" value={platform} />
          ))}
          <label className="flex flex-col gap-1 text-[13px] text-text-secondary">
            Date
            <input type="date" name="calendarDate" required className={inputClass} />
          </label>
          <div className="flex flex-col gap-1 text-[13px] text-text-secondary">
            Brand / page
            <div className="flex flex-wrap gap-1.5">
              {accounts.map((option) => (
                <button
                  key={option.slug}
                  type="button"
                  onClick={() => setBrand(option.slug)}
                  className={`rounded-full px-3 py-1 font-display text-[13px] font-medium transition-colors ${
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
          <div className="flex flex-col gap-1 text-[13px] text-text-secondary sm:col-span-2">
            Platforms (pick one or more)
            <div className="flex flex-wrap gap-1.5">
              {IMAGE_PLATFORMS.map((platform) => (
                <button
                  key={platform}
                  type="button"
                  onClick={() => togglePlatform(platform)}
                  aria-pressed={platforms.has(platform)}
                  className={`rounded-full px-3 py-1 font-display text-[13px] font-medium capitalize transition-colors ${
                    platforms.has(platform)
                      ? "bg-primary text-text-primary"
                      : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  {platform}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1 text-[13px] text-text-secondary sm:col-span-2">
            Prompt for the day
            <textarea
              name="prompt"
              rows={2}
              placeholder="e.g. Student win story, highlight a recent client result"
              className={`${inputClass} resize-y`}
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-text-secondary sm:col-span-2">
            Template preset (optional)
            <select name="brandPresetId" className={inputClass} defaultValue="">
              <option value="">Use the default preset</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          {state.error ? (
            <p className="text-sm text-danger sm:col-span-2">{state.error}</p>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" variant="secondary" isLoading={isPending}>
              Add to calendar
            </Button>
          </div>
        </form>
      ) : null}

      {entries.length === 0 ? (
        <p className="mt-3 text-sm">
          Nothing planned yet. Add a day above and it will generate itself each morning.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-bg-base px-3 py-2"
            >
              <div className="min-w-0">
                <span className="text-sm font-medium text-text-primary">
                  {entry.calendarDate}
                </span>
                <span className="ml-2 text-[13px] text-text-faint">
                  {nameOf(entry.brand)} · {entry.platforms.join(", ")}
                </span>
                {entry.prompt ? (
                  <p className="mt-0.5 truncate text-[13px] text-text-secondary">{entry.prompt}</p>
                ) : null}
              </div>
              {canEdit ? (
                <div className="flex items-center gap-3">
                  <GenerateNowButton calendarDate={entry.calendarDate} />
                  <form action={removeCalendarEntry}>
                    <input type="hidden" name="entryId" value={entry.id} />
                    <SubmitText
                      spinner
                      pendingLabel="Removing…"
                      className="text-[13px] text-text-faint hover:text-danger"
                      aria-label={`Remove ${entry.calendarDate}`}
                    >
                      Remove
                    </SubmitText>
                  </form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GenerateNowButton({ calendarDate }: { calendarDate: string }) {
  const [state, action, isPending] = useActionState(generateCalendarDay, initialState);

  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="calendarDate" value={calendarDate} />
      <button
        type="submit"
        disabled={isPending}
        className="rounded-full border border-border-subtle px-3 py-1 font-display text-[13px] font-medium text-text-primary hover:bg-bg-hover disabled:opacity-50"
      >
        {isPending ? "Queuing…" : "Generate now"}
      </button>
      {state.ok ? <span className="text-[13px] text-success">Queued ✓</span> : null}
      {state.error ? <span className="text-[13px] text-danger">{state.error}</span> : null}
    </form>
  );
}
