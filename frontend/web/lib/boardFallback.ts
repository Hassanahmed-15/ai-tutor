import OpenAI from "openai";
import type { Beat } from "./lessonContent";
import { fillBlackboardOps } from "./blackboardGen";
import { fillStructureSceneOps } from "./structureSceneGen";
import { fillSpecBoardOps } from "./specBoardGen";
import type { BeatVisualSpec } from "./beatVisualSpec";
import { specToBrief } from "./beatVisualSpec";
import type { VisualForm } from "./director";

/**
 * Guarantees every teaching beat ends up with a board a student can actually look at.
 *
 * THE FAILURE THIS REPLACES. A beat on "Parameter Tuning" rendered a card reading "ANIMATION
 * UNAVAILABLE — generated animation code was not available". The React generator had spent all of
 * its attempts, `op.code` was left unset, and nothing downstream tried anything else. The lesson
 * simply had a dead slide in the middle of it.
 *
 * That is the wrong shape for a failure here. Every engine in this codebase can teach the same
 * content at a different fidelity, so a beat whose first choice fails should DROP DOWN, not stop:
 * an unbuildable illustration becomes a structural diagram, and if even that fails it becomes a
 * written board — which is always fillable, because it needs no geometry, no data and no code.
 *
 * WHY THE CHAIN ENDS AT chalkBoard. It is the only board with no way to fail on content: give it a
 * brief and it writes. A written board is a worse picture than a good diagram and a far better
 * lesson than an error card.
 */

export const CHAIN: Record<VisualForm, readonly ("structureScene" | "plotBoard" | "equationBoard" | "chalkBoard")[]> = {
  // The illustration failed, so try the structure of what it was illustrating, then say it plainly.
  "labelled-diagram": ["structureScene", "chalkBoard"],
  plot: ["chalkBoard"],
  equation: ["chalkBoard"],
  network: ["chalkBoard"],
  transformation: ["structureScene", "chalkBoard"],
  construction: ["structureScene", "chalkBoard"],
  "animated-maths": ["equationBoard", "chalkBoard"],
  text: ["chalkBoard"],
};

type DrawOpLike = { kind?: string; spec?: unknown; code?: string; ops?: unknown } & Record<string, unknown>;

/**
 * Board ops that count as "this beat has a visual", i.e. FILLED, not merely placed.
 *
 * Exported so the distinction can be tested directly. It is the whole judgement this module makes,
 * and on a healthy lecture nothing triggers it — so without a unit test the only evidence it works
 * would be that it never ran, which is no evidence at all.
 */
const BOARD_OP_KINDS = new Set([
  "reactAnimation",
  "manimScene",
  "structureScene",
  "plotBoard",
  "equationBoard",
  "chalkBoard",
]);

/** A board op that carries real content, as opposed to an unfilled placeholder. */
function boardOpIsFilled(op: DrawOpLike): boolean {
  switch (op.kind) {
    // A placeholder whose fill failed is NOT a board — the exact distinction the
    // "animation unavailable" card was reporting and nothing was acting on.
    case "reactAnimation":
      return typeof op.code === "string" && op.code.length > 0;
    case "chalkBoard":
      return Array.isArray(op.ops) && op.ops.length > 0;
    default:
      return op.spec != null;
  }
}

export function hasUsableBoard(beat: Beat): boolean {
  const ops = (beat.draw as { ops?: DrawOpLike[] } | undefined)?.ops;
  if (!Array.isArray(ops) || ops.length === 0) return false;

  /**
   * A BOARD OP, ONCE PRESENT, DECIDES THIS — hand-drawn ops cannot vouch for it.
   *
   * This was `ops.some(...)` with a `default: return true` arm for labels and shapes, and that arm
   * quietly answered for the whole beat: a beat carrying an UNFILLED plotBoard plus one leftover
   * label returned true, the rescue skipped it as healthy, and the renderer then selected the dead
   * placeholder. Measured on a real lecture — one beat in nine came back with an empty board and no
   * `[fallback]` line, because as far as this function was concerned there was nothing to fix.
   *
   * So: if the beat has board ops at all, it is usable only when one of them is actually filled.
   * Stray labels are decoration around a board, never a substitute for one.
   */
  const boardOps = ops.filter((op) => BOARD_OP_KINDS.has(String(op.kind)));
  if (boardOps.length > 0) return boardOps.some(boardOpIsFilled);

  // No board op at all: hand-authored ops (labels, shapes, morphs, images) are drawn directly by
  // LiveSketch, so their presence does mean something is on screen.
  return true;
}

