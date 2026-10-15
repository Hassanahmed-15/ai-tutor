import type { CanvasBoardSpec, StageSpec } from "../canvas/types";

export type VisualContract = { stages: string[]; mustShow: string[] };

/** Structural checks only: these prevent empty/decorative boards, not subjective design choices. */
export function visualContractIssues(spec: CanvasBoardSpec, contract: VisualContract): string[] {
  const stage = spec.stage as StageSpec;
  const issues: string[] = [];
  if (contract.stages.length && !contract.stages.includes(stage.kind)) {
    issues.push(`stage ${stage.kind} is not one of ${contract.stages.join(", ")}`);
    return issues;
  }
  switch (stage.kind) {
    case "illustration":
      if (stage.parts.length < 3) issues.push("illustration needs at least three distinct parts");
      if (/label|identify|structure|diagram/i.test(contract.mustShow.join(" ")) && stage.labels.length < 1) issues.push("required structural labels are missing");
      break;
    case "flow":
      if (stage.nodes.length < 3 || stage.arrows.length < 2) issues.push("process board needs at least three nodes and two directional arrows");
      break;
    case "equation":
      if (stage.tokens.length < 3 || stage.steps.length < 1) issues.push("equation board needs tokens and at least one worked step");
      break;
    case "graph":
      if (!stage.x.label || !stage.y.label || stage.curves.length < 1) issues.push("graph needs labelled axes and a curve");
      if (/marker|guide/i.test(contract.mustShow.join(" ")) && !(stage.markers?.length || stage.guides?.length)) issues.push("graph needs a marker or guide at the point the lesson reads off");
      break;
    case "compare":
      if (stage.left.items.length < 2 || stage.right.items.length < 2) issues.push("comparison needs distinguishing items on both sides");
      break;
    case "molecule":
      if (stage.molecules.some((m) => m.atoms.length < 2 || m.bonds.length < 1 || !m.geometry)) issues.push("molecular board needs atoms, bonds and geometry");
      if (/bond angle|lone pair/i.test(contract.mustShow.join(" ")) && stage.molecules.some((m) => !m.bondAngle && !m.atoms.some((a) => (a.lonePairs ?? 0) > 0))) issues.push("molecular board needs its bond angle or its lone pairs drawn");
      break;
    case "atom-map":
      if (!stage.reactants.length || !stage.products.length) issues.push("atom map needs both reactants and products");
      break;
    case "code":
      if (stage.lines.length < 3 || stage.steps.length < 1) issues.push("code board needs real lines and execution steps");
      break;
    case "figure":
      if (stage.parts.length < 2) issues.push("figure needs at least two labelled parts");
      break;
    case "scene":
      if (stage.items.length < 2) issues.push("scene needs more than one visible relationship item");
      break;
  }
  return issues;
}
