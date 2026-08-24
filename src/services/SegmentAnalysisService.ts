import { z } from "zod";
import { ProviderCreditsError } from "@/lib/errors";
import { SEGMENT_RANKING_SYSTEM, SEGMENT_SCORING_SYSTEM } from "@/lib/prompts/contentPrompts";
import { completeStructured } from "@/lib/structured";
import type {
  RankedSegment,
  TranscriptRepository,
} from "@/repositories/TranscriptRepository";
import type { TranscriptSegment } from "@/providers/interfaces/TranscriptionProvider";
import type { TextModelProvider } from "@/providers/interfaces/TextModelProvider";
import type { UsageService } from "@/services/UsageService";

const CandidateSchema = z.object({
  start_s: z.number(),
  end_s: z.number(),
  title: z.string(),
  excerpt: z.string(),
  score: z.number().min(0).max(100),
  rationale: z.string(),
});

const ScoringSchema = z.object({ candidates: z.array(CandidateSchema).max(6) });
const RankingSchema = z.object({ segments: z.array(CandidateSchema).max(12) });

// ~8-12k tokens per chunk (docs/API_OPTIMIZATION.md §3); ~4 chars per token.
const CHUNK_CHAR_BUDGET = 36_000;
const CHUNK_OVERLAP_SEGMENTS = 2;

/**
 * Map/reduce segment analysis (fast tier): score chunks with Haiku, then one
 * reduce call ranks the winners. Results persist on the transcript keyed by
 * analysis version — never implicitly re-run (docs/API_OPTIMIZATION.md §2).
 */
export class SegmentAnalysisService {
  constructor(
    private readonly transcriptRepo: TranscriptRepository,
    private readonly textModel: TextModelProvider,
    private readonly usage: UsageService,
  ) {}

  async analyze(sourceVideoId: string, videoTitle: string): Promise<void> {
    const transcript = await this.transcriptRepo.findBySourceVideo(sourceVideoId);
    if (!transcript) throw new Error(`No transcript for video ${sourceVideoId}`);
    // Idempotent: analysis v1 already persisted → a retried job does nothing.
    if (transcript.analysis) return;

    try {
      const chunks = chunkSegments(transcript.segmentMap);
      const allCandidates: Array<z.infer<typeof CandidateSchema>> = [];

      for (const [index, chunk] of chunks.entries()) {
        const { value, completions } = await completeStructured(
          this.textModel,
          {
            system: SEGMENT_SCORING_SYSTEM,
            user: [
              `Video title: ${videoTitle}`,
              "<transcript_chunk>",
              chunk.map((s) => `[${formatTime(s.startS)}-${formatTime(s.endS)}] ${s.text}`).join("\n"),
              "</transcript_chunk>",
            ].join("\n"),
            taskType: "segmentScoring",
            tier: "fast",
            idempotencyKey: `score:${transcript.id}:${index}`,
          },
          ScoringSchema,
        );
        for (const completion of completions) {
          await this.usage.recordTextUsage({
            provider: "anthropic",
            model: completion.model,
            taskType: "segmentScoring",
            inputTokens: completion.inputTokens,
            outputTokens: completion.outputTokens,
            jobRef: sourceVideoId,
            createdBy: null,
          });
        }
        allCandidates.push(...value.candidates);
      }

      let ranked: Array<z.infer<typeof CandidateSchema>>;
      if (allCandidates.length === 0) {
        ranked = [];
      } else {
        const { value, completions } = await completeStructured(
          this.textModel,
          {
            system: SEGMENT_RANKING_SYSTEM,
            user: [
              `Video title: ${videoTitle}`,
              "<candidates>",
              JSON.stringify(allCandidates),
              "</candidates>",
            ].join("\n"),
            taskType: "segmentRanking",
            tier: "fast",
            idempotencyKey: `rank:${transcript.id}`,
          },
          RankingSchema,
        );
        for (const completion of completions) {
          await this.usage.recordTextUsage({
            provider: "anthropic",
            model: completion.model,
            taskType: "segmentRanking",
            inputTokens: completion.inputTokens,
            outputTokens: completion.outputTokens,
            jobRef: sourceVideoId,
            createdBy: null,
          });
        }
        ranked = value.segments;
      }

      const rankedSegments: RankedSegment[] = ranked.map((candidate, index) => ({
        id: `seg-${index + 1}`,
        startS: candidate.start_s,
        endS: candidate.end_s,
        title: candidate.title,
        excerpt: candidate.excerpt,
        score: candidate.score,
        rationale: candidate.rationale,
      }));

      await this.transcriptRepo.setAnalysis(transcript.id, {
        version: 1,
        rankedSegments,
      });
    } catch (error) {
      if (error instanceof ProviderCreditsError) {
        await this.usage.reportCreditsExhausted(error.provider, error.message);
      }
      throw error;
    }
  }
}

export function chunkSegments(segments: TranscriptSegment[]): TranscriptSegment[][] {
  const chunks: TranscriptSegment[][] = [];
  let current: TranscriptSegment[] = [];
  let currentChars = 0;

  for (const segment of segments) {
    if (currentChars + segment.text.length > CHUNK_CHAR_BUDGET && current.length > 0) {
      chunks.push(current);
      // Small overlap so a strong moment on a boundary isn't lost (§3).
      current = current.slice(-CHUNK_OVERLAP_SEGMENTS);
      currentChars = current.reduce((total, s) => total + s.text.length, 0);
    }
    current.push(segment);
    currentChars += segment.text.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
