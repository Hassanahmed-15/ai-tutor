import type { CanvasBoardSpec } from "./types";

/**
 * A canvas board in words, for Aria's live context and the side chat: what is drawn, what is written
 * and what the student can do on it — so "what's that arrow?" or "what happens if I turn the light
 * down?" can be answered about THIS board.
 */
export function describeCanvasSpec(spec: CanvasBoardSpec): string {
  const lines: string[] = [`Board "${spec.heading}" (a panel on the lesson canvas).`];
  if (spec.notes.length) lines.push(`Written notes: ${spec.notes.map((n) => n.text).join(" · ")}`);
  const stage = spec.stage;
  switch (stage.kind) {
    case "flow": {
      const name = new Map(stage.nodes.map((n) => [n.id, n.label]));
      lines.push(`Diagram (${stage.arrangement}): ${stage.nodes.map((n) => `${n.label}${n.sub ? ` (${n.sub})` : ""}`).join(", ")}.`);
      if (stage.arrows.length) lines.push(`Arrows: ${stage.arrows.map((a) => `${name.get(a.from)} → ${name.get(a.to)}${a.label ? ` "${a.label}"` : ""}${a.flow ? " (particles flowing)" : ""}`).join("; ")}.`);
      break;
    }
    case "illustration":
      lines.push(`Illustration: ${stage.subject}`, `Parts shown: ${stage.parts.map((p) => p.name).join(", ")}.`);
      break;
    case "equation": {
      const text = new Map(stage.tokens.map((t) => [t.id, t.text]));
      lines.push(`Equation, step by step: ${stage.steps.map((s) => `${s.order.map((id) => text.get(id)).join(" ")}${s.caption ? ` (${s.caption})` : ""}`).join("  ⟶  ")}`);
      break;
    }
    case "graph":
      lines.push(`Graph of ${stage.y.label} against ${stage.x.label} (${stage.x.min}–${stage.x.max}): ${stage.curves.map((c) => `${c.label ?? c.id} = ${c.expr}`).join("; ")}.`);
      if (stage.guides?.length) lines.push(`Marked: ${stage.guides.map((g) => `${g.label} at ${g.x}`).join(", ")}.`);
      break;
    case "compare":
      lines.push(`Comparison — ${stage.left.title}: ${stage.left.items.map((i) => i.text).join("; ")} | ${stage.right.title}: ${stage.right.items.map((i) => i.text).join("; ")}.`);
      break;
    case "scene":
      lines.push(`Scene: ${stage.items.map((i) => i.label ?? i.icon ?? i.id).join(", ")}.`);
      break;
  }
  if (spec.interaction?.kind === "try") {
    lines.push(`Try-it controls the student can move: ${spec.interaction.controls.map((c) => `${c.label} (${c.min}–${c.max}${c.unit ? ` ${c.unit}` : ""})`).join(", ")}. Task: ${spec.interaction.prompt}`);
  }
  if (spec.interaction?.kind === "quiz") lines.push(`Question for the student: ${spec.interaction.question} Options: ${spec.interaction.options.map((o) => `${o.text}${o.correct ? " (correct)" : ""}`).join(" / ")}`);
  if (spec.interaction?.kind === "draw") lines.push(`Drawing task for the student: ${spec.interaction.prompt} (correct: ${spec.interaction.expect})`);
  return lines.join("\n");
}
