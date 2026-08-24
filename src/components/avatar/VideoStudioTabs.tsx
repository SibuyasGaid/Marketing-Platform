"use client";

import { useState } from "react";
import { AvatarStudio, type AccountAvatars } from "@/components/avatar/AvatarStudio";
import { ClipStudio } from "@/components/avatar/ClipStudio";
import {
  CombineStudio,
  type CombineSourceOption,
} from "@/components/avatar/CombineStudio";
import { GeneratedVideos, type GeneratedVideoView } from "@/components/avatar/GeneratedVideos";
import { useGenerationStatusRefresh } from "@/components/hooks/useGenerationStatusRefresh";

const POLL_MS = 10_000;

/**
 * The Generate Videos tab: "Compose" (the studio), "Combine" (stitch several
 * videos into one via ffmpeg — no credits), and "Generated videos" (the holding
 * area where renders land to review, caption, and send to the Approval Queue).
 * Nothing here auto-enters the queue.
 */
export function VideoStudioTabs({
  accounts,
  canCreate,
  videos,
  combineLibrary,
}: {
  accounts: AccountAvatars[];
  canCreate: boolean;
  videos: GeneratedVideoView[];
  combineLibrary: CombineSourceOption[];
}) {
  const [tab, setTab] = useState<"compose" | "combine" | "generated">("compose");
  const [mode, setMode] = useState<"avatar" | "clip">("avatar");
  const rendering = videos.filter((v) => v.state === "rendering").length;

  // Poll at the tab level (not just inside Generated videos) so the "N rendering"
  // badge stays live even while the user is still on Compose. Uses the lightweight
  // status endpoint and only pulls fresh content when a render's state changes.
  useGenerationStatusRefresh("videos", rendering > 0, POLL_MS);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        <TabButton active={tab === "compose"} onClick={() => setTab("compose")}>
          Compose
        </TabButton>
        <TabButton active={tab === "combine"} onClick={() => setTab("combine")}>
          Combine
        </TabButton>
        <TabButton active={tab === "generated"} onClick={() => setTab("generated")}>
          Generated videos
          {videos.length > 0 ? (
            <span className="ml-1.5 rounded-full bg-bg-base px-1.5 py-0.5 text-[11px] text-text-faint">
              {rendering > 0 ? `${rendering} rendering` : videos.length}
            </span>
          ) : null}
        </TabButton>
      </div>

      {tab === "combine" ? (
        <CombineStudio
          accounts={accounts.map((a) => ({ slug: a.slug, name: a.name }))}
          library={combineLibrary}
          canCreate={canCreate}
        />
      ) : tab === "compose" ? (
        <div className="flex flex-col gap-4">
          {/* Mode: an avatar speaking, or a prompt-driven visual clip. */}
          <div className="flex gap-1.5">
            <TabButton active={mode === "avatar"} onClick={() => setMode("avatar")}>
              Avatar video
            </TabButton>
            <TabButton active={mode === "clip"} onClick={() => setMode("clip")}>
              Visual clips
            </TabButton>
          </div>
          {mode === "avatar" ? (
            <AvatarStudio
              accounts={accounts}
              canCreate={canCreate}
              onGenerated={() => setTab("generated")}
            />
          ) : (
            <ClipStudio
              accounts={accounts.map((a) => ({ slug: a.slug, name: a.name }))}
              canCreate={canCreate}
              onGenerated={() => setTab("generated")}
            />
          )}
        </div>
      ) : (
        <GeneratedVideos videos={videos} canManage={canCreate} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center rounded-full px-4 py-1.5 font-display text-[13px] font-medium transition-colors ${
        active
          ? "bg-primary text-text-primary"
          : "border border-border-subtle text-text-secondary hover:bg-bg-hover"
      }`}
    >
      {children}
    </button>
  );
}
