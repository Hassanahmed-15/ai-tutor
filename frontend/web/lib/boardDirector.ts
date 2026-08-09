import OpenAI from "openai";
import type { Beat } from "./lessonContent";
import { direct, FORM_FUNCTION, type BoardKind, type DirectorPlan, type VisualForm } from "./director";
import { planBeatVisual, specToBrief, type BeatVisualSpec } from "./beatVisualSpec";

/**
 * Re-points each teaching beat at the board its content actually calls for.
 *
 * WHAT THIS REPLACES. Board type is currently decided inside a 19k-character lecture prompt that
 * also has to write the script, pace the lesson and hit depth gates — and the evidence from this
 * project is that board-selection rules buried mid-prompt are the first thing a model drops. The
 * director asks one short question per beat instead, and the answer maps to a renderer in code.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never invents a board or writes a spec: it swaps the beat's
 * board PLACEHOLDER, and the existing fill passes (manimSceneGen, structureSceneGen,
 * reactAnimationGen, blackboardGen) do exactly what they already did. `selectAnimationRenderer` in
 * animationRouting.ts is untouched too — it selects from the ops present, so changing which op a
 * beat carries is enough.
 *
 * TWO CALLS PER BEAT: `planBeatVisual` states what the picture must contain, then `direct`
 * classifies that statement. The specification is then handed on as the engine's brief and as the
 * gate for the stock-photo path, so it is used three times rather than thrown away — which is why
 * the second call pays for itself rather than only costing.
 *
 * OFF BY DEFAULT (`BOARD_DIRECTOR=1`). This changes how every lecture picks its boards, and none
 * of the measured animation-quality gain came from it — that came from the artwork catalogue and
 * the vision critic, both of which are on unconditionally. A switch this consequential should be
 * something you turn on deliberately, and it costs ~$0.10 a lecture.
 */

const ENABLED = process.env.BOARD_DIRECTOR === "1";
/** Beat 0 is the hook; the lecture prompt keeps it deliberately visual-light. */
const SKIP_BEATS = 1;

export function boardDirectorEnabled(): boolean {
  return ENABLED;
}

export type DirectorStats = {
  costUsd: number;
  routed: number;
  skipped: number;
  /** Per beat, what the picture must be OF. Consumed by the photo gate and the fallback chain. */
  specs: Map<string, BeatVisualSpec>;
  /** Per beat, the form it classified as. The photo gate needs it. */
  forms: Map<string, VisualForm>;
};

type DrawOpLike = { kind?: string } & Record<string, unknown>;

/** The op each board kind is a placeholder for, carrying the director's brief as its grounding. */
function placeholderFor(board: BoardKind, plan: DirectorPlan, beat: Beat): DrawOpLike | null {
  switch (board) {
    case "reactAnimation":
      return { kind: "reactAnimation", teachingPoint: plan.brief, at: 0, endAt: 1 };
    case "manimScene":
      return { kind: "manimScene", sceneBrief: plan.brief, at: 0, endAt: 1 };
    // `structureBrief`, not `sceneBrief`. Each board reads its own brief key in drawSanitize, and a
    // placeholder carrying the wrong one is dropped there for having no brief at all — silently,
    // which is how a routed beat ends up with no board.
    case "structureScene":
      return { kind: "structureScene", structureBrief: plan.brief, at: 0, endAt: 1 };
    case "chalkBoard":
      return { kind: "chalkBoard", boardBrief: plan.brief || beat.title, at: 0, endAt: 1 };
    case "plotBoard":
      return { kind: "plotBoard", plotBrief: plan.brief, at: 0, endAt: 1 };
    case "equationBoard":
      return { kind: "equationBoard", equationBrief: plan.brief, at: 0, endAt: 1 };
    // `morph` is not a placeholder the fill passes complete — a morph board is written inline by
    // the lecture call as real ops. Rewriting one from a brief would mean inventing the before and
    // after states here, which is authoring, not routing. Leave the beat as it is.
    case "morph":
      return null;
  }
}

/** Board ops the director owns. Anything else on the beat (labels, arrows, notes) is left alone. */
const BOARD_KINDS = new Set(["reactAnimation", "manimScene", "structureScene", "chalkBoard", "plotBoard", "equationBoard"]);

