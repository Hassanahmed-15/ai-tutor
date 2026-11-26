import type OpenAI from "openai";
import { costFor } from "../modelPricing";
import { canvasSentences } from "./plan";
import type { CanvasPlanBeat, CanvasStage } from "./types";

/**
 * WHICH BOARDS OF A TYPED LECTURE GET A PICTURE (owner, 2026-11-26: "there should be an agent deciding whether to
 * go with or without gpt images depending on the content of the board"). Word lists decided before — a board got a
 * picture only when its title held an organ, a cell, an apparatus… — so a history lecture had one picture in 15
 * boards and "trench warfare" could miss out. Now one small call reads every board and judges each: does a drawn
 * picture of something real teach this board better than its diagram? At most four, the most needed first; the
 * picture is drawn by gpt-image-2 from what the agent says it should show. Typed prompt lectures only.
 */

/** On unless CANVAS_PICTURE_AGENT=off (then the word lists choose, as before). */
export function pictureAgentOn(): boolean {
  return process.env.CANVAS_PICTURE_AGENT !== "off";
}

/** At most this many pictures in one typed lecture (owner, 2026-11-26: "up to 4"). */
export const MAX_TYPED_PICTURES = 4;
const MODEL = process.env.CANVAS_PICTURE_AGENT_MODEL ?? "gpt-5.6-luna";

/** Boards whose own drawing is the lesson: never swapped for a picture. */
const KEEP: ReadonlySet<string> = new Set(["code", "equation", "graph", "structure", "exam", "molecule", "atom-map"]);

const PROMPT = `You decide which boards of a lecture get a PICTURE drawn by an image model. Every other board keeps its
diagram (a flow, comparison, timeline, equation, graph or code), which the app draws itself.

A board gets a picture ONLY when seeing a real thing helps the student understand it: a scene or event (a battle,
a street, a factory), a structure or object (an organ, a cell, a machine, a building, a landform), an experiment or
apparatus, a place or what something looks like. An idea also gets one when a real scene SHOWS it, and that scene
is what the board is about: industrialisation → a crowded, smoky factory floor; inflation → a long queue outside a
bakery with prices chalked up; an arms build-up → rows of warships in a harbour. The picture has no words: it must
be something an illustrator can draw.

NO picture for: equations, calculations, code, algorithms, graphs and data, comparisons, timelines, definitions,
pure summaries, or a board whose point is a chain of steps or causes (that is what its diagram is for).

The picture takes the place of the board's diagram, so weigh the two: choose the picture when SEEING the thing or the
scene teaches the board more than its boxes and arrows would — a student who has never seen it cannot imagine it.

Rank the boards that need a picture, most needed first, and choose at most ${MAX_TYPED_PICTURES}. Fewer is fine; none is
fine when nothing needs one.

Reply as JSON: {"boards":[{"id": "...", "picture": true|false, "why": "a few words", "show": "for a picture: one
sentence of what it shows, concrete and drawable, no text in it", "parts": ["for a picture: up to 5 things in it
to label, named as the board names them"]}], "ranking": ["ids of the picture boards, most needed first"]}`;

export type PictureDecision = { id: string; picture: boolean; why: string; show?: string; parts?: string[] };

