import { evalExpr } from "./expr";
import { layoutPanel } from "./layout";
import { figureComponent } from "../figures/registry";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";

/**
 * THE BOARD REVIEW: the last check before a board reaches a student.
 *
 * Three audits in a row (7.3, 7.2, 7.2) failed on what the student SEES, not on what the board spec
 * said: the right component on the wrong board, a box plot of numbers Aria never said, an invented
 * "nephron depth" graph, a calculation drawn as three empty circles, labels on the wrong parts. Rule
 * checks catch known shapes of mistake; each new lesson found a new one. So every board is described
 * exactly as it is DRAWN — the words and numbers inside a diagram (from the component's own build),
 * a graph's axes and the values its curves pass through, every box and card — and a reviewer judges
 * that against the narration with a fixed checklist. A board that fails is rewritten with the
 * reviewer's reasons; one that still fails gives way to the plain, always-correct backup board.
 *
 * The facts are built from the layout the student's screen uses (lib/canvas/layout.ts), so the
 * review sees the drawn result rather than the writer's intentions.
 */

const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 1 ? n.toFixed(2).replace(/\.?0+$/, "") : n.toPrecision(2));

/** What the board shows, in words: everything a student could read off it, and nothing else. */
export function boardFacts(spec: CanvasBoardSpec): string {
  const lines: string[] = [`Heading: "${spec.heading}"`];
  if (spec.notes.length) lines.push(`Notes written beside it: ${spec.notes.map((n) => `"${n.text}"`).join(", ")}`);
  const stage = spec.stage;
  switch (stage.kind) {
    case "figure": {
      const component = stage.component === "library" || stage.component === "drawn" ? undefined : figureComponent(stage.component);
      const what = stage.asset ? `a textbook diagram (${stage.asset.credit})` : stage.component === "drawn" ? "a line diagram drawn from a description" : `a code-drawn ${component?.title ?? stage.component}`;
      lines.push(`Main visual: ${what}.`);
      const figure = layoutPanel(spec).marks.find((m) => m.type === "figure");
      if (figure?.type === "figure") {
        const texts = figure.drawing.shapes.filter((s) => s.t === "text").map((s) => (s as { text: string }).text).filter(Boolean);
        if (texts.length) lines.push(`Words and numbers drawn inside the diagram: ${[...new Set(texts)].slice(0, 40).map((t) => `"${t}"`).join(", ")}`);
      }
      if (stage.parts.length) lines.push(`Labels pointing at parts: ${stage.parts.map((p) => `"${p.name}" → part ${p.id}`).join("; ")}`);
      const params = Object.entries(stage.params ?? {}).filter(([, v]) => v !== "" && v !== undefined);
      if (params.length && stage.component !== "library") lines.push(`The diagram was drawn from: ${params.map(([k, v]) => `${k} = ${String(v).slice(0, 160)}`).join("; ")}`);
      break;
    }
    case "graph": {
      lines.push(`Main visual: a graph. x axis "${stage.x.label}" from ${stage.x.min} to ${stage.x.max}; y axis "${stage.y.label}" from ${stage.y.min} to ${stage.y.max}.`);
      for (const curve of stage.curves) {
        const xs = [0, 0.25, 0.5, 0.75, 1].map((t) => stage.x.min + t * (stage.x.max - stage.x.min));
        const pts = xs.map((x) => { const y = evalExpr(curve.expr, { x }, NaN); return Number.isFinite(y) ? `(${fmt(x)}, ${fmt(y)})` : null; }).filter(Boolean);
        lines.push(`Curve "${curve.label ?? curve.id}" passes through ${pts.join(", ")}.`);
      }
      for (const m of stage.markers ?? []) lines.push(`Marked point "${m.label ?? m.id}" on ${m.curve} at x = ${m.x}.`);
      break;
    }
    case "flow":
      lines.push(`Main visual: a ${stage.arrangement} diagram of boxes joined by arrows.`);
      lines.push(`Boxes: ${stage.nodes.map((n) => `"${n.label}${n.sub ? ` — ${n.sub}` : ""}"`).join(", ")}`);
      if (stage.arrows.length) {
        const name = new Map(stage.nodes.map((n) => [n.id, n.label]));
        lines.push(`Arrows: ${stage.arrows.map((a) => `${name.get(a.from)} → ${name.get(a.to)}${a.label ? ` ("${a.label}")` : ""}`).join("; ")}`);
      }
      break;
    case "compare":
      lines.push(`Main visual: a two-column comparison table.`, `Left column "${stage.left.title}": ${stage.left.items.map((i) => `"${i.text}"`).join(", ")}`, `Right column "${stage.right.title}": ${stage.right.items.map((i) => `"${i.text}"`).join(", ")}`);
      break;
    case "equation": {
      const text = new Map(stage.tokens.map((t) => [t.id, t.text]));
      lines.push(`Main visual: an equation, step by step: ${stage.steps.map((s) => `${s.order.map((id) => text.get(id)).join(" ")}${s.caption ? ` (${s.caption})` : ""}`).join("  ⟶  ")}`);
      break;
    }
    case "scene":
      lines.push(`Main visual: icons and boxes: ${stage.items.map((i) => `"${i.label ?? i.icon ?? i.id}${i.detail ? ` — ${i.detail}` : ""}"`).join(", ")}`);
      break;
    case "illustration":
      lines.push(`Main visual: a generated picture of ${stage.subject}`, `Labels: ${stage.parts.filter((p) => !stage.labels.length || stage.labels.includes(p.id)).map((p) => `"${p.name}"`).join(", ")}`);
      break;
    case "code":
      lines.push(`Main visual: ${stage.language} code:\n${stage.lines.join("\n")}`);
      break;
    case "molecule":
      lines.push(`Main visual: 3-D molecules: ${stage.molecules.map((m) => `${m.label} (${m.geometry}${m.bondAngle ? `, ${m.bondAngle}` : ""})`).join("; ")}.`);
      break;
    case "atom-map":
      lines.push(`Main visual: an atom-count map from reactants to products.`);
      break;
    case "exam":
      lines.push(`Main visual: an exam question card (${stage.marks} marks, command word "${stage.commandWord}"): "${stage.question}"`, `Mark-scheme points ticked as Aria says them: ${stage.points.map((p) => `"${p.text}"`).join(", ")}`, ...(stage.lostMarks ? [`Warning note: "${stage.lostMarks.text}"`] : []));
      break;
  }
  // A try-it task is judged by what it COMPUTES: its readouts at the lowest, starting and highest
  // setting of each slider ("86 / trials" taught that relative frequency falls as trials rise,
  // audit 2026-10-17). The reviewer flags a model that contradicts the lesson as factually-wrong.
  if (spec.interaction?.kind === "try") {
    const task = spec.interaction;
    const at = (vars: Record<string, number>) => (task.readouts ?? []).map((r) => `${r.label} = ${Number(evalExpr(r.expr, vars).toPrecision(4))}${r.unit ? ` ${r.unit}` : ""}`).join(", ");
    const base = Object.fromEntries(task.controls.map((c) => [c.var, c.value]));
    const rows = task.controls.flatMap((c) => [c.min, c.value, c.max].map((v) => `${c.label} = ${v}: ${at({ ...base, [c.var]: v })}`));
    lines.push(`Try-it task: "${task.prompt}". What its readouts show as the student moves the slider: ${rows.join("; ")}. Fail it (factually-wrong) if these values contradict the idea the board teaches.`);
  }
  if (spec.interaction?.kind === "quiz") {
    // The card appears when Aria asks her prediction, BEFORE she reveals the answer; the "(marked
    // correct)" note is for the reviewer only (it rejected good cards as "giving the answer away").
    lines.push(`Quiz card, shown when Aria asks her prediction and BEFORE she reveals the answer (the student does not see which option is right): "${spec.interaction.question}" Options: ${spec.interaction.options.map((o) => `"${o.text}"${o.correct ? " [the right answer — marked for you only]" : ""}`).join(", ")}`);
  }
  return lines.join("\n");
}

