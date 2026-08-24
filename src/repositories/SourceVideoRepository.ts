import type { SupabaseClient } from "@supabase/supabase-js";
import { NotFoundError } from "@/lib/errors";

export type TranscriptStatus = "pending" | "processing" | "completed" | "failed";

export interface SourceVideo {
  id: string;
  title: string;
  description: string | null;
  storagePath: string | null;
  sourceUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  transcriptStatus: TranscriptStatus;
  createdAt: string;
}

interface SourceVideoRow {
  id: string;
  title: string;
  description: string | null;
  storage_path: string | null;
  source_url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  transcript_status: TranscriptStatus;
  created_at: string;
}

const COLUMNS =
  "id, title, description, storage_path, source_url, mime_type, size_bytes, transcript_status, created_at";

/** Only code allowed to touch source_videos. Service-role writes only. */
export class SourceVideoRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async create(input: {
    title: string;
    description: string | null;
    storagePath: string | null;
    sourceUrl: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    uploadedBy: string;
  }): Promise<SourceVideo> {
    const { data, error } = await this.supabase
      .from("source_videos")
      .insert({
        title: input.title,
        description: input.description,
        storage_path: input.storagePath,
        source_url: input.sourceUrl,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        uploaded_by: input.uploadedBy,
      })
      .select(COLUMNS)
      .single<SourceVideoRow>();
    if (error) throw new Error(`source_videos insert failed: ${error.message}`);
    return toDomain(data);
  }

  async getById(id: string): Promise<SourceVideo> {
    const { data, error } = await this.supabase
      .from("source_videos")
      .select(COLUMNS)
      .eq("id", id)
      .maybeSingle<SourceVideoRow>();
    if (error) throw new Error(`source_videos query failed: ${error.message}`);
    if (!data) throw new NotFoundError("Source video", id);
    return toDomain(data);
  }

  async getByIds(ids: string[]): Promise<SourceVideo[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.supabase
      .from("source_videos")
      .select(COLUMNS)
      .in("id", ids)
      .returns<SourceVideoRow[]>();
    if (error) throw new Error(`source_videos query failed: ${error.message}`);
    return (data ?? []).map(toDomain);
  }

  async list(limit: number): Promise<SourceVideo[]> {
    const { data, error } = await this.supabase
      .from("source_videos")
      .select(COLUMNS)
      .order("created_at", { ascending: false })
      .limit(limit)
      .returns<SourceVideoRow[]>();
    if (error) throw new Error(`source_videos query failed: ${error.message}`);
    return (data ?? []).map(toDomain);
  }

  async setTranscriptStatus(id: string, status: TranscriptStatus): Promise<void> {
    const { error } = await this.supabase
      .from("source_videos")
      .update({ transcript_status: status })
      .eq("id", id);
    if (error) throw new Error(`source_videos update failed: ${error.message}`);
  }

  /**
   * Deletes the source video. Its transcript cascades; any content_items made
   * from it detach (source_video_id on delete set null) and remain in the
   * queue/library. The uploaded file is removed separately by the caller.
   */
  async deleteById(id: string): Promise<void> {
    const { error } = await this.supabase.from("source_videos").delete().eq("id", id);
    if (error) throw new Error(`source_videos delete failed: ${error.message}`);
  }
}

function toDomain(row: SourceVideoRow): SourceVideo {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    storagePath: row.storage_path,
    sourceUrl: row.source_url,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    transcriptStatus: row.transcript_status,
    createdAt: row.created_at,
  };
}
