import { execFile } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import ffmpegStaticPath from "ffmpeg-static";
import { ProviderError } from "@/lib/errors";
import { srtToStyledAss } from "@/lib/captions";
import type {
  AppendOutroInput,
  AppendOutroResult,
  BurnCaptionsInput,
  BurnCaptionsResult,
  ClipInput,
  ClipResult,
  MergeClipsInput,
  MergeClipsResult,
  ThumbnailInput,
  ThumbnailResult,
  VideoClipProvider,
} from "@/providers/interfaces/VideoClipProvider";

const run = promisify(execFile);

// Scale up to cover 1080x1920 then centre-crop to exactly 9:16 (Reels/Shorts).
const VERTICAL_VF = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";

/**
 * The serverless function filesystem is read-only except for the tmp dir, and
 * traced binaries can lose their executable bit. Copy the static binary into
 * tmp once per warm instance and mark it executable there.
 */
function resolveFfmpeg(): string {
  if (!ffmpegStaticPath) {
    throw new ProviderError("ffmpeg", "ffmpeg binary not found in the bundle");
  }
  const runtimePath = join(tmpdir(), basename(ffmpegStaticPath));
  if (!existsSync(runtimePath)) {
    copyFileSync(ffmpegStaticPath, runtimePath);
    try {
      chmodSync(runtimePath, 0o755);
    } catch {
      // Non-fatal on platforms where chmod is unsupported (e.g. Windows).
    }
  }
  return runtimePath;
}

/**
 * Ensures the bundled caption font (Montserrat Bold) is available in a tmp
 * directory that libass can scan via `fontsdir`, and returns that directory. We
 * ship our own font because the serverless runtime has no rounded-bold font
 * installed — relying on a font name libass can't find would fall back to a
 * default (or nothing). Returns null if the font isn't present, so caption
 * burning still works with libass's default font rather than failing.
 */
function resolveFontsDir(): string | null {
  // The font is force-included in the serverless bundle via
  // next.config.ts outputFileTracingIncludes, resolved from the project root.
  const candidates = [
    join(process.cwd(), "src/assets/fonts/Montserrat-Bold.ttf"),
    join(process.cwd(), ".next/server/src/assets/fonts/Montserrat-Bold.ttf"),
  ];
  const src = candidates.find((path) => existsSync(path));
  if (!src) return null;
  const fontsDir = join(tmpdir(), "caption-fonts");
  const dest = join(fontsDir, "Montserrat-Bold.ttf");
  if (!existsSync(dest)) {
    try {
      mkdirSync(fontsDir, { recursive: true });
      copyFileSync(src, dest);
    } catch {
      return null;
    }
  }
  return fontsDir;
}

/**
 * Cuts a segment with a stream copy (no re-encode) so it is fast and cheap, and
 * relocates the moov atom (+faststart) so the clip plays instantly in a browser.
 * Reads the source over HTTP and range-seeks, so a large source is never fully
 * downloaded.
 */
