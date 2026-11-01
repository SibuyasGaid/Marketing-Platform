"use client";

import { useMemo, useState } from "react";
import type { ContentStatus, Platform } from "@/lib/domain";

export interface CalendarPost {
  id: string;
  /** Planned day, YYYY-MM-DD. */
  date: string;
  brandName: string;
  platform: Platform;
  status: ContentStatus;
  caption: string | null;
  previewUrl: string | null;
}

const PLATFORM_ICON: Record<string, string> = {
  instagram: "IG",
  facebook: "FB",
  linkedin: "LI",
  youtube: "YT",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** YYYY-MM for a Date, in UTC (planned dates are stored as UTC calendar days). */
function ymOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * Month-grid calendar of planned/scheduled posts. Shows one month at a time;
 * prev/next paginate, and the Next button carries a badge counting how many
 * posts sit in the following month. Clicking a post calls onOpen(id).
 */
export function PostCalendar({
  posts,
  onOpen,
}: {
  posts: CalendarPost[];
  onOpen?: (id: string) => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth()); // 0-11

  // Group posts by day and count per YYYY-MM for the pagination badges.
  const { byDay, byMonth } = useMemo(() => {
    const day: Record<string, CalendarPost[]> = {};
    const mon: Record<string, number> = {};
    for (const post of posts) {
      (day[post.date] ??= []).push(post);
      const ym = ymOf(post.date);
      mon[ym] = (mon[ym] ?? 0) + 1;
    }
    return { byDay: day, byMonth: mon };
  }, [posts]);

  const prevYm = ymKey(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1);
  const nextYm = ymKey(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1);
  const prevCount = byMonth[prevYm] ?? 0;
  const nextCount = byMonth[nextYm] ?? 0;

  const cells = monthCells(year, month);
  const todayIso = new Date().toISOString().slice(0, 10);

  const step = (delta: number) => {
    const next = month + delta;
    if (next < 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else if (next > 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth(next);
    }
  };

  return (
    <section className="rounded-2xl border border-border-subtle bg-bg-raised p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-base font-semibold text-text-primary">
          Scheduled calendar
        </h3>
        <div className="flex items-center gap-2">
          <PagerButton
            direction="prev"
            count={prevCount}
            onClick={() => step(-1)}
            label="Previous month"
          />
          <span className="min-w-[130px] text-center text-sm font-medium text-text-primary">
            {MONTHS[month]} {year}
          </span>
          <PagerButton
            direction="next"
            count={nextCount}
            onClick={() => step(1)}
            label="Next month"
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((day) => (
          <span key={day} className="pb-1 text-center type-utility text-text-faint">
            {day}
          </span>
        ))}
        {cells.map((cell, index) => {
          if (!cell) return <span key={`pad-${index}`} className="min-h-[84px] rounded-lg" />;
          const dayPosts = byDay[cell.iso] ?? [];
          const isToday = cell.iso === todayIso;
          return (
            <div
              key={cell.iso}
              className={`min-h-[84px] rounded-lg border p-1 ${
                isToday ? "border-primary/60 bg-bg-hover" : "border-border-subtle bg-bg-base"
              }`}
            >
              <span className={`block text-right text-[11px] ${isToday ? "text-primary-soft" : "text-text-faint"}`}>
                {cell.day}
              </span>
              <div className="mt-0.5 flex flex-col gap-0.5">
                {dayPosts.slice(0, 3).map((post) => (
                  <button
                    key={post.id}
                    type="button"
                    onClick={() => onOpen?.(post.id)}
                    title={post.caption ?? post.brandName}
                    className="flex items-center gap-1 truncate rounded bg-bg-raised px-1 py-0.5 text-left text-[11px] text-text-secondary hover:bg-bg-hover"
                  >
                    <span className="shrink-0 text-[10px] text-text-faint">
                      {PLATFORM_ICON[post.platform] ?? post.platform.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="truncate">{post.caption || post.brandName}</span>
                  </button>
                ))}
                {dayPosts.length > 3 ? (
                  <span className="px-1 text-[10px] text-text-faint">+{dayPosts.length - 3} more</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {posts.length === 0 ? (
        <p className="mt-3 text-[13px] text-text-faint">
          No planned posts yet. In Brand Images, use Send to queue and pick a day.
        </p>
      ) : null}
    </section>
  );
}

function PagerButton({
  direction,
  count,
  onClick,
  label,
}: {
  direction: "prev" | "next";
  count: number;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="relative flex h-8 w-8 items-center justify-center rounded-full border border-border-subtle text-text-secondary hover:bg-bg-hover"
    >
      <span aria-hidden>{direction === "prev" ? "‹" : "›"}</span>
      {count > 0 ? (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-lg bg-primary px-1 text-[10px] font-semibold text-on-primary">
          {count}
        </span>
      ) : null}
    </button>
  );
}

function ymKey(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, "0")}`;
}

/** Cells for a month grid (Mon-first). Leading blanks are null. */
function monthCells(year: number, month0: number): Array<{ day: number; iso: string } | null> {
  const first = new Date(Date.UTC(year, month0, 1));
  // getUTCDay: 0=Sun..6=Sat → convert to Mon-first offset.
  const lead = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const cells: Array<{ day: number; iso: string } | null> = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ day, iso });
  }
  return cells;
}
