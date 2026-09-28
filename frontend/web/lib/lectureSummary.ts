import { findStubLine, normalizeLanguage, type CodeLanguage } from "./codeSpec";
import { sentenceIsGrounded, sourceVocabulary, ungroundedTerms } from "./sourceGrounding";

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

/**
 * STRICT SOURCE: the summary is held to the document, not to the scripts.
 *
 * "Summarize ONLY what the lecture taught" certifies whatever a script leaked — a script that added
 * an outside example produced a summary point about that example, stamped as the lecture's crux. In
 * strict mode the summarizer is handed the document's own text (the blocks the beats taught) and
 * told that is the boundary, and this rule is appended last so it wins.
 */
export const LECTURE_SUMMARY_STRICT_RULES = `STRICTLY FROM THE SOURCE — this overrides the rules above.
The student chose to learn ONLY from their own document. SOURCE below is the boundary: the crux and every point must be something SOURCE states, in SOURCE's own words wherever you can.
- A lecture sentence that SOURCE does not support is left out of the summary, even if the lecture said it.
- No outside facts, examples, analogies, numbers or advice. A shorter summary is correct.
- "code": only a snippet that appears in SOURCE; otherwise omit it.`;

/**
 * Hold a parsed summary to the source, deterministically.
 *
 * Points that bring in two or more words the source never uses are dropped (the tolerance
 * lib/sourceGrounding uses everywhere: one stray word is paraphrase, two is new material). An
 * ungrounded title falls back to the lecture's own; a snippet whose words are not the source's is
 * dropped. Only a crux that is not the source's, or fewer than two faithful points, is an `issue` —
 * the route asks once more with it — and even then `summary` is the best grounded version (the first
 * surviving point promoted to crux), so a second miss degrades to a smaller, faithful slide rather
 * than to an error.
 */
export function groundLectureSummary(
  summary: LectureSummary,
  source: string,
  fallbackTitle = "Lecture summary",
): { summary: LectureSummary | null; issue?: string } {
  const vocab = sourceVocabulary(source);
  const unsupported = (text: string) => ungroundedTerms(text, vocab);
  const ok = (text: string) => sentenceIsGrounded(text, vocab);
  const points = summary.points.filter((point) => ok(point));
  const title = ok(summary.title) ? summary.title : fallbackTitle;
  const code = summary.code && ok(summary.code) ? summary.code : undefined;
  const cruxMissing = ok(summary.crux) ? [] : unsupported(summary.crux);
  const base: LectureSummary = { title, crux: summary.crux, points, ...(code ? { code, language: summary.language } : {}) };

  if (!ok(summary.crux)) {
    const issue = `the crux uses words SOURCE never does (${cruxMissing.slice(0, 6).join(", ")}) — restate it in SOURCE's own words`;
    // Promote the first faithful point so a second miss still yields a grounded slide.
    if (points.length >= 3) return { summary: { ...base, crux: points[0], points: points.slice(1) }, issue };
    return { summary: null, issue };
  }
  if (points.length < 2) {
    return { summary: null, issue: "most points state things SOURCE does not — use only statements SOURCE makes" };
  }
  // Dropped points alone do not cost the student a second call: what is left is faithful and enough.
  return { summary: base };
}
