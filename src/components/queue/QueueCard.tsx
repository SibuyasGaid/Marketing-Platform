"use client";

import Image from "next/image";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatSydney } from "@/lib/timezone";
import { PlayGlyph } from "@/components/queue/queueParts";
import { type QueueItemView, PLATFORM_ICON } from "@/components/queue/queueTypes";

export function QueueCard({
  item,
  onOpen,
}: {
  item: QueueItemView;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen(item.id);
      }}
      className="card-hover w-full rounded-xl border border-border-subtle bg-bg-base p-2 text-left hover:bg-bg-hover"
    >
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="type-utility whitespace-nowrap text-text-faint">
          {item.targetPlatforms.map((p) => PLATFORM_ICON[p]).join(" · ")}
        </span>
        <StatusPill status={item.status} />
      </div>
      <span className="mt-1 block truncate text-[11px] text-text-faint">{item.brandName}</span>
      {item.previewUrl ? (
        <div className="relative mt-2">
          <Image
            src={item.previewUrl}
            alt=""
            width={320}
            height={320}
            unoptimized
            className="aspect-square w-full rounded-lg object-cover"
          />
          {item.slideUrls.length > 1 ? (
            <span className="absolute right-1.5 top-1.5 rounded-full bg-bg-nav/85 px-2 py-0.5 text-[11px] font-medium text-text-primary">
              ▦ {item.slideUrls.length}
            </span>
          ) : null}
        </div>
      ) : item.isVideo ? (
        <span className="mt-2 flex aspect-video w-full items-center justify-center rounded-lg bg-bg-nav">
          <PlayGlyph />
        </span>
      ) : null}
      <p className="mt-1.5 line-clamp-2 text-[13px] text-text-secondary">
        {item.caption || item.prompt || "No caption"}
      </p>
      {item.status === "scheduled" && item.scheduledFor ? (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-info">
          <span aria-hidden>🕑</span>
          {formatSydney(item.scheduledFor, { year: undefined })}
        </p>
      ) : null}
    </button>
  );
}
