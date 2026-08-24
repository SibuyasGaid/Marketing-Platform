import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AnthropicResearchProvider } from "@/providers/AnthropicResearchProvider";
import { AnthropicTextProvider } from "@/providers/AnthropicTextProvider";
import { DirectPublishProvider } from "@/providers/DirectPublishProvider";
import { FfmpegClipProvider } from "@/providers/FfmpegClipProvider";
import { GeminiImageProvider } from "@/providers/GeminiImageProvider";
import { LinkedInPublishProvider } from "@/providers/LinkedInPublishProvider";
import { MetaPublishProvider } from "@/providers/MetaPublishProvider";
import { GeminiTranscriptionProvider } from "@/providers/GeminiTranscriptionProvider";
import { HeyGenVideoProvider } from "@/providers/HeyGenVideoProvider";
import { N8nPublishProvider } from "@/providers/N8nPublishProvider";
import { ResendEmailProvider } from "@/providers/ResendEmailProvider";
import { YouTubePublishProvider } from "@/providers/YouTubePublishProvider";
import { inngest } from "@/inngest/client";
import { AccountRepository } from "@/repositories/AccountRepository";
import { AiUsageRepository } from "@/repositories/AiUsageRepository";
import { ApprovalEventRepository } from "@/repositories/ApprovalEventRepository";
import { AvatarReferenceRepository } from "@/repositories/AvatarReferenceRepository";
import { BrandPresetRepository } from "@/repositories/BrandPresetRepository";
import { BrandReferenceRepository } from "@/repositories/BrandReferenceRepository";
import { CompetitorReportRepository } from "@/repositories/CompetitorReportRepository";
import { CompetitorRepository } from "@/repositories/CompetitorRepository";
import { ContentCalendarRepository } from "@/repositories/ContentCalendarRepository";
import { ContentItemRepository } from "@/repositories/ContentItemRepository";
import { JobRepository } from "@/repositories/JobRepository";
import { ProfileRepository } from "@/repositories/ProfileRepository";
import { ProviderAlertRepository } from "@/repositories/ProviderAlertRepository";
import { SourceVideoRepository } from "@/repositories/SourceVideoRepository";
import { TranscriptRepository } from "@/repositories/TranscriptRepository";
import { CompetitorDigestService } from "@/services/CompetitorDigestService";
import { ClipRenderService } from "@/services/ClipRenderService";
import { ContentApprovalService } from "@/services/ContentApprovalService";
import { ContentCalendarService } from "@/services/ContentCalendarService";
import { ContentProductionService } from "@/services/ContentProductionService";
import { ContentRegenerationService } from "@/services/ContentRegenerationService";
import { ImageGenerationService } from "@/services/ImageGenerationService";
import { PostCaptionService } from "@/services/PostCaptionService";
import { SegmentAnalysisService } from "@/services/SegmentAnalysisService";
import { TranscriptionService } from "@/services/TranscriptionService";
import { UsageService } from "@/services/UsageService";
import { WeeklyBatchService } from "@/services/WeeklyBatchService";
import type { EmailProvider } from "@/providers/interfaces/EmailProvider";
import type { ImageGenProvider } from "@/providers/interfaces/ImageGenProvider";
import type { PublishProvider } from "@/providers/interfaces/PublishProvider";
import type { ResearchProvider } from "@/providers/interfaces/ResearchProvider";
import type { TextModelProvider } from "@/providers/interfaces/TextModelProvider";
import type { TranscriptionProvider } from "@/providers/interfaces/TranscriptionProvider";
import type { VideoClipProvider } from "@/providers/interfaces/VideoClipProvider";
import type { VideoProvider } from "@/providers/interfaces/VideoProvider";

/**
 * Composition root (docs/CODING_STANDARDS.md §2, Dependency Inversion).
 * The only place concrete providers are instantiated. Services receive
 * interfaces; swapping Resend→SendGrid or n8n→Zernio happens here alone.
 */
export interface Container {
  emailProvider: EmailProvider;
  publishProvider: PublishProvider;
  imageGenProvider: ImageGenProvider;
  textModelProvider: TextModelProvider;
  videoProvider: VideoProvider;
  videoClipProvider: VideoClipProvider;
  transcriptionProvider: TranscriptionProvider;
  researchProvider: ResearchProvider;
}

let container: Container | null = null;

export function getContainer(): Container {
  if (container) return container;
  container = {
    emailProvider: new ResendEmailProvider(),
    // Facebook/Instagram via Meta, LinkedIn via its REST API, YouTube via the
    // YouTube Data API; anything else falls back to n8n.
    publishProvider: new DirectPublishProvider(
      new MetaPublishProvider(),
      new LinkedInPublishProvider(),
      new YouTubePublishProvider(),
      new N8nPublishProvider(),
    ),
    imageGenProvider: new GeminiImageProvider(),
    textModelProvider: new AnthropicTextProvider(),
    videoProvider: new HeyGenVideoProvider(),
    videoClipProvider: new FfmpegClipProvider(),
    transcriptionProvider: new GeminiTranscriptionProvider(),
    researchProvider: new AnthropicResearchProvider(),
  };
  return container;
}

/* Services are memoized separately because they construct the Supabase admin
 * client, which needs env at call time (server-side only). */

let usageService: UsageService | null = null;

export function getUsageService(): UsageService {
  if (usageService) return usageService;
  const admin = createSupabaseAdminClient();
  usageService = new UsageService(
    new AiUsageRepository(admin),
    new ProviderAlertRepository(admin),
  );
  return usageService;
}

