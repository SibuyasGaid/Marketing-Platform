import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranscriptSegment } from "@/providers/interfaces/TranscriptionProvider";

export interface RankedSegment {
  id: string;
  startS: number;
  endS: number;
  title: string;
  excerpt: string;
  score: number;
  rationale: string;
}

export interface TranscriptAnalysis {
  version: number;
  rankedSegments: RankedSegment[];
}

export interface Transcript {
  id: string;
  sourceVideoId: string;
  fullText: string;
  segmentMap: TranscriptSegment[];
  analysis: TranscriptAnalysis | null;
}

interface TranscriptRow {
  id: string;
  source_video_id: string;
  full_text: string;
  segment_map: unknown;
  analysis: unknown;
  analysis_version: number;
}

const COLUMNS = "id, source_video_id, full_text, segment_map, analysis, analysis_version";

/**
 * Only code allowed to touch transcripts. Persisted permanently — a video is
 * transcribed exactly once; analyses are versioned (docs/API_OPTIMIZATION.md §2).
 */
export class TranscriptRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findBySourceVideo(sourceVideoId: string): Promise<Transcript | null> {
    const { data, error } = await this.supabase
      .from("transcripts")
      .select(COLUMNS)
      .eq("source_video_id", sourceVideoId)
      .maybeSingle<TranscriptRow>();
    if (error) throw new Error(`transcripts query failed: ${error.message}`);
    return data ? toDomain(data) : null;
  }

  async create(input: {
    sourceVideoId: string;
    fullText: string;
    segmentMap: TranscriptSegment[];
  }): Promise<Transcript> {
    const { data, error } = await this.supabase
      .from("transcripts")
      .insert({
        source_video_id: input.sourceVideoId,
        full_text: input.fullText,
        segment_map: input.segmentMap,
      })
      .select(COLUMNS)
      .single<TranscriptRow>();
    if (error) throw new Error(`transcripts insert failed: ${error.message}`);
    return toDomain(data);
  }

  async setAnalysis(id: string, analysis: TranscriptAnalysis): Promise<void> {
    const { error } = await this.supabase
      .from("transcripts")
      .update({ analysis, analysis_version: analysis.version })
      .eq("id", id);
    if (error) throw new Error(`transcripts update failed: ${error.message}`);
  }
}

function toDomain(row: TranscriptRow): Transcript {
  return {
    id: row.id,
    sourceVideoId: row.source_video_id,
    fullText: row.full_text,
    segmentMap: Array.isArray(row.segment_map) ? (row.segment_map as TranscriptSegment[]) : [],
    analysis:
      row.analysis && typeof row.analysis === "object"
        ? (row.analysis as TranscriptAnalysis)
        : null,
  };
}
