import "server-only";

import type { Beat } from "../lessonContent";
import type { ProgressiveBeatPlan, ProgressiveLectureInput } from "../progressiveLectureTypes";
import { bounded, canvasBeat, client, fallbackSpec, generateSpec, illustrate, jsonCall, PLAN_MODEL, validatePlan, type Clock } from "./generate";
import { layoutPanel } from "./layout";
import { canvasBoardCount, canvasBoardDurationMs, canvasPlanRequest, canvasRefresherAllowed } from "./lessonRequest";
import { applyConceptColours, planConceptColours, recapTour } from "./lessonPasses";
import { CANVAS_PLAN_PROMPT } from "./prompts";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";
import type { PlanningKnowledge } from "../knowledge/graph";
import { slug } from "./validate";

/**
 * THE LESSON CANVAS INSIDE THE PROGRESSIVE WORKER (lib/progressiveLectureWorker.ts).
 *
 * A typed-prompt lecture is planned and taught exactly as before — the planning conversation, the
 * worker's queue, the snapshot the player polls, history, Aria's voice — but its boards are canvas
 * boards. Two things differ from the ordinary boards, and both come from the canvas being ONE
 * lesson rather than independent slides:
 *
 *   - The plan writes every board's script at once (one call), so the boards build on each other
 *     and the recap can walk back over them. The worker then only writes each board's spec.
 *   - Boards are written in parallel, so a board cannot wait for the others: the lesson's concept
 *     colours are fixed from the plan, and a reference to an earlier board ("inside" it, "carry"
 *     from it) is checked against that board only if it is already written; the renderer ignores
 *     one that does not resolve.
 */

const BOARD_BUDGET_MS = Number(process.env.CANVAS_BOARD_BUDGET_MS) || 170_000;

/** The Beat id of a canvas board — deterministic, so the recap can name boards not yet written. */
export function canvasBeatId(sessionId: string, planId: string): string {
  return `cv-${sessionId}-${planId}`;
}

export async function planCanvasLecture(input: ProgressiveLectureInput, knowledge?: PlanningKnowledge): Promise<{ plan: ProgressiveBeatPlan[]; costUsd: number }> {
  const openai = client();
  const request = canvasPlanRequest(input, knowledge);
  // The approved outline sized the lecture; the plan may not grow it (only a refresher may be added).
  const outlined = canvasBoardCount(input);
  const allowed = outlined > 0 ? outlined + (canvasRefresherAllowed(input, knowledge) ? 1 : 0) : 0;
  let costUsd = 0;
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { json, costUsd: c } = await bounded(jsonCall(openai, PLAN_MODEL, CANVAS_PLAN_PROMPT, attempt > 1 && lastError ? `${request}\n\nYour previous plan could not be used: ${lastError}` : request, 9000), 120_000, "canvas plan");
      costUsd += c;
      let plan = validatePlan(json);
      if (plan && allowed > 0 && plan.beats.length > allowed) {
        lastError = `it had ${plan.beats.length} boards; the outline has exactly ${outlined}${allowed > outlined ? " (plus the one refresher)" : ""}`;
        if (attempt < 2) continue;
        // Still over: keep the refresher (if first) and the outline's boards, drop the extras.
        const keep = plan.beats.filter((b, i) => (b.refresher && i === 0) || !b.refresher).slice(0, allowed);
        plan = { ...plan, beats: keep };
      }
      if (plan) {
        return {
          costUsd,
          plan: plan.beats.map((beat, sequence) => ({
            id: beat.id,
            sequence,
            title: beat.title,
            objective: beat.brief || beat.title,
            conceptId: slug(beat.title, beat.id),
            visualKind: "canvas",
            estimatedDurationMs: canvasBoardDurationMs(beat.script),
            canvas: beat,
          })),
        };
      }
      lastError = "the plan had fewer than three usable boards";
    } catch (error) {
      costUsd += (error as { costUsd?: number }).costUsd ?? 0;
      lastError = (error as Error).message;
    }
  }
  throw new Error(`The canvas lesson could not be planned: ${lastError}`);
}

/**
 * One board, written whole: its spec, its picture when it is an illustration, its lesson colours,
 * and its references to other boards resolved. Never throws — a board that cannot be written falls
 * back to a simple scene, so the lesson never loses a board.
 */
