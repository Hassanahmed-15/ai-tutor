import type { CanvasPlanBeat, CanvasStage } from "./types";
import { boardNotesOf, canvasSentences } from "./plan";
import { slug } from "./validate";

/**
 * CARD DIVES (owner, 2026-10-19): "if you pull out 4 or 5 text cards and explain them one by one,
 * zoom in completely and explain that card on a different board". A board of cards becomes a short
 * TOUR (one sentence per card, so each card still appears as it is named), followed by one CLOSE-UP
 * board per card, planned "inside" that card. The player already places an inside board within its
 * element and the camera flies into it (lib/canvas/layout.ts placePanels), so the student watches
 * Aria dive into card 1, come out, dive into card 2… and always knows which card is being explained.
 *
 * Off unless CANVAS_CARD_DIVES=1 on the server. Not for strict PDF or video lessons: a close-up adds
 * explanation the source may not give.
 */

/** Stages a close-up may use: drawn by code, no generated picture (a dive never waits on one). */
const DIVE_STAGES = ["flow", "scene", "compare", "graph", "equation"] as const;
const VISUAL_OF: Record<(typeof DIVE_STAGES)[number], NonNullable<CanvasPlanBeat["visualType"]>> = {
  flow: "sequence",
  scene: "concept",
  compare: "comparison",
  graph: "quantity",
  equation: "math",
};

/** A board of cards worth diving into: flow or scene, two to four named things, not a recap or exam. */
export function diveCandidate(beat: CanvasPlanBeat): boolean {
  return (beat.stage === "flow" || beat.stage === "scene") && beat.objects.length >= 2 && !beat.overview && !beat.refresher && !beat.inside;
}

export const DIVE_PROMPT = `You turn ONE board of a narrated school lesson, whose cards each name one thing, into a short tour of the cards plus one close-up board per card. Return JSON only:
{"tour": string, "tourBoard": [{"s": number, "text": string}], "dives": [{"object": string, "title": string, "script": string, "stage": "flow" | "scene" | "compare" | "graph" | "equation", "brief": string, "objects": [string], "board": [{"s": number, "text": string}]}]}
- "tour": what Aria now says over the board of cards: one sentence giving the board's idea, then ONE sentence per card in the given order that names the card's object word for word and says in a few words what it is. Nothing else: each card is explained on its own close-up.
- "dives": exactly one per object, in the given order, "object" copied exactly. Each close-up explains that one card: what it is, how or why it works, and one concrete example, value or consequence. 4 to 6 spoken sentences ending in . ! or ?, one idea each, at most about 25 words; the first names the card. Build on what the current narration says about it; add only standard textbook facts at the student's level. Never repeat what another close-up explains.
- "title": the card's own name, at most 6 words.
- "stage": what the close-up draws: "flow" for steps, causes or a pathway; "scene" for parts or things with labelled boxes; "compare" for two sides; "graph" for a quantity that changes; "equation" for a formula.
- "brief": one sentence: exactly what the close-up shows — 3 to 5 labelled things (parts, steps or examples) and how they link, never one lone box.
- "objects": 1 to 3 key things drawn on the close-up, lowercase, one or two words.
- "board" and "tourBoard": for at least 7 in 10 sentences, the short phrase written on the board as that sentence is said (s = 0-based sentence number, at most 34 characters).
- Never say "card", "close-up" or "zoom": speak about the ideas.`;

type Dive = { object: string; title: string; script: string; stage: CanvasStage; brief: string; objects: string[]; board: unknown };

/** The model's answer for one board, checked: a tour that names every card, and one close-up per card. */
export function parseDives(beat: CanvasPlanBeat, json: unknown): { tour: string; tourBoard: unknown; dives: Dive[] } | null {
  const r = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const tour = typeof r.tour === "string" ? r.tour.replace(/\s+/g, " ").trim() : "";
  if (canvasSentences(tour).length < 2) return null;
  const raw = Array.isArray(r.dives) ? (r.dives as Array<Record<string, unknown>>) : [];
  const dives: Dive[] = [];
  for (const [i, object] of beat.objects.entries()) {
    const d = raw.find((x) => slug(x?.object, "") === object) ?? raw[i];
    if (!d) return null;
    const script = typeof d.script === "string" ? d.script.replace(/\s+/g, " ").trim() : "";
    // A title echoed as the object's id ("carbon-dioxide") is written as words ("Carbon dioxide").
    const said = typeof d.title === "string" ? d.title.trim().slice(0, 60) : "";
    const title = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(said) ? `${said.charAt(0).toUpperCase()}${said.slice(1).replace(/-/g, " ")}` : said;
    if (!title || canvasSentences(script).length < 3) return null;
    const stage = (DIVE_STAGES as readonly string[]).includes(String(d.stage)) ? (d.stage as CanvasStage) : "scene";
    const objects = (Array.isArray(d.objects) ? d.objects : []).map((o) => slug(o, "")).filter(Boolean).slice(0, 3);
    dives.push({ object, title, script, stage, brief: typeof d.brief === "string" ? d.brief.slice(0, 300) : title, objects, board: d.board });
  }
  // The tour must still name each card, so each one appears as Aria reaches it.
  const said = tour.toLowerCase();
  if (beat.objects.some((o) => !said.includes(o.replace(/-/g, " ")) && !said.includes(o))) return null;
  return { tour, tourBoard: r.tourBoard, dives };
}

/** The plan with each dived board's tour and its close-ups after it, numbered b1, b2, … again. */
export function withDives(beats: CanvasPlanBeat[], answers: Map<string, { tour: string; tourBoard: unknown; dives: Dive[] }>): CanvasPlanBeat[] {
  const out: CanvasPlanBeat[] = [];
  for (const beat of beats) {
    const a = answers.get(beat.id);
    if (!a) {
      out.push(beat);
      continue;
    }
    // The tour is new narration: the old sentence plan and board phrases no longer fit it.
    const tour: CanvasPlanBeat = { ...beat, script: a.tour };
    delete tour.teachingCycle;
    delete tour.boardNotes;
    out.push({ ...tour, ...boardNotesOf(a.tourBoard, canvasSentences(a.tour).length) });
    for (const d of a.dives) {
      out.push({
        id: `${beat.id}-${d.object}`,
        title: d.title,
        script: d.script,
        stage: d.stage,
        brief: d.brief,
        objects: d.objects,
        inside: { beat: beat.id, object: d.object },
        carry: [],
        interaction: null,
        overview: false,
        dive: true,
        visualType: VISUAL_OF[d.stage as (typeof DIVE_STAGES)[number]] ?? "concept",
        ...(beat.audience ? { audience: beat.audience } : {}),
        ...boardNotesOf(d.board, canvasSentences(d.script).length),
      });
    }
  }
  // Ids are b1, b2, … in order (the player and the logs expect it); an inside board follows its parent's new id.
  const ids = new Map<string, string>();
  out.forEach((b, i) => ids.set(b.id, `b${i + 1}`));
  return out.map((b) => ({ ...b, id: ids.get(b.id)!, ...(b.inside ? { inside: { ...b.inside, beat: ids.get(b.inside.beat) ?? b.inside.beat } } : {}) }));
}