export type FallbackStats = { costUsd: number; rescued: number; stillEmpty: number };

/**
 * Runs after every fill pass. For each teaching beat with no usable board, re-briefs it onto the
 * next engine in its chain and fills that, repeating until something lands.
 */
export async function rescueEmptyBoards(
  client: OpenAI,
  beats: Beat[],
  specs: Map<string, BeatVisualSpec>,
  forms: Map<string, VisualForm>,
): Promise<FallbackStats> {
  const stats: FallbackStats = { costUsd: 0, rescued: 0, stillEmpty: 0 };

  const stranded = beats.filter((beat) => beat.slideKind !== "checkpoint" && beat.draw && !hasUsableBoard(beat));
  if (stranded.length === 0) return stats;
  console.error(`[fallback] ${stranded.length} beat(s) have no usable board: ${stranded.map((b) => b.id).join(", ")}`);

  for (const beat of stranded) {
    const spec = specs.get(beat.id);
    const form = forms.get(beat.id);
    // With no specification to re-brief from, the beat title is still a real instruction — thin,
    // but enough for a written board, and better than leaving an error card on screen.
    const brief = spec ? specToBrief(spec) : beat.title;
    const chain = form ? CHAIN[form] : (["chalkBoard"] as const);

    for (const board of chain) {
      const draw = beat.draw as { ops?: DrawOpLike[] } | undefined;
      if (!draw) break;
      // Replace the dead placeholder outright: leaving it in place means the renderer selector can
      // still pick it and show the same empty card.
      const keep = (draw.ops ?? []).filter(
        (op) => !["reactAnimation", "manimScene", "structureScene", "plotBoard", "equationBoard", "chalkBoard"].includes(String(op.kind)),
      );
      draw.ops = [placeholderFor(board, brief), ...keep] as typeof draw.ops;

      const filled = await fillOne(client, board, beats, beat);
      stats.costUsd += filled;
      if (hasUsableBoard(beat)) {
        stats.rescued++;
        console.error(`[fallback] beat=${beat.id} rescued with ${board}`);
        break;
      }
    }

    if (!hasUsableBoard(beat)) {
      stats.stillEmpty++;
      console.error(`[fallback] beat=${beat.id} STILL has no board after its whole chain`);
    }
  }

  console.error(`[fallback] rescued ${stats.rescued}, still empty ${stats.stillEmpty}, $${stats.costUsd.toFixed(4)}`);
  return stats;
}

function placeholderFor(board: string, brief: string): DrawOpLike {
  switch (board) {
    case "structureScene":
      return { kind: "structureScene", structureBrief: brief, at: 0, endAt: 1 };
    case "plotBoard":
      return { kind: "plotBoard", plotBrief: brief, at: 0, endAt: 1 };
    case "equationBoard":
      return { kind: "equationBoard", equationBrief: brief, at: 0, endAt: 1 };
    default:
      return { kind: "chalkBoard", boardBrief: brief, at: 0, endAt: 1 };
  }
}

/** Fills just this beat by handing the existing pass a one-beat array. */
async function fillOne(client: OpenAI, board: string, _all: Beat[], beat: Beat): Promise<number> {
  try {
    if (board === "structureScene") return (await fillStructureSceneOps(client, [beat])).costUsd;
    if (board === "plotBoard" || board === "equationBoard") return (await fillSpecBoardOps(client, [beat])).costUsd;
    return (await fillBlackboardOps(client, [beat], false)).costUsd;
  } catch (err) {
    console.error(`[fallback] beat=${beat.id} ${board} fill threw: ${err instanceof Error ? err.message : "error"}`);
    return 0;
  }
}
