import type { Beat } from "@/lib/lessonContent";
import type { CanvasBoardSpec, StageSpec } from "@/lib/canvas/types";

/** A compact, literal account of what the finished board renderer gives the student. */
export function curriculumBoardEvidence(beat: Beat): { title: string; script: string; visual: string } {
  const op = beat.draw?.ops?.find((candidate) => (candidate as { kind?: string }).kind === "canvasBoard") as { spec?: CanvasBoardSpec } | undefined;
  if (op?.spec) return { title: beat.title, script: beat.script, visual: describeCanvas(op.spec) };

  const ops = beat.draw?.ops ?? [];
  const visible = ops.map((candidate) => {
    const value = candidate as Record<string, unknown>;
    const kind = String(value.kind ?? "unknown");
    const words = [value.text, value.label, value.caption, value.title]
      .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
      .join(" — ");
    return words ? `${kind}: ${words}` : kind;
  });
  return { title: beat.title, script: beat.script, visual: visible.length ? visible.join("; ") : "No visible teaching content detected." };
}

function describeCanvas(spec: CanvasBoardSpec): string {
  const notes = spec.notes.map((note) => note.text);
  return [`Heading: ${spec.heading}`, describeStage(spec.stage), notes.length ? `Notes: ${notes.join("; ")}` : ""].filter(Boolean).join("\n");
}

function describeStage(stage: StageSpec): string {
  switch (stage.kind) {
    case "illustration":
      return `Textbook illustration subject: ${stage.subject}. Visible parts: ${stage.parts.map((part) => part.name).join(", ")}. Written labels: ${stage.labels.join(", ") || "none"}.`;
    case "flow":
      return `Flow nodes: ${stage.nodes.map((node) => [node.label, node.sub].filter(Boolean).join(" — ")).join("; ")}. Arrows: ${stage.arrows.map((arrow) => `${arrow.from} -> ${arrow.to}${arrow.label ? ` (${arrow.label})` : ""}`).join("; ") || "none"}.`;
    case "equation":
      return `Equation tokens: ${stage.tokens.map((token) => token.text).join(" ")}. Visible steps: ${stage.steps.map((step) => step.order.map((id) => stage.tokens.find((token) => token.id === id)?.text ?? "?").join(" ")).join(" | ")}.`;
    case "graph":
      return `Graph axes: ${stage.x.label} and ${stage.y.label}. Curves: ${stage.curves.map((curve) => curve.label ?? curve.expr).join(", ")}. Markers: ${(stage.markers ?? []).map((marker) => marker.label ?? marker.id).join(", ") || "none"}.`;
    case "compare":
      return `Comparison: ${stage.left.title} [${stage.left.items.map((item) => item.text).join("; ")}] versus ${stage.right.title} [${stage.right.items.map((item) => item.text).join("; ")}].`;
    case "scene":
      return `Scene items: ${stage.items.map((item) => `${item.label || item.id}${item.icon ? ` [${item.icon}]` : ""}`).join("; ")}. Arrows: ${stage.arrows.map((arrow) => `${arrow.from} -> ${arrow.to}${arrow.label ? ` (${arrow.label})` : ""}`).join("; ") || "none"}.`;
    case "code":
      return `${stage.language} code:\n${stage.lines.join("\n")}`;
    case "molecule":
      return `Deterministic molecular models: ${stage.molecules.map((molecule) => `${molecule.label}: ${molecule.geometry}${molecule.bondAngle ? ` at ${molecule.bondAngle}` : ""}; atoms ${molecule.atoms.map((atom) => `${atom.element}${atom.lonePairs ? ` with ${atom.lonePairs} lone pairs` : ""}`).join(", ")}; bonds ${molecule.bonds.map((bond) => `${bond.from}-${bond.to} (${bond.style ?? "line"})`).join(", ")}`).join(" | ")}.`;
    case "figure":
      return stage.asset
        ? `Textbook diagram (${stage.asset.credit}) with exact labelled parts: ${stage.parts.map((part) => part.name).join(", ")}.`
        : `Code-drawn textbook figure (${stage.component}) with exact labelled parts: ${stage.parts.map((part) => part.name).join(", ")}.`;
    case "exam":
      return `Exam question (${stage.marks} marks, command word ${stage.commandWord}): ${stage.question}. Mark-scheme points: ${stage.points.map((p) => p.text).join("; ")}.${stage.lostMarks ? ` Loses marks: ${stage.lostMarks.text}.` : ""}`;
    case "atom-map":
      return `Atom map: ${stage.reactants.map((group) => `${group.label} [${group.atoms.map((atom) => `${atom.element}×${atom.count}`).join(", ")}]`).join(" + ")} -> ${stage.products.map((group) => `${group.label} [${group.atoms.map((atom) => `${atom.element}×${atom.count}`).join(", ")}]`).join(" + ")}. Energy lane: ${stage.energy ? `${stage.energy.input} -> ${stage.energy.output}` : "none"}.`;
  }
}