export async function writeCanvasBoard(args: {
  userId: string;
  sessionId: string;
  topic: string;
  plan: CanvasPlanBeat[];
  index: number;
  /** Specs of the earlier boards already written, by plan index; undefined = not written yet. */
  earlier: Array<CanvasBoardSpec | undefined>;
  /** What the student has done so far that the board should take into account. */
  notes: string[];
}): Promise<{ beat: Beat; costUsd: number; fallback: boolean; log: string[] }> {
  const { plan, index, sessionId } = args;
  const beat = plan[index];
  const started = Date.now();
  const clock: Clock = { left: () => BOARD_BUDGET_MS - (Date.now() - started) };
  const log: string[] = [];
  const colours = planConceptColours(plan);

  const extra: string[] = [];
  const shared = beat.objects.filter((o) => colours[o]);
  if (shared.length) extra.push(`Lesson colours — these things appear on several boards, so give them exactly these colours: ${shared.map((o) => `${o} ${colours[o]}`).join(", ")}.`);
  if (args.notes.length) extra.push(`What the student has shown so far (pitch the notes, cues and any interaction to it): ${args.notes.slice(-3).join(" ")}`);

  let made: { spec: CanvasBoardSpec; costUsd: number; attempts: number };
  let pictured: { spec: CanvasBoardSpec; costUsd: number };
  try {
    const openai = client();
    made = await generateSpec(openai, args.topic, plan, beat, clock, extra);
    pictured = await illustrate(openai, args.userId, sessionId, beat, made.spec, log, clock);
  } catch (error) {
    log.push(`${beat.id}: ${(error as Error).message}`);
    made = { spec: fallbackSpec(beat), costUsd: 0, attempts: -1 };
    pictured = { spec: made.spec, costUsd: 0 };
  }
  const spec: CanvasBoardSpec = { ...pictured.spec };
  applyConceptColours(spec, colours);

  // "Inside" an earlier board: checked against that board when it is written.
  const parentIndex = beat.inside ? plan.findIndex((b) => b.id === beat.inside!.beat) : -1;
  const parent = parentIndex >= 0 && parentIndex < index ? args.earlier[parentIndex] : undefined;
  const insideOk = parentIndex >= 0 && parentIndex < index && (!parent || Boolean(layoutPanel(parent).targets[beat.inside!.object]));
  if (insideOk) spec.inside = { beat: canvasBeatId(sessionId, beat.inside!.beat), id: beat.inside!.object };
  else delete spec.inside;

  // "Carry" from the previous board: only a whole element of the same kind flies across.
  const previous = index > 0 ? args.earlier[index - 1] : undefined;
  const typesHere = new Map(layoutPanel(spec).marks.map((m) => [m.id, m.type]));
  const typesBefore = previous ? new Map(layoutPanel(previous).marks.map((m) => [m.id, m.type])) : null;
  const carry = (spec.carry ?? beat.carry).filter((id) => index > 0 && typesHere.has(id) && (!typesBefore || typesBefore.get(id) === typesHere.get(id)));
  if (carry.length) spec.carry = carry;
  else delete spec.carry;

  // The recap's visits go back to boards the student has seen, by their deterministic ids.
  if (beat.overview) spec.overview = true;
  if (beat.refresher) spec.refresher = true;
  const earlierIds = new Set(plan.slice(0, index).map((b) => b.id));
  spec.cues = spec.cues.filter((c) => c.action !== "visit" || earlierIds.has(c.beat ?? ""));
  if (beat.overview && !spec.cues.some((c) => c.action === "visit")) spec.cues = [...spec.cues, ...recapTour(beat, plan.slice(0, index))];
  spec.cues = spec.cues.map((c) => (c.action === "visit" ? { ...c, beat: canvasBeatId(sessionId, c.beat!) } : c));

  log.unshift(`${beat.id}: ${spec.stage.kind} in ${Math.round((Date.now() - started) / 1000)}s, ${made.attempts < 0 ? "FALLBACK board" : `${made.attempts} attempt(s)`}`);
  return { beat: canvasBeat(canvasBeatId(sessionId, beat.id), beat, index, spec), costUsd: made.costUsd + pictured.costUsd, fallback: made.attempts < 0, log };
}

/** The spec a written canvas Beat carries, if it is one. */
export function canvasSpecOf(beat: Beat | null | undefined): CanvasBoardSpec | undefined {
  const op = beat?.draw?.ops.find((o) => (o as { kind: string }).kind === "canvasBoard") as { spec?: CanvasBoardSpec } | undefined;
  return op?.spec;
}
