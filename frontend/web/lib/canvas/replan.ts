import type OpenAI from "openai";
import { costFor } from "../modelPricing";
import type { ProgressiveBeatPlan } from "../progressiveLectureTypes";
import { canvasBoardDurationMs } from "./lessonRequest";
import { CANVAS_STAGES, type CanvasPlanBeat, type CanvasStage } from "./types";

/**
 * THE REST OF THE LECTURE CHANGES WITH THE STUDENT (owner, 2026-11-26: "dynamic flow on the basis of user
 * interaction as well as user answers to mid-lecture questions"). Before, an answer or a question only added a
 * note: what Aria says on every board was fixed when the lesson was planned.
 *
 * After each interaction (a "Check it" answer, a question, "simpler", "deeper", "more examples") one small call
 * reads what the student has shown and the boards NOT YET WRITTEN, and may: rewrite one (a simpler or a deeper
 * pass, another example), insert one (a worked example or the missing foundation where they are weak, the thing
 * they asked about), or skip one that only repeats what they have clearly mastered. Boards already written, being
 * written, or next in line are never touched (`editableFrom`). Bounded: two edits a call, two inserted boards and
 * two skipped boards a lecture, never the last board. Mastery tracking follows knowledge tracing (Corbett &
 * Anderson); re-teaching from another angle follows the tutoring literature (VanLehn 2011).
 */

export const MAX_INSERTS_PER_LECTURE = 2;
export const MAX_SKIPS_PER_LECTURE = 2;
const MAX_EDITS_PER_CALL = 2;
const MODEL = process.env.CANVAS_REPLAN_MODEL ?? "gpt-5.6-luna";

export type ReplanEdit =
  | { op: "rewrite"; id: string; title?: string; brief?: string; script: string }
  | { op: "insert"; after: string; title: string; brief: string; script: string; stage?: string }
  | { op: "skip"; id: string };

export type ReplanResult = { plan: ProgressiveBeatPlan[]; applied: string[]; inserted: number; skipped: number };

const PROMPT = `You adapt the REST of a live lecture to one student, from what they have just shown. You see the
boards already taught (titles), what the student just did, and the boards still to come that can still change.

Change only what the evidence supports; often the right answer is no change. A question or remark that is not about
the lecture's subject (the weather, a match, the student's day, chit-chat) is NOT evidence: change nothing, reply
{"why": "not about the lecture", "edits": []}. You may make at most ${MAX_EDITS_PER_CALL} edits:
- "rewrite" a coming board: the same idea, pitched to them — simpler and smaller steps after a wrong answer or
  "simpler"; deeper after "deeper" or easy correct answers; another concrete example after "more examples".
- "insert" a new board after a coming board (or after the board being played): a worked example or the missing
  foundation where they are clearly weak, or the thing their question asked about when the lesson does not cover it.
- "skip" a coming board only when it only repeats what they have clearly mastered. Never skip the last board.

A STRONG STUDENT is not slowed down: after two or more correct answers in a row (see EARLIER), a coming board that
only practises or re-states what they have shown they know (another example of the same step, an easier version,
a mid-lesson recap) is SKIPPED, or rewritten to go one step further. One correct answer alone is not enough.

A board's "script" is what Aria says: 4-8 spoken sentences in the same voice as the lecture, no headings, no
lists, no "as I said", nothing the board cannot show. Keep the lecture's own terms and running example.

Reply as JSON: {"why": "one sentence", "edits": [{"op":"rewrite","id":"…","title":"…","brief":"what the board
shows","script":"…"} | {"op":"insert","after":"…","title":"…","brief":"…","script":"…","stage":"flow|compare|scene|
illustration|equation|graph|code|…"} | {"op":"skip","id":"…"}]}`;

export type ReplanContext = {
  topic: string;
  /** What the student just did, in words ("answered … wrongly: chose …"; "asked: …"; "asked for simpler"). */
  happened: string;
  /** Earlier notes on this student (the session's adaptation notes). */
  notes: string[];
  plan: ProgressiveBeatPlan[];
  /** The first plan position that may change (nothing written, being written or next in line before it). */
  editableFrom: number;
};

/** What the replanner is shown. Pure. */
export function replanRequest(ctx: ReplanContext): string {
  const taught = ctx.plan.slice(0, ctx.editableFrom).map((p) => `- ${p.title}`).join("\n");
  const coming = ctx.plan.slice(ctx.editableFrom).map((p, i) => {
    const c = p.canvas;
    const last = ctx.editableFrom + i === ctx.plan.length - 1 ? " (LAST board: never skip)" : "";
    return `id: ${c?.id ?? p.id}${last}\ntitle: ${p.title}\nbrief: ${(c?.brief ?? p.objective).slice(0, 220)}\nscript: ${(c?.script ?? "").slice(0, 600)}`;
  }).join("\n\n");
  return [
    `LECTURE: ${ctx.topic}`,
    `JUST NOW: ${ctx.happened}`,
    ctx.notes.length ? `EARLIER ABOUT THIS STUDENT:\n${ctx.notes.slice(-5).map((n) => `- ${n}`).join("\n")}` : "",
    `ALREADY TAUGHT OR IN LINE (do not change):\n${taught || "(none)"}`,
    `STILL TO COME (may change; "after" may also be the id of the last board above):\n${coming}`,
  ].filter(Boolean).join("\n\n");
}

