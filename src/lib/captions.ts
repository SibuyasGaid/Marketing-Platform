/**
 * SRT → styled ASS conversion for burned-in social captions.
 *
 * Produces the bold, centered, lower-third caption look common on Reels/TikTok
 * (big white text, heavy black outline, one short phrase at a time). HeyGen's
 * API only exposes a plain "default" caption style, so we take its sidecar SRT
 * and restyle it ourselves, then ffmpeg burns the ASS in via libass.
 *
 * Pure and dependency-free so it can be unit-tested without ffmpeg.
 */

/** One subtitle cue: times in centiseconds (ASS resolution), and its text. */
export interface Cue {
  startCs: number;
  endCs: number;
  text: string;
}

// Canvas the ASS is authored against. ffmpeg's subtitles filter scales this to
// the actual video, so 1080x1920 (9:16) keeps proportions right for Reels.
const PLAY_RES_X = 1080;
const PLAY_RES_Y = 1920;

/**
 * ASS style tuned to the reference look: bold rounded Montserrat, large, pure
 * white, a clean thin-ish black outline and a soft drop shadow, centered, sat
 * above the bottom edge (lower-third). Alignment 2 = bottom-center; MarginV
 * lifts it off the edge.
 *
 * Fields: Fontname=Montserrat (bundled TTF; libass loads it via fontsdir),
 * Fontsize=88, PrimaryColour white, OutlineColour black, BackColour semi shadow,
 * Bold=-1, Outline=4, Shadow=2, Alignment=2, MarginL/R=120 (safe gutter so text
 * never touches the edges), MarginV=260.
 */
const ASS_STYLE = [
  "Style: Caption,Montserrat,88,&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,",
  "-1,0,0,0,100,100,0,0,1,4,2,2,120,120,260,1",
].join("");

const ASS_HEADER = [
  "[Script Info]",
  "ScriptType: v4.00+",
  // 0 = smart auto-wrapping within the margins. (2 = no wrapping, which let long
  // lines run off the sides of the video.)
  "WrapStyle: 0",
  "ScaledBorderAndShadow: yes",
  `PlayResX: ${PLAY_RES_X}`,
  `PlayResY: ${PLAY_RES_Y}`,
  "",
  "[V4+ Styles]",
  "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
  ASS_STYLE,
  "",
  "[Events]",
  "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
].join("\n");

/** Parses "HH:MM:SS,mmm" (SRT) into centiseconds. */
function srtTimeToCs(value: string): number {
  const match = value.trim().match(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/);
  if (!match) return 0;
  const [, hh, mm, ss, ms] = match;
  const millis = Number(ms.padEnd(3, "0"));
  return (Number(hh) * 3600 + Number(mm) * 60 + Number(ss)) * 100 + Math.round(millis / 10);
}

/** Formats centiseconds as ASS "H:MM:SS.cc". */
function csToAssTime(cs: number): string {
  const totalCs = Math.max(0, Math.round(cs));
  const h = Math.floor(totalCs / 360000);
  const m = Math.floor((totalCs % 360000) / 6000);
  const s = Math.floor((totalCs % 6000) / 100);
  const c = totalCs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** Parses SRT text into cues. Tolerant of CRLF and missing trailing newline. */
export function parseSrt(srt: string): Cue[] {
  const blocks = srt.replace(/\r\n/g, "\n").trim().split(/\n\s*\n/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const timeLineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeLineIndex === -1) continue;
    const [start, end] = lines[timeLineIndex].split("-->");
    const text = lines
      .slice(timeLineIndex + 1)
      .join(" ")
      .trim();
    if (!text) continue;
    cues.push({ startCs: srtTimeToCs(start), endCs: srtTimeToCs(end), text });
  }
  return cues;
}

/** Escapes text for an ASS dialogue line (braces start override blocks). */
function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\n/g, "\\N");
}

/** A transcript span: seconds-based times and its text (matches TranscriptSegment). */
export interface TimedSegment {
  startS: number;
  endS: number;
  text: string;
}

/** Formats seconds as an SRT timestamp "HH:MM:SS,mmm". */
function secToSrtTime(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

/**
 * Builds SRT from transcript segments, splitting each into short on-screen cues
 * (≤ maxWords words) so captions read as punchy phrases rather than long
 * paragraphs — the Reels look. Cue time is apportioned evenly across the
 * segment's words. Used to re-caption already-rendered videos that have no SRT.
 */
export function segmentsToSrt(segments: TimedSegment[], maxWords = 4): string {
  const cues: Cue[] = [];
  for (const segment of segments) {
    const words = segment.text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    // Skip segments with unusable timing (NaN/Infinity/negative or end<=start),
    // which would otherwise emit cues that never display (silent no-captions).
    const start = Number(segment.startS);
    const end = Number(segment.endS);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) continue;
    const span = end - start;
    const perWord = span / words.length;
    for (let i = 0; i < words.length; i += maxWords) {
      const chunk = words.slice(i, i + maxWords);
      const chunkStart = start + i * perWord;
      const chunkEnd = start + Math.min(words.length, i + maxWords) * perWord;
      cues.push({
        startCs: Math.round(chunkStart * 100),
        endCs: Math.round(chunkEnd * 100),
        text: chunk.join(" "),
      });
    }
  }
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${secToSrtTime(cue.startCs / 100)} --> ${secToSrtTime(
          cue.endCs / 100,
        )}\n${cue.text}`,
    )
    .join("\n\n");
}

/** Converts SRT subtitle text into a fully styled ASS document. */
export function srtToStyledAss(srt: string): string {
  const cues = parseSrt(srt);
  const events = cues.map(
    (cue) =>
      `Dialogue: 0,${csToAssTime(cue.startCs)},${csToAssTime(cue.endCs)},Caption,,0,0,0,,${escapeAssText(
        cue.text,
      )}`,
  );
  return `${ASS_HEADER}\n${events.join("\n")}\n`;
}
