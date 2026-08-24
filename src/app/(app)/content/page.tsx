import { CompetitorsCard, type CompetitorView } from "@/components/content/CompetitorsCard";
import { IngestPanel } from "@/components/content/IngestPanel";
import { VideoPipelineList, type VideoView } from "@/components/content/VideoPipelineList";
import { WeeklyBatchCard } from "@/components/content/WeeklyBatchCard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AccountRepository, fallbackAccounts } from "@/repositories/AccountRepository";
import { CompetitorRepository } from "@/repositories/CompetitorRepository";
import { ProfileRepository } from "@/repositories/ProfileRepository";
import { SourceVideoRepository } from "@/repositories/SourceVideoRepository";
import { TranscriptRepository } from "@/repositories/TranscriptRepository";

export const metadata = { title: "Content Engine · Content Studio" };
export const dynamic = "force-dynamic";

export default async function ContentEnginePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user
    ? await new ProfileRepository(supabase).getById(user.id).catch(() => null)
    : null;

  const admin = createSupabaseAdminClient();
  const [competitors, videos] = await Promise.all([
    new CompetitorRepository(admin).listActive(),
    new SourceVideoRepository(admin).list(20),
  ]);
  const accountList = await new AccountRepository(admin).listActive().catch(() => fallbackAccounts());
  const accounts = (accountList.length > 0 ? accountList : fallbackAccounts()).map((account) => ({
    slug: account.slug,
    name: account.name,
  }));

  const transcriptRepo = new TranscriptRepository(admin);
  const videoViews: VideoView[] = await Promise.all(
    videos.map(async (video) => {
      const transcript =
        video.transcriptStatus === "completed"
          ? await transcriptRepo.findBySourceVideo(video.id)
          : null;
      return {
        id: video.id,
        title: video.title,
        transcriptStatus: video.transcriptStatus,
        hasAnalysis: Boolean(transcript?.analysis),
        segments:
          transcript?.analysis?.rankedSegments.map((segment) => ({
            id: segment.id,
            title: segment.title,
            excerpt: segment.excerpt,
            score: segment.score,
            rationale: segment.rationale,
            startS: segment.startS,
            endS: segment.endS,
          })) ?? [],
        createdAt: video.createdAt,
      };
    }),
  );

  const competitorViews: CompetitorView[] = competitors.map((competitor) => ({
    id: competitor.id,
    name: competitor.name,
    websiteUrl: competitor.websiteUrl,
    socialHandles: competitor.socialHandles,
  }));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary">
        Turn a recording into ready-to-post clips and captions, or generate a whole week of image
        posts in one click. Everything you create here lands in the Approval Queue for review.
      </p>
      <WeeklyBatchCard accounts={accounts} />
      <div className="grid gap-4 lg:grid-cols-2">
        <IngestPanel />
        <CompetitorsCard
          competitors={competitorViews}
          canEdit={profile?.role !== "reviewer"}
        />
      </div>
      <VideoPipelineList
        videos={videoViews}
        accounts={accounts}
        canManage={profile?.role !== "reviewer"}
      />
    </div>
  );
}
