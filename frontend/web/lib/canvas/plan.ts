import { CANVAS_STAGES, type CanvasPlanBeat, type CanvasStage } from "./types";
import { slug } from "./validate";
import { predictionIndex } from "./predict";

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
 * Phase 4 is deliberately local: it adds no model call. The cycle is anchored on the script's own
 * prediction sentence (lib/canvas/predict.ts): the quiz asks it, the next sentence reveals it, the
 * last sentence transfers. A script with no prediction gets no cycle (its quiz is an end check). An
 * explicitly requested try/draw interaction is preserved: manipulating or drawing is the skill.
 */
export function teachingCycle(script: string, interaction: CanvasPlanBeat["interaction"], overview: boolean): { interaction: CanvasPlanBeat["interaction"]; cycle?: CanvasPlanBeat["teachingCycle"] } {
  const sentences = canvasSentences(script);
  const count = sentences.length;
  if (overview || count < 2) return { interaction, cycle: undefined };
  const predict = predictionIndex(sentences);
  if (predict < 0 || predict >= count - 1) return { interaction: interaction ?? "quiz", cycle: undefined };
  return {
    interaction: interaction ?? "quiz",
    cycle: { teach: 0, predict, reveal: predict + 1, transfer: count - 1 },
  };
}

/**
 * A model occasionally ends a sound teaching cycle by restating its answer. Repair that local
 * omission deterministically instead of making a student wait through a second full plan call or
 * receiving a build error. The extra sentence is a new situation, never a recap of the reveal.
 */
export function addTransferPrompt(script: string, title: string, interaction: CanvasPlanBeat["interaction"], overview: boolean): string {
  if (overview || interaction === "try" || interaction === "draw") return script;
  // The planner sometimes writes “Predict what happens.” as a statement. It is still an explicit
  // prediction, but the player must pause on a question; make that punctuation unambiguous.
  const normalized = script.replace(/(\bpredict\b[^.!?]*)([.!])(?=\s|$)/i, "$1?");
  const sentences = canvasSentences(normalized);
  const predict = predictionIndex(sentences);
  if (predict < 0 || predict >= sentences.length - 1) return normalized;
  const last = sentences.at(-1) ?? "";
  const concrete = /\b(apply|use|new|another|different|case|example|situation|scenario|suppose|imagine|given|calculate|if|when|now try|exam|state|find|show|illustrate|sketch|work out|determine|write|solve|explain)\b/i;
  if (concrete.test(last)) return normalized;
  // Cue words are English: a lesson in Urdu or Arabic keeps its own ending rather than an English sentence.
  if (!/[A-Za-z]{3}/.test(last)) return normalized;
  // ("Now apply the same reasoning to a new the two square roots example" read badly; audit 2026-10-17.)
  void title;
  return `${normalized.replace(/\s+$/, "")} Now try the same reasoning on a new example of your own, and explain what changes.`;
}

export function validatePlan(raw: unknown): { title: string; beats: CanvasPlanBeat[] } | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(r.beats) ? r.beats : [];
  const beats: CanvasPlanBeat[] = [];
  // A safety cap on a runaway answer, well above any lesson the planner sizes (it allows 14 parts;
  // a strict lecture on a whole document, up to 24 boards — lib/canvas/sourceLessons.ts).
  list.slice(0, 24).forEach((item, i) => {
    const b = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    let script = typeof b.script === "string" ? b.script.replace(/\s+/g, " ").trim() : "";
    const title = typeof b.title === "string" ? b.title.trim().slice(0, 60) : "";
    const stage = (CANVAS_STAGES as readonly string[]).includes(String(b.stage)) ? (b.stage as CanvasStage) : "scene";
    if (!script || !title || canvasSentences(script).length < 2) return;
    const id = `b${beats.length + 1}`;
    const objects = (Array.isArray(b.objects) ? b.objects : []).map((o) => slug(o, "")).filter(Boolean).slice(0, 4);
    const inside = b.inside && typeof b.inside === "object" ? (b.inside as Record<string, unknown>) : null;
    const earlier = inside ? beats.find((p) => p.id === String(inside.beat)) : undefined;
    const insideObject = inside ? slug(inside.object, "") : "";
    const overview = b.overview === true;
    script = addTransferPrompt(script, title, b.interaction === "try" || b.interaction === "draw" || b.interaction === "quiz" ? b.interaction : null, overview);
    const cycle = teachingCycle(script, b.interaction === "try" || b.interaction === "draw" || b.interaction === "quiz" ? b.interaction : null, overview);
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
      ...(Array.isArray(b.sentenceBlocks) ? { sentenceBlocks: b.sentenceBlocks.map((v) => (typeof v === "string" ? v.replace(/[{}\s]/g, "") : "")).slice(0, 40) } : {}),
    });
    void i;
  });
  // One board is a complete lesson when one board answers the request: there is no floor.
  if (beats.length < 1) return null;
  // Repeated prediction checks are intentional: each board completes its own
  // teach → predict → reveal → transfer cycle. Keep the interaction the planner selected.
  // The camera's pull-back over the whole lesson is for a final board that genuinely brings a longer
  // lesson together — never forced onto whatever board happens to be last.
  beats.forEach((beat, i) => (beat.overview = beat.overview && i === beats.length - 1 && beats.length >= 4));
  let refreshers = 0;
  for (const beat of beats) if (beat.refresher && (refreshers++ > 0 || beat.overview)) delete beat.refresher;
  return { title: typeof r.title === "string" && r.title.trim() ? r.title.trim().slice(0, 80) : beats[0].title, beats };
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
