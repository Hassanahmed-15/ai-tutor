import { figureComponent } from "../figures/registry";
import { classifyInstructionalTask } from "./instructionalTask";
import { layoutPanel } from "./layout";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";

/**
 * Scientific/disciplinary meaning checks. Structural validation answers "can this render?"; this
 * gate answers "is it the representation this learning task requires?".  Only facts code can know
 * with certainty belong here. Ambiguous judgements remain outside the hard gate.
 */
export function semanticBoardIssues(spec: CanvasBoardSpec, beat: Pick<CanvasPlanBeat, "title" | "brief" | "script" | "objects" | "requiredVisual" | "rejectedFigures">): string[] {
  const decision = classifyInstructionalTask(beat);
  const issues: string[] = [];
  if (!decision.figure) return issues;
  // A maths/CS sketch board was chosen over the catalogue on purpose (lib/canvas/visualPolicy.ts): it
  // draws what the board needs live, so no fixed renderer is demanded back.
  if (spec.stage.kind === "sketch") return issues;
  // The board review judged this diagram wrong for this board (it saw what was drawn); a keyword
  // rule must not demand it back — that contradiction sent rebuilt boards to the bare backup.
  if (beat.rejectedFigures?.includes(decision.figure)) return issues;
  if (spec.stage.kind !== "figure") return [`${decision.task} requires the ${decision.figure} semantic renderer, not ${spec.stage.kind}`];
  if (spec.stage.component !== decision.figure) return [`${decision.task} requires figure component ${decision.figure}, not ${spec.stage.component}`];

  const component = figureComponent(spec.stage.component);
  if (!component) return [`semantic renderer ${spec.stage.component} is not registered`];
  const drawn = new Set(component.build(spec.stage.params).parts.map((part) => part.id));
  const labelled = new Set(spec.stage.parts.map((part) => part.id));
  for (const id of decision.requiredParts ?? []) {
    if (!drawn.has(id)) issues.push(`${spec.stage.component} does not draw required part ${id}`);
    else if (!labelled.has(id)) issues.push(`required part ${id} is not visibly labelled`);
  }
  // Correct semantics are still unusable if the labelled drawing is squeezed into a thumbnail.
  // This is deterministic and therefore belongs in the release gate, rather than a subjective
  // model-authored score.
  const figure = layoutPanel(spec).marks.find((mark) => mark.type === "figure");
  if (!figure || figure.rect.w < 360 || figure.rect.h < 180) {
    issues.push(`${spec.stage.component} is too small to teach from (minimum 360×180 board units)`);
  }
  return issues;
}