/**
 * Classifies every teaching beat and swaps its board placeholder to match.
 *
 * Never throws and never empties a beat: a failed classification, an unusable form, or a beat that
 * already carries the right board all leave it exactly as the lecture call wrote it.
 */
export async function directBoards(client: OpenAI, beats: Beat[]): Promise<DirectorStats> {
  const stats: DirectorStats = { costUsd: 0, routed: 0, skipped: 0, specs: new Map(), forms: new Map() };
  const specs = stats.specs;
  if (!ENABLED) return stats;

  await Promise.all(
    beats.map(async (beat, index) => {
      const script = typeof beat.script === "string" ? beat.script : "";
      if (index < SKIP_BEATS || !script) {
        stats.skipped++;
        return;
      }

      /**
       * TWO STAGES, deliberately.
       *
       * Stage one states what the picture must CONTAIN; stage two classifies that statement into a
       * visual form. Classifying the raw script directly was cheaper and worse: the classifier had
       * to infer the subject and the form at once from narration written for the ear, and every
       * engine downstream then worked from a single inferred sentence.
       *
       * The specification is the artefact that matters. It disambiguates the subject once — "the
       * SVM decision boundary, NOT a physical machine" — and that travels with the beat into the
       * classifier, into the engine brief, and into the photo gate, instead of each of them
       * guessing again from the same ambiguous words.
       */
      let spec: BeatVisualSpec | null = null;
      try {
        const planned = await planBeatVisual(client, beat);
        spec = planned.spec;
        stats.costUsd += planned.costUsd;
      } catch (err) {
        console.error(`[director] beat=${beat.id} visual spec failed: ${err instanceof Error ? err.message : "error"}`);
      }
      if (!spec) {
        stats.skipped++;
        return;
      }
      specs.set(beat.id, spec);

      let plan: DirectorPlan | null = null;
      try {
        const out = await direct(client, specToBrief(spec));
        plan = out.plan;
        stats.costUsd += out.costUsd;
      } catch (err) {
        console.error(`[director] beat=${beat.id} classification failed: ${err instanceof Error ? err.message : "error"}`);
      }
      if (!plan) {
        stats.skipped++;
        return;
      }
      // The engine is briefed with the full specification, not the classifier's one-liner. That
      // richer grounding is the whole point of stage one, not a side effect of it.
      plan = { ...plan, brief: specToBrief(spec) };
      // Recorded BEFORE any early return below. The photo gate needs a form for every beat it might
      // put a photograph on, including the ones already carrying the right board.
      stats.forms.set(beat.id, plan.form);

      const draw = beat.draw as { ops?: DrawOpLike[] } | undefined;
      const ops = Array.isArray(draw?.ops) ? draw.ops : null;
      if (!ops) {
        stats.skipped++;
        return;
      }

      const current = ops.find((op) => BOARD_KINDS.has(String(op.kind)));
      if (current && current.kind === plan.board) {
        console.error(`[director] beat=${beat.id} ${plan.form} -> ${plan.board} (already correct) · ${FORM_FUNCTION[plan.form]}`);
        stats.skipped++;
        return;
      }

      const replacement = placeholderFor(plan.board, plan, beat);
      if (!replacement) {
        stats.skipped++;
        return;
      }

      /**
       * A reactAnimation beat carries the animation op AND NOTHING ELSE.
       *
       * This cost a whole verification run to find. Keeping the beat's existing labels and shapes
       * alongside the new animation looked harmless — structureScene coexists with them happily —
       * but the animation pipeline treats a beat with both as a written board, and the animation
       * op was silently dropped between generation and the response. The logs showed all three
       * beats generating code successfully and the finished lecture carrying no animation at all.
       *
       * The lecture prompt already emits animation beats this way (drawSanitize returns `ops: [op]`
       * for them); the director has to match that shape, not invent a hybrid.
       */
      const keep = plan.board === "reactAnimation" ? [] : ops.filter((op) => !BOARD_KINDS.has(String(op.kind)));
      draw!.ops = [replacement, ...keep];
      stats.routed++;
      console.error(
        `[director] beat=${beat.id} ${plan.form} -> ${plan.board}` +
          (current ? ` (was ${current.kind})` : " (was none)") +
          ` · ${plan.reason}`,
      );
    }),
  );

  console.error(`[director] routed ${stats.routed}, left alone ${stats.skipped}, $${stats.costUsd.toFixed(4)}`);
  return stats;
}
