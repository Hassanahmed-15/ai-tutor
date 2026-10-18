import { auditBoardForRelease, type BoardReleaseFinding } from "../canvas/releaseAudit";
import { layoutPanel, takeLayoutDrops } from "../canvas/layout";
import { takeFigureCutItems } from "../figures/cuts";
import { figurePartObligations, isCurriculumProseMustShow } from "../curriculum/visualContract";
import type { CanvasBoardSpec, CanvasPlanBeat } from "../canvas/types";

const PLACEHOLDER = /\b(todo|tbd|lorem|placeholder|xxx+|label \d+|part \d+)\b/i;

/**
 * Symbolic ship/fail checks (Phase 0 scoring + Phase 3 gate). A board that fails these is not
 * "diagrams and labels" ≥ 8, regardless of a vision judge.
 */
export function symbolicBoardIssues(spec: CanvasBoardSpec, beat: CanvasPlanBeat): string[] {
  const issues = auditBoardForRelease(spec, beat).map((f: BoardReleaseFinding) => `${f.gate}: ${f.message}`);
  // Text the board could not show whole — shortened to fit, or left off for want of room. The scorer
  // used to see neither, so a board could lose words and still score full marks (2026-10-17).
  takeFigureCutItems();
  takeLayoutDrops();
  const layout = layoutPanel(spec);
  for (const cut of takeFigureCutItems()) issues.push(`text-cut: "${cut.text.slice(0, 80)}" shortened to ${cut.max} characters`);
  for (const drop of takeLayoutDrops()) issues.push(`text-dropped: ${drop}`);
  for (const mark of layout.marks) {
    const text = mark.type === "text" ? mark.text
      : mark.type === "box" ? mark.label ?? ""
      : mark.type === "figure-label" ? mark.lines.join(" ")
      : "";
    if (text && PLACEHOLDER.test(text)) issues.push(`placeholder text on "${mark.id}": ${text}`);
  }
  if (beat.requiredVisual?.mustShow.length) {
    const shown = new Set(layout.marks.map((m) => m.id.toLowerCase()));
    const needed = spec.stage.kind === "figure"
      ? figurePartObligations(spec, beat.requiredVisual.mustShow)
      : beat.requiredVisual.mustShow.filter((part) => !isCurriculumProseMustShow(part));
    const geometric = /\b(reflect|rotat|translat\w*|enlarg|mirror line|scale factor|column vector)\b/i.test(`${beat.title} ${beat.brief} ${beat.script}`);
    for (const part of needed) {
      // Kit leftovers: visual policy stamps object/image onto any coordinateGrid, including
      // gradient and identity boards that never draw a transformed shape.
      if (/^(object|image|image-vertex|mirror-line)$/i.test(part) && !geometric) continue;
      const key = part.toLowerCase().replace(/_/g, "-");
      if (![...shown].some((id) => id.includes(key) || key.includes(id))) {
        issues.push(`required part "${part}" is not a laid-out mark`);
      }
    }
  }
  return issues;
}
