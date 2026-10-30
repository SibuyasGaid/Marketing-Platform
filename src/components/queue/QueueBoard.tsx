"use client";

import { AnimatePresence } from "framer-motion";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useActiveRefresh } from "@/components/hooks/useActiveRefresh";
import { PostCalendar, type CalendarPost } from "@/components/queue/PostCalendar";
import { UploadVideoModal, type UploadAccountOption } from "@/components/queue/UploadVideoModal";
import { CONTENT_STATUSES, PLATFORMS, type ContentStatus, type Platform } from "@/lib/domain";
import { ItemDrawer } from "@/components/queue/ItemDrawer";
import { QueueCard } from "@/components/queue/QueueCard";
import type { QueueItemView } from "@/components/queue/queueTypes";

export function QueueBoard({
  items,
  weekDates,
  canReview,
  canManage,
  accounts,
}: {
  items: QueueItemView[];
  weekDates: string[];
  canReview: boolean;
  canManage: boolean;
  accounts: UploadAccountOption[];
}) {
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ContentStatus | "all">("all");
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  // Publishing/regenerating states settle asynchronously — keep the board honest.
  // Also poll while a clip or avatar video is still rendering so it appears live.
  const hasInFlight = items.some(
    (item) =>
      ["publishing", "regenerating", "approved"].includes(item.status) ||
      (item.isVideo && !item.videoUrl),
  );
  useActiveRefresh(hasInFlight, 6000);

  const filtered = useMemo(
    () =>
      items.filter(
        (item) =>
          (platformFilter === "all" || item.platform === platformFilter) &&
          (statusFilter === "all" || item.status === statusFilter),
      ),
    [items, platformFilter, statusFilter],
  );

  const byDate = useMemo(() => {
    const map = new Map<string, QueueItemView[]>();
    for (const date of weekDates) map.set(date, []);
    const overflow: QueueItemView[] = [];
    for (const item of filtered) {
      const bucket = map.get(item.bucketDate);
      if (bucket) bucket.push(item);
      else overflow.push(item);
    }
    return { map, overflow };
  }, [filtered, weekDates]);

  const openItem = filtered.find((item) => item.id === openItemId) ?? null;

  // Calendar shows items with a planned day that aren't done yet (posted items
  // leave the plan). Uses all items, independent of the board's filters.
  const calendarPosts = useMemo<CalendarPost[]>(
    () =>
      items
        .filter((item) => item.scheduledDate && item.status !== "posted")
        .map((item) => ({
          id: item.id,
          date: item.scheduledDate as string,
          brandName: item.brandName,
          platform: item.platform,
          status: item.status,
          caption: item.caption,
          previewUrl: item.previewUrl,
        })),
    [items],
  );

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-border-subtle bg-bg-raised p-4">
        <FilterGroup
          label="Platform"
          options={["all", ...PLATFORMS]}
          value={platformFilter}
          onChange={(value) => setPlatformFilter(value as Platform | "all")}
        />
        <FilterGroup
          label="Status"
          options={["all", ...CONTENT_STATUSES.filter((status) => status !== "draft")]}
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as ContentStatus | "all")}
        />
        <div className="ml-auto flex items-center gap-3">
          {canManage ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowUpload(true)}
              className="!px-4 !py-1.5 text-[13px]"
            >
              + Upload edited video
            </Button>
          ) : null}
          <span className="text-[13px] text-text-faint">
            {filtered.length} item{filtered.length === 1 ? "" : "s"}
          </span>
        </div>
      </section>

      {filtered.length === 0 ? (
        <section className="rounded-2xl border border-border-subtle bg-bg-raised p-8 text-center">
          <p className="text-sm text-text-secondary">
            {items.length === 0
              ? "Nothing in the queue yet. Generated posts land here for review."
              : "No items match these filters."}
          </p>
        </section>
      ) : (
        /* Week board: 7 columns on desktop, stacked day list on mobile. */
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          {weekDates.map((date) => (
            <DayColumn
              key={date}
              date={date}
              items={byDate.map.get(date) ?? []}
              onOpen={setOpenItemId}
            />
          ))}
        </div>
      )}

      {byDate.overflow.length > 0 ? (
        <section className="rounded-2xl border border-border-subtle bg-bg-raised p-4">
          <h3 className="font-display text-base font-semibold text-text-primary">
            Unscheduled / other weeks
          </h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {byDate.overflow.map((item) => (
              <QueueCard key={item.id} item={item} onOpen={setOpenItemId} />
            ))}
          </div>
        </section>
      ) : null}

      <PostCalendar posts={calendarPosts} onOpen={setOpenItemId} />

      <AnimatePresence>
        {openItem ? (
          <ItemDrawer
            key={openItem.id}
            item={openItem}
            canReview={canReview}
            canManage={canManage}
            onClose={() => setOpenItemId(null)}
          />
        ) : null}
      </AnimatePresence>

      {showUpload ? (
        <UploadVideoModal accounts={accounts} onClose={() => setShowUpload(false)} />
      ) : null}
    </div>
  );
}

function FilterGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-text-secondary">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-xl border border-border-subtle bg-bg-base px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-border-strong"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option === "all" ? "All" : option.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

function DayColumn({
  date,
  items,
  onOpen,
}: {
  date: string;
  items: QueueItemView[];
  onOpen: (id: string) => void;
}) {
  const day = new Date(`${date}T00:00:00Z`);
  const isToday = date === new Date().toISOString().slice(0, 10);

  return (
    <div className="rounded-2xl border border-border-subtle bg-bg-raised p-3">
      <div className="flex items-baseline justify-between">
        <span
          className={`type-utility ${isToday ? "text-primary-soft" : "text-text-faint"}`}
        >
          {day.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}
        </span>
        <span className="text-[13px] text-text-faint">
          {day.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" })}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {items.length === 0 ? (
          <p className="py-3 text-center text-[13px] text-text-faint">·</p>
        ) : (
          items.map((item) => <QueueCard key={item.id} item={item} onOpen={onOpen} />)
        )}
      </div>
    </div>
  );
}