/** The replanner's edits, read safely. Pure. */
export function readEdits(json: unknown): ReplanEdit[] {
  const list = Array.isArray((json as { edits?: unknown })?.edits) ? (json as { edits: unknown[] }).edits : [];
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  return list.slice(0, MAX_EDITS_PER_CALL).flatMap((raw): ReplanEdit[] => {
    const r = (raw ?? {}) as Record<string, unknown>;
    if (r.op === "skip" && str(r.id, 60)) return [{ op: "skip", id: str(r.id, 60) }];
    const script = str(r.script, 2400);
    if (script.split(/(?<=[.!?])\s+/).length < 3) return [];
    if (r.op === "rewrite" && str(r.id, 60)) return [{ op: "rewrite", id: str(r.id, 60), title: str(r.title, 120) || undefined, brief: str(r.brief, 400) || undefined, script }];
    if (r.op === "insert" && str(r.after, 60) && str(r.title, 120)) return [{ op: "insert", after: str(r.after, 60), title: str(r.title, 120), brief: str(r.brief, 400), script, stage: str(r.stage, 30) || undefined }];
    return [];
  });
}

/** A new board for the plan, its visuals left to the board writer. */
function newBoard(id: string, edit: Extract<ReplanEdit, { op: "insert" }>): CanvasPlanBeat {
  const stage = (CANVAS_STAGES as readonly string[]).includes(edit.stage ?? "") ? (edit.stage as CanvasStage) : "flow";
  return {
    id, title: edit.title, script: edit.script, stage, brief: edit.brief || edit.title, objects: [],
    inside: null, carry: [], interaction: null, overview: false,
    // Its words are checked and pitched when it is written, like a course board's.
    polishLater: { factCheck: true },
  } as CanvasPlanBeat;
}

/**
 * The edits applied to the plan. Pure (tested). Only positions >= editableFrom change; ids that are not coming
 * boards are ignored; the lecture's insert/skip budgets (`used`) hold; positions are numbered again.
 */
export function applyReplan(plan: ProgressiveBeatPlan[], edits: ReplanEdit[], editableFrom: number, used: { inserted: number; skipped: number }): ReplanResult {
  const head = plan.slice(0, editableFrom);
  const tail: ProgressiveBeatPlan[] = plan.slice(editableFrom).map((p) => ({ ...p, canvas: p.canvas ? { ...p.canvas } : p.canvas }));
  const applied: string[] = [];
  let inserted = 0;
  let skipped = 0;
  const lastId = plan.at(-1)?.canvas?.id ?? plan.at(-1)?.id;
  const idOf = (p: ProgressiveBeatPlan) => p.canvas?.id ?? p.id;
  for (const edit of edits) {
    if (edit.op === "rewrite") {
      const at = tail.findIndex((p) => idOf(p) === edit.id);
      if (at < 0 || !tail[at].canvas) continue;
      const c = tail[at].canvas!;
      tail[at] = { ...tail[at], title: edit.title ?? tail[at].title, objective: edit.brief ?? tail[at].objective, estimatedDurationMs: canvasBoardDurationMs(edit.script), canvas: { ...c, title: edit.title ?? c.title, brief: edit.brief ?? c.brief, script: edit.script, boardNotes: undefined, polishLater: { factCheck: true } } };
      applied.push(`rewrote "${tail[at].title}"`);
    } else if (edit.op === "skip") {
      if (used.skipped + skipped >= MAX_SKIPS_PER_LECTURE || edit.id === lastId) continue;
      const at = tail.findIndex((p) => idOf(p) === edit.id);
      if (at < 0) continue;
      applied.push(`skipped "${tail[at].title}"`);
      tail.splice(at, 1);
      skipped++;
    } else {
      if (used.inserted + inserted >= MAX_INSERTS_PER_LECTURE) continue;
      // After a coming board, or right at the start of the coming boards (after the last fixed one).
      const at = tail.findIndex((p) => idOf(p) === edit.after);
      const afterHead = head.length > 0 && idOf(head[head.length - 1]) === edit.after;
      if (at < 0 && !afterHead) continue;
      const id = `ad${Date.now().toString(36)}${inserted}`;
      const canvas = newBoard(id, edit);
      const entry: ProgressiveBeatPlan = { id, sequence: 0, title: edit.title, objective: edit.brief || edit.title, visualKind: "canvas", estimatedDurationMs: canvasBoardDurationMs(edit.script), canvas } as ProgressiveBeatPlan;
      tail.splice(at < 0 ? 0 : at + 1, 0, entry);
      inserted++;
      applied.push(`added "${edit.title}"`);
    }
  }
  // A board that sat inside, or carried from, a skipped board no longer can.
  const ids = new Set([...head, ...tail].map(idOf));
  for (const p of tail) {
    if (p.canvas?.inside && !ids.has(p.canvas.inside.beat)) p.canvas.inside = null;
  }
  const next: ProgressiveBeatPlan[] = [...head, ...tail].map((p, sequence) => ({ ...p, sequence }));
  return { plan: next, applied, inserted, skipped };
}

/** The replanner's call: its edits and their cost. Never throws (no edits on failure). */
export async function proposeReplan(openai: OpenAI, ctx: ReplanContext): Promise<{ edits: ReplanEdit[]; why: string; costUsd: number }> {
  if (ctx.editableFrom >= ctx.plan.length) return { edits: [], why: "nothing left to change", costUsd: 0 };
  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: "system", content: PROMPT }, { role: "user", content: replanRequest(ctx) }],
      response_format: { type: "json_object" },
      max_completion_tokens: 4000,
      reasoning_effort: "low",
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
    const json = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { why?: unknown };
    return { edits: readEdits(json), why: typeof json.why === "string" ? json.why.slice(0, 200) : "", costUsd: costFor(MODEL, res.usage) };
  } catch (error) {
    return { edits: [], why: `replan failed: ${(error as Error).message.slice(0, 80)}`, costUsd: 0 };
  }
}