/** One JSON reply (as lib/canvas/generate.ts jsonCall, which is server-only and so cannot be tested here). */
async function jsonCall(openai: OpenAI, model: string, system: string, user: string, maxTokens: number): Promise<{ json: unknown; costUsd: number }> {
  const res = await openai.chat.completions.create({
    model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    response_format: { type: "json_object" },
    max_completion_tokens: maxTokens,
    reasoning_effort: "low",
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  const costUsd = costFor(model, res.usage);
  return { json: JSON.parse(res.choices[0]?.message?.content ?? "{}"), costUsd };
}

/** What one board looks like to the agent. */
function describe(beat: CanvasPlanBeat, planned: CanvasStage | undefined): string {
  const said = canvasSentences(beat.script ?? "").slice(0, 3).join(" ").slice(0, 400);
  return [
    `id: ${beat.id}`,
    `title: ${beat.title}`,
    `planned drawing: ${planned ?? beat.stage}`,
    beat.brief ? `brief: ${beat.brief.slice(0, 300)}` : "",
    beat.objects?.length ? `things on it: ${beat.objects.slice(0, 8).join(", ")}` : "",
    said ? `Aria says: ${said}` : "",
  ].filter(Boolean).join("\n");
}

/**
 * The agent's choice applied to a typed lecture's plan. `planned`: each board's stage before the visual rules ran,
 * so a board the old word lists turned into a picture goes back to its own diagram when the agent says no.
 * On any failure the plan is returned as it was (the word lists' choice stands).
 */
export async function choosePictures(
  openai: OpenAI,
  topic: string,
  beats: CanvasPlanBeat[],
  planned: Map<string, CanvasStage>,
): Promise<{ beats: CanvasPlanBeat[]; costUsd: number; log: string; /** Every board's verdict and why (for the log and the QA). */ decisions?: PictureDecision[] }> {
  const candidates = beats.filter((b) => !KEEP.has(b.stage) && !b.mathsPicture && !b.pictureBeside);
  if (!candidates.length) return { beats, costUsd: 0, log: "no board could take a picture" };
  let costUsd = 0;
  let decisions: PictureDecision[];
  let ranking: string[];
  try {
    const user = `LECTURE: ${topic}\n\nBOARDS:\n${candidates.map((b) => describe(b, planned.get(b.id))).join("\n\n")}`;
    const reply = await jsonCall(openai, MODEL, PROMPT, user, 3000);
    costUsd = reply.costUsd;
    const json = reply.json as { boards?: unknown[]; ranking?: unknown[] };
    decisions = (Array.isArray(json?.boards) ? json.boards : []).flatMap((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      if (typeof r.id !== "string") return [];
      const parts = Array.isArray(r.parts) ? r.parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0).slice(0, 5) : [];
      return [{ id: r.id, picture: r.picture === true, why: typeof r.why === "string" ? r.why.slice(0, 120) : "", ...(typeof r.show === "string" && r.show.trim() ? { show: r.show.trim().slice(0, 300) } : {}), ...(parts.length ? { parts } : {}) }];
    });
    ranking = (Array.isArray(json?.ranking) ? json.ranking : []).filter((id): id is string => typeof id === "string");
  } catch (error) {
    return { beats, costUsd, log: `agent failed (${(error as Error).message.slice(0, 80)}) — the word lists' choice stands` };
  }
  // Nothing said about any board: no board needs a picture (a lecture of code or equations).
  if (!decisions.length) return { beats, costUsd, log: "no board needs a picture" };

  const byId = new Map(decisions.map((d) => [d.id, d]));
  const wanted = decisions.filter((d) => d.picture && candidates.some((b) => b.id === d.id));
  // Most needed first, as ranked; then any it said yes to but left out of the ranking.
  const order = [...new Set([...ranking.filter((id) => wanted.some((d) => d.id === id)), ...wanted.map((d) => d.id)])].slice(0, MAX_TYPED_PICTURES);
  const chosen = new Set(order);
  const notes: string[] = [];
  const out = beats.map((beat) => {
    const d = byId.get(beat.id);
    if (chosen.has(beat.id) && d) {
      notes.push(`#${beat.id} picture (${d.why})`);
      const show = d.show ? ` Picture: ${d.show}` : "";
      return {
        ...beat,
        stage: "illustration" as CanvasStage,
        figure: undefined,
        figureAsset: undefined,
        plannedFigure: undefined,
        visualType: "thing" as const,
        brief: `${beat.brief ?? ""}${show}`.trim(),
        ...(d.parts?.length ? { objects: [...new Set([...d.parts, ...(beat.objects ?? [])])].slice(0, 8) } : {}),
      };
    }
    if (beat.stage === "illustration" && d && !d.picture) {
      // The word lists made it a picture; the agent says its diagram teaches it better.
      const back = planned.get(beat.id);
      const stage: CanvasStage = back && back !== "illustration" ? back : "flow";
      notes.push(`#${beat.id} no picture → ${stage} (${d.why})`);
      return { ...beat, stage };
    }
    return beat;
  });
  // The rest stay as they are: a picture the word lists chose, that the agent did not judge, is kept only while
  // there is room for it.
  let pictures = out.filter((b) => b.stage === "illustration").length;
  for (const beat of out) {
    if (pictures <= MAX_TYPED_PICTURES) break;
    if (beat.stage === "illustration" && !chosen.has(beat.id)) {
      const back = planned.get(beat.id);
      beat.stage = back && back !== "illustration" ? back : "flow";
      pictures--;
      notes.push(`#${beat.id} no picture → ${beat.stage} (over ${MAX_TYPED_PICTURES})`);
    }
  }
  return { beats: out, costUsd, log: `${chosen.size} picture(s): ${notes.join(" | ") || "none needed"}`, decisions };
}
