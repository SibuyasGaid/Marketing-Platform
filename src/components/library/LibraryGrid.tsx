"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { DeleteContentButton } from "@/components/content/DeleteContentButton";
import { StatusPill } from "@/components/ui/StatusPill";
import { CONTENT_STATUSES, CONTENT_TYPES, type ContentStatus, type ContentType } from "@/lib/domain";

export interface LibraryItemView {
  id: string;
  type: ContentType;
  platform: string;
  /** All destination platforms this post publishes to. */
  targetPlatforms: string[];
  brandName: string;
  status: ContentStatus;
  caption: string;
  createdAt: string;
  imageUrl: string | null;
  isVideo: boolean;
  thumbUrl: string | null;
  mediaUrl: string | null;
  /** >1 marks a carousel and drives the slide-count badge. */
  slideCount: number;
}

const typeLabel: Record<ContentType, string> = {
  image_post: "Image",
  clip: "Clip",
  heygen_video: "Avatar video",
  copy_set: "Copy",
};

/** Short platform labels (IG, FB, L-in, YT). */
const PLATFORM_LABEL: Record<string, string> = {
  instagram: "IG",
  facebook: "FB",
  linkedin: "L-in",
  youtube: "YT",
};

function platformLabels(platforms: string[], fallback: string): string {
  const list = platforms.length > 0 ? platforms : [fallback];
  return list.map((p) => PLATFORM_LABEL[p] ?? p.slice(0, 2).toUpperCase()).join(" · ");
}

const selectClass =
  "rounded-xl border border-border-subtle bg-bg-base px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-border-strong";

export function LibraryGrid({
  items,
  canManage = false,
}: {
  items: LibraryItemView[];
  canManage?: boolean;
}) {
  const [status, setStatus] = useState<ContentStatus | "all">("all");
  const [type, setType] = useState<ContentType | "all">("all");
  const [platform, setPlatform] = useState<string>("all");
  const [account, setAccount] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");

  const platforms = useMemo(
    () => [...new Set(items.map((item) => item.platform))].sort(),
    [items],
  );
  const accounts = useMemo(
    () => [...new Set(items.map((item) => item.brandName))].sort(),
    [items],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (status !== "all" && item.status !== status) return false;
      if (type !== "all" && item.type !== type) return false;
      if (platform !== "all" && item.platform !== platform) return false;
      if (account !== "all" && item.brandName !== account) return false;
      const day = item.createdAt.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (q && !`${item.caption} ${item.brandName} ${item.platform}`.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [items, status, type, platform, account, from, to, query]);

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-border-subtle bg-bg-raised p-4">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search…"
          className={`${selectClass} min-w-[160px] flex-1`}
        />
        <select value={status} onChange={(event) => setStatus(event.target.value as ContentStatus | "all")} className={selectClass}>
          <option value="all">All statuses</option>
          {CONTENT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <select value={type} onChange={(event) => setType(event.target.value as ContentType | "all")} className={selectClass}>
          <option value="all">All types</option>
          {CONTENT_TYPES.map((value) => (
            <option key={value} value={value}>
              {typeLabel[value]}
            </option>
          ))}
        </select>
        <select value={platform} onChange={(event) => setPlatform(event.target.value)} className={selectClass}>
          <option value="all">All platforms</option>
          {platforms.map((value) => (
            <option key={value} value={value} className="capitalize">
              {value}
            </option>
          ))}
        </select>
        <select value={account} onChange={(event) => setAccount(event.target.value)} className={selectClass}>
          <option value="all">All accounts</option>
          {accounts.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[13px] text-text-faint">
          From
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={selectClass} />
        </label>
        <label className="flex items-center gap-1 text-[13px] text-text-faint">
          To
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={selectClass} />
        </label>
        <span className="ml-auto text-[13px] text-text-faint">
          {filtered.length} item{filtered.length === 1 ? "" : "s"}
        </span>
      </section>

      {filtered.length === 0 ? (
        <section className="rounded-2xl border border-border-subtle bg-bg-raised p-6">
          <p className="text-sm text-text-faint">Nothing matches these filters.</p>
        </section>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {filtered.map((item) => (
            <article key={item.id} className="card-hover flex flex-col overflow-hidden rounded-2xl border border-border-subtle bg-bg-raised">
              <div className="relative aspect-square w-full bg-bg-base">
                {item.imageUrl ? (
                  <Image src={item.imageUrl} alt="" width={400} height={400} unoptimized className="h-full w-full object-cover" />
                ) : item.thumbUrl ? (
                  <Image src={item.thumbUrl} alt="" width={400} height={400} unoptimized className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-text-faint">
                    {item.isVideo ? (
                      <svg viewBox="0 0 24 24" className="h-8 w-8 text-text-faint">
                        <circle cx="12" cy="12" r="9" className="fill-none stroke-current stroke-[1.5]" />
                        <path d="M10 8.5 16 12l-6 3.5z" className="fill-current" />
                      </svg>
                    ) : (
                      <span className="type-utility">No preview</span>
                    )}
                  </span>
                )}
                <span className="absolute left-2 top-2">
                  <StatusPill status={item.status} />
                </span>
                {item.slideCount > 1 ? (
                  <span className="absolute right-2 top-2 rounded-full bg-bg-nav/85 px-2 py-0.5 text-[11px] font-medium text-text-primary">
                    ▦ {item.slideCount}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-1 flex-col p-2.5">
                <span className="type-utility truncate text-text-faint">
                  {item.brandName} · {platformLabels(item.targetPlatforms, item.platform)} ·{" "}
                  {typeLabel[item.type]}
                </span>
                <p className="mt-1 line-clamp-2 text-[13px] text-text-secondary">
                  {item.caption || "No caption"}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-text-faint">
                    {new Date(item.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                  <div className="flex items-center gap-3">
                    {item.mediaUrl ? (
                      <a href={item.mediaUrl} target="_blank" rel="noreferrer" className="text-[13px] text-primary-soft hover:text-primary-bright">
                        Open
                      </a>
                    ) : null}
                    {canManage ? (
                      <DeleteContentButton itemId={item.id} label={typeLabel[item.type].toLowerCase()} />
                    ) : null}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
