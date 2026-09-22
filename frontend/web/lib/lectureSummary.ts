import { findStubLine, normalizeLanguage, type CodeLanguage } from "./codeSpec";

/**
 * The one-slide summary of a finished lecture: its crux, the few points that carry it, and — when
 * the lecture was about code — the one snippet worth remembering.
 *
 * WHY THIS EXISTS. Lectures used to close on a recap beat (often two), repeating what the student
 * had just heard at the length of a full board. They asked for lectures strictly on their question
 * and a summary they can open WHEN THEY CHOOSE, once the lecture is done. This is that summary; it
 * is written from what the beats actually taught and nothing else.
 */
export type LectureSummary = {
  title: string;
  /** The single idea to remember, in one or two sentences. */
  crux: string;
  /** 3-6 short lines, in lecture order. */
  points: string[];
  code?: string;
  language?: CodeLanguage;
};

export type SummaryBeatInput = { title: string; points?: string[]; script?: string };

const MAX_POINTS = 6;
const MAX_POINT_CHARS = 140;
const MAX_CODE_LINES = 10;

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/**
 * What the summarizer reads: every beat's title, points and script, in order, within a budget.
 *
 * The budget is split evenly so a long early beat cannot crowd the last beats out of the summary —
 * the crux of a lecture is usually where it ends up, not where it starts.
 */
export function summaryTranscript(beats: SummaryBeatInput[], budget = 12_000): string {
  const usable = beats.filter((beat) => beat.title?.trim() || beat.script?.trim());
  if (usable.length === 0) return "";
  const perBeat = Math.max(300, Math.floor(budget / usable.length));
  return usable
    .map((beat, index) => {
      const points = (beat.points ?? []).filter(Boolean).slice(0, 4).map((p) => `- ${clean(p, 160)}`).join("\n");
      const script = clean(beat.script, perBeat);
      return [`## ${index + 1}. ${clean(beat.title, 120)}`, points, script].filter(Boolean).join("\n");
    })
    .join("\n\n")
    .slice(0, budget);
}

/** A validated summary, or null with the reason — never throws. */
export function parseLectureSummary(raw: unknown, fallbackTitle = "Lecture summary"): { summary: LectureSummary | null; issue?: string } {
  if (!raw || typeof raw !== "object") return { summary: null, issue: "not a JSON object" };
  const o = raw as Record<string, unknown>;
  const crux = clean(o.crux, 320);
  if (!crux) return { summary: null, issue: "`crux` is empty — state the one idea to remember" };
  const points = (Array.isArray(o.points) ? o.points : [])
    .map((p) => clean(p, MAX_POINT_CHARS))
    .filter(Boolean)
    .slice(0, MAX_POINTS);
  if (points.length < 2) return { summary: null, issue: "give 3-6 short `points`, in lecture order" };

  const summary: LectureSummary = { title: clean(o.title, 80) || fallbackTitle, crux, points };
  // The snippet is optional, and dropped rather than refused when it is unusable: a summary with
  // no code is still a summary, and a stubbed or oversized one would teach the wrong thing.
  const code = typeof o.code === "string" ? o.code.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").trim() : "";
  const language = normalizeLanguage(o.language);
  if (code && language && code.split("\n").length <= MAX_CODE_LINES && !findStubLine(code)) {
    summary.code = code;
    summary.language = language;
  }
  return { summary };
}

export const LECTURE_SUMMARY_SYSTEM_PROMPT = `You write the ONE-SLIDE SUMMARY of a lecture the student has just finished. Output ONLY JSON:
{ "title": string, "crux": string, "points": [string], "code"?: string, "language"?: "cpp"|"c"|"java"|"python"|"javascript"|"typescript"|"csharp"|"go"|"sql"|"pseudocode" }

- Summarize ONLY what the lecture below taught — no new material, no outside facts, no advice.
- "title": 2-6 words, the subject of the lecture.
- "crux": 1-2 sentences, at most 40 words — the single idea the student must remember. Concrete, not "this lecture covered…".
- "points": 3-6 lines in the order the lecture taught them, each at most 16 words. Each is a fact or rule the student can use, not a heading.
- "code": ONLY if the lecture taught code — the one short snippet (at most 8 lines) that carries the idea, complete, no placeholders. Otherwise omit "code" and "language".`;