let postCaptionService: PostCaptionService | null = null;

export function getPostCaptionService(): PostCaptionService {
  if (postCaptionService) return postCaptionService;
  postCaptionService = new PostCaptionService(
    getContainer().textModelProvider,
    getUsageService(),
  );
  return postCaptionService;
}

let imageGenerationService: ImageGenerationService | null = null;

export function getImageGenerationService(): ImageGenerationService {
  if (imageGenerationService) return imageGenerationService;
  const admin = createSupabaseAdminClient();
  imageGenerationService = new ImageGenerationService(
    new ContentItemRepository(admin),
    new BrandPresetRepository(admin),
    new AvatarReferenceRepository(admin),
    new BrandReferenceRepository(admin),
    new AccountRepository(admin),
    new JobRepository(admin),
    getContainer().imageGenProvider,
    getUsageService(),
    getPostCaptionService(),
    admin,
    async (event) => {
      await inngest.send(event);
    },
  );
  return imageGenerationService;
}

let transcriptionService: TranscriptionService | null = null;

export function getTranscriptionService(): TranscriptionService {
  if (transcriptionService) return transcriptionService;
  const admin = createSupabaseAdminClient();
  transcriptionService = new TranscriptionService(
    new SourceVideoRepository(admin),
    new TranscriptRepository(admin),
    getContainer().transcriptionProvider,
    getUsageService(),
    admin,
    async (event) => {
      await inngest.send(event);
    },
  );
  return transcriptionService;
}

let segmentAnalysisService: SegmentAnalysisService | null = null;

export function getSegmentAnalysisService(): SegmentAnalysisService {
  if (segmentAnalysisService) return segmentAnalysisService;
  const admin = createSupabaseAdminClient();
  segmentAnalysisService = new SegmentAnalysisService(
    new TranscriptRepository(admin),
    getContainer().textModelProvider,
    getUsageService(),
  );
  return segmentAnalysisService;
}

let contentProductionService: ContentProductionService | null = null;

export function getContentProductionService(): ContentProductionService {
  if (contentProductionService) return contentProductionService;
  const admin = createSupabaseAdminClient();
  contentProductionService = new ContentProductionService(
    new ContentItemRepository(admin),
    new TranscriptRepository(admin),
    new SourceVideoRepository(admin),
    new AvatarReferenceRepository(admin),
    new AccountRepository(admin),
    getContainer().textModelProvider,
    getContainer().videoProvider,
    getContainer().videoClipProvider,
    getContainer().transcriptionProvider,
    getUsageService(),
    admin,
  );
  return contentProductionService;
}

let clipRenderService: ClipRenderService | null = null;

export function getClipRenderService(): ClipRenderService {
  if (clipRenderService) return clipRenderService;
  const admin = createSupabaseAdminClient();
  clipRenderService = new ClipRenderService(
    new ContentItemRepository(admin),
    new SourceVideoRepository(admin),
    new JobRepository(admin),
    getContainer().videoClipProvider,
    admin,
  );
  return clipRenderService;
}

let competitorDigestService: CompetitorDigestService | null = null;

export function getCompetitorDigestService(): CompetitorDigestService {
  if (competitorDigestService) return competitorDigestService;
  const admin = createSupabaseAdminClient();
  competitorDigestService = new CompetitorDigestService(
    new CompetitorRepository(admin),
    new CompetitorReportRepository(admin),
    new ProfileRepository(admin),
    getContainer().researchProvider,
    getContainer().emailProvider,
    getUsageService(),
  );
  return competitorDigestService;
}

let contentApprovalService: ContentApprovalService | null = null;

export function getContentApprovalService(): ContentApprovalService {
  if (contentApprovalService) return contentApprovalService;
  const admin = createSupabaseAdminClient();
  contentApprovalService = new ContentApprovalService(
    new ContentItemRepository(admin),
    new ApprovalEventRepository(admin),
    getContainer().publishProvider,
    admin,
    async (event) => {
      await inngest.send(event);
    },
  );
  return contentApprovalService;
}

let contentRegenerationService: ContentRegenerationService | null = null;

export function getContentRegenerationService(): ContentRegenerationService {
  if (contentRegenerationService) return contentRegenerationService;
  const admin = createSupabaseAdminClient();
  contentRegenerationService = new ContentRegenerationService(
    new ContentItemRepository(admin),
    new JobRepository(admin),
  );
  return contentRegenerationService;
}

let contentCalendarService: ContentCalendarService | null = null;

export function getContentCalendarService(): ContentCalendarService {
  if (contentCalendarService) return contentCalendarService;
  const admin = createSupabaseAdminClient();
  contentCalendarService = new ContentCalendarService(
    new ContentCalendarRepository(admin),
    new ContentItemRepository(admin),
    new BrandPresetRepository(admin),
    new JobRepository(admin),
    getImageGenerationService(),
    getPostCaptionService(),
  );
  return contentCalendarService;
}

let weeklyBatchService: WeeklyBatchService | null = null;

export function getWeeklyBatchService(): WeeklyBatchService {
  if (weeklyBatchService) return weeklyBatchService;
  const admin = createSupabaseAdminClient();
  weeklyBatchService = new WeeklyBatchService(
    new ContentItemRepository(admin),
    new BrandPresetRepository(admin),
    new JobRepository(admin),
    getImageGenerationService(),
    getPostCaptionService(),
  );
  return weeklyBatchService;
}
