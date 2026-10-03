/**
 * Recognising a YouTube link, and writing a moment in a video the way a person says it.
 *
 * Pure and dependency-free: the front page uses it to spot a pasted link in the prompt box, the
 * routes use it to refuse anything that is not a YouTube video before a model is called, and the
 * transcript labels (`[12:40]`) are written and read back with the two helpers at the bottom.
 */

export type YouTubeLink = {
  videoId: string;
  /** The canonical watch URL — the one form sent to the model, whatever shape was pasted. */
  url: string;
};

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "youtu.be"]);

/** A YouTube video link in any of its shapes: watch, youtu.be, shorts, live, embed. Null otherwise. */
export function parseYouTubeUrl(value: string): YouTubeLink | null {
  const text = value.trim();
  if (!text) return null;
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!HOSTS.has(host)) return null;
  const segments = parsed.pathname.split("/").filter(Boolean);
  const id = host === "youtu.be"
    ? segments[0]
    : segments[0] === "watch"
      ? parsed.searchParams.get("v")
      : ["shorts", "live", "embed", "v"].includes(segments[0] ?? "")
        ? segments[1]
        : null;
  if (!id || !VIDEO_ID.test(id)) return null;
  return { videoId: id, url: `https://www.youtube.com/watch?v=${id}` };
}

/**
 * The link inside a typed brief, and whatever else was typed around it.
 *
 * The prompt box takes free text, so a link arrives as "https://youtu.be/… " or in the middle of a
 * sentence. Only the first link counts: one video is one lecture.
 */
export function findYouTubeLink(text: string): { link: YouTubeLink; rest: string } | null {
  for (const candidate of text.match(/\S+/g) ?? []) {
    if (!/youtu\.?be/i.test(candidate)) continue;
    const link = parseYouTubeUrl(candidate.replace(/[),.;!?]+$/, ""));
    if (link) return { link, rest: text.replace(candidate, " ").replace(/\s+/g, " ").trim() };
  }
  return null;
}

/** 760 → "12:40"; 3725 → "1:02:05". */
export function formatTimestamp(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "12:40" → 760; "1:02:05" → 3725; a bare number is seconds. Null when it is not a time. */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  if (typeof value !== "string") return null;
  const parts = value.trim().replace(/s$/i, "").split(":");
  if (parts.length === 0 || parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return null;
  return Math.floor(parts.reduce((total, part) => total * 60 + Number(part), 0));
}
