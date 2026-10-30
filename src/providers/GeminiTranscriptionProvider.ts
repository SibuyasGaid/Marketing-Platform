import { z } from "zod";
import { getServerEnv, transcriptionConfig } from "@/lib/config";
import { ProviderCreditsError, ProviderError } from "@/lib/errors";
import type {
  TranscribeInput,
  TranscribeResult,
  TranscriptionProvider,
  TranscriptSegment,
} from "@/providers/interfaces/TranscriptionProvider";

const API_BASE = "https://generativelanguage.googleapis.com";

const TRANSCRIPT_PROMPT = `Transcribe this recording completely and accurately.
Return ONLY valid JSON matching: {"segments": [{"start_s": number, "end_s": number, "text": string}]}
Rules: segments of roughly 15-30 seconds each, covering the entire recording in order; start_s/end_s are seconds from the beginning; text is the verbatim transcript of that span. No markdown, no commentary.`;

interface GeminiFileResource {
  file?: { name?: string; uri?: string; state?: string };
  name?: string;
  uri?: string;
  state?: string;
}

interface GeminiGenerateResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
}

/**
 * Gemini multimodal transcription. Small files go inline; large VODs are
 * streamed from the signed storage URL into the Gemini Files API without
 * buffering the whole video in memory.
 */
export class GeminiTranscriptionProvider implements TranscriptionProvider {
  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    const env = getServerEnv();
    const apiKey = env.GOOGLE_GEMINI_API_KEY;
    const model = transcriptionConfig.model;

    const media = await this.prepareMedia(apiKey, input);

    const body = {
      contents: [
        {
          parts: [
            media.kind === "inline"
              ? { inlineData: { mimeType: input.mimeType, data: media.base64 } }
              : { fileData: { mimeType: input.mimeType, fileUri: media.fileUri } },
            { text: TRANSCRIPT_PROMPT },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: transcriptionConfig.maxOutputTokens,
        responseMimeType: "application/json",
      },
    };

    const response = await fetch(`${API_BASE}/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    }).catch(() => {
      throw new ProviderError("gemini", "Network error calling transcription API", true);
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new ProviderCreditsError("gemini", "Gemini API quota exhausted (transcription)");
      }
      throw new ProviderError(
        "gemini",
        `Transcription API returned ${response.status}`,
        response.status >= 500,
      );
    }

    const payload = (await response.json()) as GeminiGenerateResponse;
    if (payload.promptFeedback?.blockReason) {
      throw new ProviderError("gemini", `Transcription blocked (${payload.promptFeedback.blockReason})`);
    }

    const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const segments = parseSegments(text);
    if (segments.length === 0) {
      throw new ProviderError("gemini", "Transcription returned no parseable segments");
    }

    return {
      fullText: segments.map((segment) => segment.text).join(" "),
      segments,
      model,
      inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }

  private async prepareMedia(
    apiKey: string,
    input: TranscribeInput,
  ): Promise<{ kind: "inline"; base64: string } | { kind: "file"; fileUri: string }> {
    const size = input.sizeBytes ?? Number.MAX_SAFE_INTEGER;

    if (size <= transcriptionConfig.maxInlineBytes) {
      const media = await fetch(input.sourceUrl);
      if (!media.ok) throw new ProviderError("gemini", "Could not read source video", true);
      const buffer = Buffer.from(await media.arrayBuffer());
      return { kind: "inline", base64: buffer.toString("base64") };
    }

    // Large file: resumable upload to the Gemini Files API, streamed from the
    // storage signed URL (no full buffering).
    const media = await fetch(input.sourceUrl);
    if (!media.ok || !media.body) {
      throw new ProviderError("gemini", "Could not stream source video", true);
    }
    const contentLength = media.headers.get("content-length");
    if (!contentLength) {
      throw new ProviderError("gemini", "Source video is missing content-length");
    }

    const start = await fetch(`${API_BASE}/upload/v1beta/files`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "x-goog-upload-protocol": "resumable",
        "x-goog-upload-command": "start",
        "x-goog-upload-header-content-length": contentLength,
        "x-goog-upload-header-content-type": input.mimeType,
        "content-type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: input.idempotencyKey } }),
    });
    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!start.ok || !uploadUrl) {
      throw new ProviderError("gemini", "Could not start file upload", true);
    }

    const upload = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "x-goog-upload-command": "upload, finalize",
        "x-goog-upload-offset": "0",
        "content-length": contentLength,
      },
      body: media.body,
      // Node fetch requires half-duplex for streaming request bodies.
      // @ts-expect-error duplex is a Node/undici extension not in the DOM types
      duplex: "half",
    });
    if (!upload.ok) {
      throw new ProviderError("gemini", `File upload failed (${upload.status})`, true);
    }
    const uploaded = (await upload.json()) as GeminiFileResource;
    const fileName = uploaded.file?.name ?? uploaded.name;
    let fileUri = uploaded.file?.uri ?? uploaded.uri;
    let state = uploaded.file?.state ?? uploaded.state;
    if (!fileName || !fileUri) {
      throw new ProviderError("gemini", "File upload returned no file reference");
    }

    // Wait for server-side processing to finish before referencing the file.
    let attempts = 0;
    while (state === "PROCESSING" && attempts < 60) {
      await sleep(5000);
      const poll = await fetch(`${API_BASE}/v1beta/${fileName}`, {
        headers: { "x-goog-api-key": apiKey },
      });
      if (!poll.ok) throw new ProviderError("gemini", "File status check failed", true);
      const status = (await poll.json()) as GeminiFileResource;
      state = status.state;
      fileUri = status.uri ?? fileUri;
      attempts += 1;
    }
    if (state !== "ACTIVE") {
      throw new ProviderError("gemini", `Uploaded file is not usable (state ${state})`);
    }

    return { kind: "file", fileUri };
  }
}

// The model is asked for snake_case but sometimes answers in camelCase, so
// both spellings are accepted. Anything else fails validation.
const RawSegmentSchema = z.object({
  start_s: z.coerce.number().optional(),
  startS: z.coerce.number().optional(),
  end_s: z.coerce.number().optional(),
  endS: z.coerce.number().optional(),
  text: z.string().optional(),
});
const RawTranscriptSchema = z.object({ segments: z.array(RawSegmentSchema).optional() });

/**
 * Validates the model's transcript JSON (AGENTS.md rule 5). Returns [] for
 * unparseable or off-schema output; the caller turns that into a
 * ProviderError, so a bad response fails the job instead of storing junk.
 */
export function parseSegments(raw: string): TranscriptSegment[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    return [];
  }
  const result = RawTranscriptSchema.safeParse(json);
  if (!result.success) return [];
  return (result.data.segments ?? [])
    .map((segment) => ({
      startS: segment.start_s ?? segment.startS ?? 0,
      endS: segment.end_s ?? segment.endS ?? 0,
      text: (segment.text ?? "").trim(),
    }))
    .filter((segment) => segment.text.length > 0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