export class FfmpegClipProvider implements VideoClipProvider {
  async clip(input: ClipInput): Promise<ClipResult> {
    const durationS = Math.max(1, input.endS - input.startS);
    const ffmpeg = resolveFfmpeg();
    const outPath = join(tmpdir(), `${randomUUID()}.mp4`);

    // Vertical needs re-encoding (a filter can't stream-copy); landscape/source
    // stays a fast stream copy.
    const encodeArgs = input.vertical
      ? ["-vf", VERTICAL_VF, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac"]
      : ["-c", "copy"];

    try {
      await run(
        ffmpeg,
        [
          "-ss",
          String(input.startS),
          "-i",
          input.sourceUrl,
          "-t",
          String(durationS),
          ...encodeArgs,
          "-movflags",
          "+faststart",
          "-y",
          outPath,
        ],
        { maxBuffer: 1 << 26, timeout: 240_000 },
      );
      const bytes = readFileSync(outPath);
      if (bytes.length === 0) {
        throw new ProviderError("ffmpeg", "Clip render produced an empty file", true);
      }
      return { bytes, mimeType: "video/mp4", durationS };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const message = error instanceof Error ? error.message : "clip render failed";
      throw new ProviderError("ffmpeg", `Clip render failed: ${message}`, true);
    } finally {
      rmSync(outPath, { force: true });
    }
  }

  async thumbnail(input: ThumbnailInput): Promise<ThumbnailResult> {
    const ffmpeg = resolveFfmpeg();
    const outPath = join(tmpdir(), `${randomUUID()}.jpg`);
    const filterArgs = input.vertical ? ["-vf", VERTICAL_VF] : [];

    try {
      await run(
        ffmpeg,
        [
          "-ss",
          String(Math.max(0, input.atS)),
          "-i",
          input.sourceUrl,
          "-frames:v",
          "1",
          ...filterArgs,
          "-q:v",
          "3",
          "-y",
          outPath,
        ],
        { maxBuffer: 1 << 26, timeout: 120_000 },
      );
      const bytes = readFileSync(outPath);
      if (bytes.length === 0) {
        throw new ProviderError("ffmpeg", "Thumbnail render produced an empty file", true);
      }
      return { bytes, mimeType: "image/jpeg" };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const message = error instanceof Error ? error.message : "thumbnail render failed";
      throw new ProviderError("ffmpeg", `Thumbnail render failed: ${message}`, true);
    } finally {
      rmSync(outPath, { force: true });
    }
  }

  /**
   * Burns bold, centered, lower-third captions into a video from an SRT. The SRT
   * is converted to a styled ASS (libass) so we control font weight, size,
   * outline, and position — the trendy Reels caption look HeyGen's API can't
   * produce. Re-encodes video (a filter can't stream-copy); audio is copied.
   */
  async burnCaptions(input: BurnCaptionsInput): Promise<BurnCaptionsResult> {
    const ffmpeg = resolveFfmpeg();
    const assPath = join(tmpdir(), `${randomUUID()}.ass`);
    const outPath = join(tmpdir(), `${randomUUID()}.mp4`);

    try {
      writeFileSync(assPath, srtToStyledAss(input.srt), "utf8");
      // libass reads the file via the subtitles filter. On Windows the path
      // needs its backslashes and drive-colon escaped for the filter parser.
      const filterPath = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
      // Point libass at our bundled font dir so the Montserrat style resolves.
      const fontsDir = resolveFontsDir();
      const fontsArg = fontsDir
        ? `:fontsdir='${fontsDir.replace(/\\/g, "/").replace(/:/g, "\\:")}'`
        : "";

      await run(
        ffmpeg,
        [
          "-i",
          input.sourceUrl,
          "-vf",
          `subtitles='${filterPath}'${fontsArg}`,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "20",
          "-c:a",
          "copy",
          "-movflags",
          "+faststart",
          "-y",
          outPath,
        ],
        { maxBuffer: 1 << 26, timeout: 240_000 },
      );
      const bytes = readFileSync(outPath);
      if (bytes.length === 0) {
        throw new ProviderError("ffmpeg", "Caption burn produced an empty file", true);
      }
      return { bytes, mimeType: "video/mp4" };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const message = error instanceof Error ? error.message : "caption burn failed";
      throw new ProviderError("ffmpeg", `Caption burn failed: ${message}`, true);
    } finally {
      rmSync(assPath, { force: true });
      rmSync(outPath, { force: true });
    }
  }

  /** Appends an outro to a video — a two-clip merge (main, then outro). */
  async appendOutro(input: AppendOutroInput): Promise<AppendOutroResult> {
    return this.mergeClips({ sourceUrls: [input.sourceUrl, input.outroUrl] });
  }

  /**
   * Stitches 2+ videos into one, in order. Two passes for robustness: normalize
   * EACH clip to an identical format (1080x1920, 30fps, H.264 + AAC stereo 48k) —
   * padding to 9:16 and adding a SILENT audio track when a clip has none — then
   * concatenate the normalized clips with the concat demuxer (stream copy). This
   * avoids fragile single-command filtergraph branching over mismatched inputs,
   * and it's pure ffmpeg: no AI, no credits.
   */
  async mergeClips(input: MergeClipsInput): Promise<MergeClipsResult> {
    if (input.sourceUrls.length < 2) {
      throw new ProviderError("ffmpeg", "Need at least two videos to merge.");
    }
    const ffmpeg = resolveFfmpeg();
    // Video: scale to fit inside 1080x1920, pad to exact size, 30fps, yuv420p.
    const vf =
      "scale=1080:1920:force_original_aspect_ratio=decrease," +
      "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p";
    const normalized: string[] = [];
    const listPath = join(tmpdir(), `${randomUUID()}.txt`);
    const outPath = join(tmpdir(), `${randomUUID()}.mp4`);

    try {
      // Normalize each clip to an identical layout with exactly one audio stream
      // (its own, or a silent bed when it has none), so the concat demuxer can
      // stream-copy them together.
      for (const sourceUrl of input.sourceUrls) {
        const dest = join(tmpdir(), `${randomUUID()}.mp4`);
        await this.normalizeWithSilentAudio(ffmpeg, sourceUrl, dest, vf);
        normalized.push(dest);
      }

      writeFileSync(
        listPath,
        normalized.map((path) => `file '${path.replace(/\\/g, "/")}'`).join("\n") + "\n",
        "utf8",
      );
      await run(
        ffmpeg,
        [
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listPath,
          "-c",
          "copy",
          "-movflags",
          "+faststart",
          "-y",
          outPath,
        ],
        { maxBuffer: 1 << 26, timeout: 240_000 },
      );
      const bytes = readFileSync(outPath);
      if (bytes.length === 0) {
        throw new ProviderError("ffmpeg", "Merge produced an empty file", true);
      }
      return { bytes, mimeType: "video/mp4" };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const message = error instanceof Error ? error.message : "merge failed";
      throw new ProviderError("ffmpeg", `Merge failed: ${message}`, true);
    } finally {
      for (const path of normalized) rmSync(path, { force: true });
      rmSync(listPath, { force: true });
      rmSync(outPath, { force: true });
    }
  }

  /**
   * Normalizes a clip to 1080x1920/30fps H.264 with EXACTLY one AAC stereo 48k
   * audio track. Because this ffmpeg build rejects optional stream specifiers
   * (`0:a?`) inside filtergraphs, we first probe whether the clip has audio: if
   * it does, we re-encode its own audio; if not, we attach a silent stereo bed
   * trimmed to the video length. Either way both outputs share an identical
   * layout so the concat demuxer can stream-copy them together.
   */
  private async normalizeWithSilentAudio(
    ffmpeg: string,
    src: string,
    dest: string,
    vf: string,
  ): Promise<void> {
    const hasAudio = await this.hasAudioStream(ffmpeg, src);
    // Shared encode tail. NOTE: no `-shortest` here — it would truncate a clip
    // whose video runs slightly longer than its audio down to the audio length.
    const encodeTail = [
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-video_track_timescale",
      "15360",
      "-y",
      dest,
    ];
    const args = hasAudio
      ? ["-i", src, "-vf", vf, "-map", "0:v:0", "-map", "0:a:0", ...encodeTail]
      : [
          "-i",
          src,
          "-f",
          "lavfi",
          "-t",
          "3600",
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=48000",
          "-vf",
          vf,
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          // The silent bed is 3600s; trim it to the video so the clip isn't padded.
          "-shortest",
          ...encodeTail,
        ];
    await run(ffmpeg, args, { maxBuffer: 1 << 26, timeout: 240_000 });
  }

  /** True if the clip has at least one audio stream (parses `ffmpeg -i` output). */
  private async hasAudioStream(ffmpeg: string, src: string): Promise<boolean> {
    try {
      // `ffmpeg -i` with no output exits non-zero but prints stream info to
      // stderr; run() rejects, so read the error's stderr.
      await run(ffmpeg, ["-i", src], { maxBuffer: 1 << 26, timeout: 60_000 });
      return false;
    } catch (error) {
      const stderr =
        typeof error === "object" && error && "stderr" in error
          ? String((error as { stderr?: unknown }).stderr ?? "")
          : "";
      return /Stream #\d+:\d+.*: Audio:/.test(stderr);
    }
  }
}