export const BOARD_REVIEW_PROMPT = `You are the strict final reviewer of ONE board of a narrated school lesson, judging it as a demanding exam teacher would before a student sees it. You get what Aria SAYS over the board and an exact account of what the board SHOWS. Return JSON only: {"ship": boolean, "problems": [{"kind": "wrong-visual" | "contradicts-narration" | "invented-data" | "empty-or-trivial" | "mislabelled" | "factually-wrong" | "off-topic" | "quiz", "detail": string}]}.

Fail the board (ship false) only for a problem a student would be misled or short-changed by:
- wrong-visual: the main visual is not about what this board teaches (a membrane diagram on a board about which conditions the body keeps constant; a plasmid diagram on a board weighing risks).
- contradicts-narration: a number, value, label, direction or claim on the board disagrees with what Aria says (a box plot with median 4 while Aria's example has median 5).
- invented-data: a graph or chart shows quantities, axes or data that the narration never gives and that are not standard textbook facts (a "relative depth" graph for the parts of a nephron).
- empty-or-trivial: the visual carries no information beyond its titles (three boxes "Frequency table → Mean formula → Variance formula" with no table, formula or numbers on a calculation board).
- mislabelled: a label names the wrong part, or a part the narration teaches is missing its label.
- factually-wrong: anything on the board is false. Check every equation line as mathematics: each "=" must be true as written, with every factor, power and sign the narration gives ("ϕ(2r) = ϕ(r)" for "doubling the distance halves the potential" is false — it must be "ϕ(2r) = ϕ(r)/2").
- off-topic: the board teaches something outside the lesson's topic.
- quiz: the card is ambiguous, has no single right answer, or its wording itself gives the right option away (one option far longer or more detailed than the rest), or a wrong option no student would ever choose ("Oxygen stops existing"). The card is answered before Aria reveals the answer, so the narration revealing it later is correct, never a giveaway.
Do not fail a board for style, for being simple, or for leaving out detail the narration does not mention. Each detail names the exact text on the board that is wrong and what it should be instead.`;

export function boardReviewRequest(spec: CanvasBoardSpec, beat: Pick<CanvasPlanBeat, "title" | "script">, lessonTopic: string): string {
  return `Lesson: ${lessonTopic}\nBoard: ${beat.title}\n\nWHAT ARIA SAYS:\n${beat.script}\n\nWHAT THE BOARD SHOWS:\n${boardFacts(spec)}`;
}

export type BoardReview = { ship: boolean; problems: Array<{ kind: string; detail: string }> };

export function parseBoardReview(raw: unknown): BoardReview {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const problems = (Array.isArray(r.problems) ? r.problems : [])
    .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>) : {}))
    .map((p) => ({ kind: String(p.kind ?? "problem").slice(0, 40), detail: String(p.detail ?? "").slice(0, 400) }))
    .filter((p) => p.detail);
  // A verdict that names no concrete problem cannot hold a board back.
  return { ship: r.ship !== false || !problems.length, problems };
}
