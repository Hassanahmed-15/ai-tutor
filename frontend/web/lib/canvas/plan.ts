import { trimToFit } from "../text/fit";
import { CANVAS_STAGES, type CanvasPlanBeat, type CanvasStage } from "./types";
import { slug } from "./validate";
import { figureComponent } from "../figures/registry";
import { withoutSourceTags } from "../webSources";
import { withoutOldTransferPrompt } from "./oldTransferPrompt";

/**
 * A canvas lecture's PLAN, as the model wrote it, made safe — pure, so it is unit-tested
 * (lib/anim/lessonCanvas.test.ts). The plan writes each board's script; lib/canvas/generate.ts and
 * lib/canvas/progressive.ts then write each board's picture.
 */

/** Mirrors splitNarrationSentences in lib/voice.ts, which numbers the sentences the player speaks. */
export function canvasSentences(script: string): string[] {
  return script.split(/(?<=[.!?۔؟])\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * NO PREDICTION, NO QUIZ (owner's direction, 2026-10-16: remove "Predict it" from every lecture —
 * typed, PDF and video). A board keeps only a task the plan asked for because doing it IS the skill:
 * a "try" slider. Anything else — a "quiz", a "draw" (owner, 2026-10-17: drawing tasks removed), or
 * nothing — is no interaction and no
 * predict/reveal cycle, so the lecture never stops for an answer.
 */
export function teachingCycle(_script: string, interaction: CanvasPlanBeat["interaction"], _overview: boolean): { interaction: CanvasPlanBeat["interaction"]; cycle?: CanvasPlanBeat["teachingCycle"] } {
  void _script;
  void _overview;
  return { interaction: interaction === "try" ? interaction : null, cycle: undefined };
}

export function validatePlan(raw: unknown): { title: string; beats: CanvasPlanBeat[] } | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(r.beats) ? r.beats : [];
  const beats: CanvasPlanBeat[] = [];
  // A safety cap on a runaway answer, well above any lesson the planner sizes (it allows 14 parts;
  // a strict lecture on a whole document, up to 24 boards — lib/canvas/sourceLessons.ts).
  list.slice(0, 24).forEach((item, i) => {
    const b = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    // Spoken aloud: a "Sources: [S1]" line the model added from the research material goes.
    let script = typeof b.script === "string" ? withoutSourceTags(b.script.replace(/\s+/g, " ").trim()) : "";
    // Headings shrink to fit their board (lib/canvas/layout.ts), so a long title is kept whole; a
    // runaway one is ended at a word, never mid-word ("…the perpendicular bisec").
    const title = typeof b.title === "string" ? trimToFit(b.title, 90) : "";
    const planned = (CANVAS_STAGES as readonly string[]).includes(String(b.stage)) ? (b.stage as CanvasStage) : "scene";
    // "diagram": "picture" is the planner asking for a generated textbook picture of a real thing; the
    // lesson visual policy still checks it (not abstract, not maths, within the picture budget).
    // A "figure" board asking for a picture names no figure to draw: it is a picture request too (a
    // bacterial-cell board planned that way was left with no figure at all; live test, 2026-10-17).
    // An exact code figure that fits still replaces it in the visual policy.
    const stage: CanvasStage = typeof b.diagram === "string" && /^\s*picture\s*$/i.test(b.diagram) && ["scene", "illustration", "compare", "flow", "figure"].includes(planned) ? "illustration" : planned;
    if (!script || !title || canvasSentences(script).length < 2) return;
    const id = `b${beats.length + 1}`;
    const objects = (Array.isArray(b.objects) ? b.objects : []).map((o) => slug(o, "")).filter(Boolean).slice(0, 4);
    const inside = b.inside && typeof b.inside === "object" ? (b.inside as Record<string, unknown>) : null;
    const earlier = inside ? beats.find((p) => p.id === String(inside.beat)) : undefined;
    const insideObject = inside ? slug(inside.object, "") : "";
    const overview = b.overview === true;
    script = withoutOldTransferPrompt(script);
    // An exam-practice board models the answer: no interaction of its own.
    const cycle = stage === "exam" ? { interaction: null } : teachingCycle(script, b.interaction === "try" || b.interaction === "draw" || b.interaction === "quiz" ? b.interaction : null, overview);
    beats.push({
      id,
      title,
      script,
      stage,
      brief: typeof b.brief === "string" ? b.brief.slice(0, 300) : "",
      objects,
      inside: earlier && earlier.objects.includes(insideObject) ? { beat: earlier.id, object: insideObject } : null,
      carry: (Array.isArray(b.carry) ? b.carry : []).map((c) => slug(c, "")).filter((c) => objects.includes(c) && (beats[beats.length - 1]?.objects ?? []).includes(c)).slice(0, 2),
      interaction: cycle.interaction,
      ...(cycle.cycle ? { teachingCycle: cycle.cycle } : {}),
      overview,
      // A refresher opens the lesson: only on the first two boards, and only one (below).
      ...(b.refresher === true && beats.length < 2 ? { refresher: true } : {}),
      ...planSource(b.source),
      // The planner's diagram, only when it names a real catalogue entry.
      ...(typeof b.diagram === "string" && figureComponent(b.diagram.trim()) ? { plannedFigure: b.diagram.trim() } : {}),
      ...(typeof b.visual === "string" && ["thing", "diagram", "quantity", "math", "sequence", "comparison", "concept"].includes(b.visual.trim().toLowerCase()) ? { visualType: b.visual.trim().toLowerCase() as CanvasPlanBeat["visualType"] } : {}),
      ...boardNotesOf(b.board, canvasSentences(script).length),
      ...(Array.isArray(b.sentenceBlocks) ? { sentenceBlocks: b.sentenceBlocks.map((v) => (typeof v === "string" ? v.replace(/[{}\s]/g, "") : "")).slice(0, 40) } : {}),
    });
    void i;
  });
  // One board is a complete lesson when one board answers the request: there is no floor.
  if (beats.length < 1) return null;
  // The camera's pull-back over the whole lesson is for a final board that genuinely brings a longer
  // lesson together — never forced onto whatever board happens to be last.
  beats.forEach((beat, i) => (beat.overview = beat.overview && i === beats.length - 1 && beats.length >= 4));
  let refreshers = 0;
  for (const beat of beats) if (beat.refresher && (refreshers++ > 0 || beat.overview)) delete beat.refresher;
  return { title: typeof r.title === "string" && r.title.trim() ? r.title.trim().slice(0, 80) : beats[0].title, beats };
}

/**
 * A refresher board only when the student's knowledge offered one (lib/canvas/lessonRequest.ts
 * canvasRefresherAllowed, after lib/knowledge/planning.ts kept only what relates to this lecture).
 * The planner may not invent its own: an unoffered refresher is taught as an ordinary board.
 */
export function withRefresherOnlyIfOffered<P extends { beats: CanvasPlanBeat[] }>(plan: P, offered: boolean): P {
  if (offered || !plan.beats.some((b) => b.refresher)) return plan;
  return {
    ...plan,
    beats: plan.beats.map((beat) => {
      const plain = { ...beat };
      delete plain.refresher;
      return plain;
    }),
  };
}

/** A document lesson's "source" on a board: real page numbers, a listing number, a line range. */
function planSource(raw: unknown): { source?: CanvasPlanBeat["source"] } {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  // Models write numbers as numbers, as "6", as "LISTING 6", and ranges as [7, 29] or "7-29".
  const whole = (v: unknown) => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.match(/\d+/)?.[0] ?? NaN) : NaN;
    return Number.isInteger(n) && n >= 1 && n <= 2000 ? n : 0;
  };
  const pageList = Array.isArray(r.pages) ? r.pages : r.pages !== undefined && r.pages !== null ? [r.pages] : [];
  const pages = [...new Set(pageList.map(whole).filter(Boolean))].slice(0, 12);
  const listing = whole(r.listing);
  const range = Array.isArray(r.lines) ? r.lines.map(whole) : typeof r.lines === "string" ? (r.lines.match(/\d+/g) ?? []).slice(0, 2).map(whole) : [];
  const lines: [number, number] | undefined = listing && range.length === 2 && range[0] && range[1] >= range[0] ? [range[0], range[1]] : undefined;
  const blocks = blockIds(r.blocks).slice(0, 24);
  if (!pages.length && !listing && !blocks.length) return {};
  return { source: { pages, ...(listing ? { listing } : {}), ...(lines ? { lines } : {}), ...(blocks.length ? { blocks } : {}) } };
}

/** Source block ids as the model wrote them ("p14-b8", "{p14-b8}"); checked against the document later. */
function blockIds(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : [];
  return list.map((v) => (typeof v === "string" ? v.replace(/[{}\s]/g, "") : "")).filter((v) => /^[\w.-]{1,80}$/.test(v));
}

/** The planner's "board" phrases: one per sentence at most, within the sentences, at most 60 characters as written. */
export function boardNotesOf(raw: unknown, sentenceCount: number): { boardNotes?: Array<{ s: number; text: string }> } {
  if (!Array.isArray(raw)) return {};
  const seen = new Set<number>();
  const notes = raw
    .map((n) => (n && typeof n === "object" ? (n as Record<string, unknown>) : {}))
    .map((n) => ({ s: Math.round(Number(n.s)), text: typeof n.text === "string" ? n.text.replace(/\s+/g, " ").trim().replace(/[.…]+$/, "") : "" }))
    .filter((n) => Number.isInteger(n.s) && n.s >= 0 && n.s < sentenceCount && n.text && n.text.length <= 60 && !seen.has(n.s) && seen.add(n.s))
    .sort((a, b) => a.s - b.s);
  return notes.length ? { boardNotes: notes } : {};
}
