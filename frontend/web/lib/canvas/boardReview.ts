import { describeSketch } from "./sketch";
import { describeSequence } from "./sequence";
import { describeGantt, describeMapping, describeMemory, describeStates } from "./osDiagrams";
import { describeStructure } from "./structure";
import { evalExpr } from "./expr";
import { layoutPanel } from "./layout";
import { figureComponent } from "../figures/registry";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";

/** Maths and statistics figures (they draw only what their parameters give). */
const MATHS_REVIEW_FIGURES = new Set(["argand", "areaModel", "bearings", "boxPlot", "circleTheorem", "coordinateGrid", "cumulativeFrequency", "dotPlot", "fractionModel", "functionGraph", "histogram", "inferenceDistribution", "logicCircuit", "numberLine", "parallelLines", "probabilityTree", "pythagorasProof", "pythagorasGarfield", "pythagorasSimilar", "pythagorasSquares", "riemannSum", "sectorArc", "sequences", "shapes3d", "slopeField", "triangle", "unitCircle", "vectors", "venn"]);

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
    case "sketch":
      lines.push(`Main visual: a board written and drawn live (a sketch board):\n${describeSketch(stage)}`);
      break;
    case "diagram": {
      lines.push(`Main visual: a vector textbook diagram (${stage.spec.base ?? "drawn"}).`);
      const figure = layoutPanel(spec).marks.find((m) => m.type === "figure");
      if (figure?.type === "figure") {
        const texts = figure.drawing.shapes.filter((s) => s.t === "text").map((s) => (s as { text: string }).text).filter(Boolean);
        if (texts.length) lines.push(`Words and numbers drawn inside the diagram: ${[...new Set(texts)].slice(0, 40).map((t) => `"${t}"`).join(", ")}`);
      }
      if (stage.parts.length) lines.push(`Labels pointing at parts: ${stage.parts.map((p) => `"${p.name}" → part ${p.id}`).join("; ")}`);
      break;
    }
    case "figure": {
      const component = stage.component === "library" || stage.component === "drawn" ? undefined : figureComponent(stage.component);
      // A maths figure is named, not given its catalogue title: "a coordinate grid … and a transformation
      // whose image A′B′C′ …" lists what the grid CAN draw, and a plain plot of P, Q and R was rejected
      // for a transformation and a line it never drew (maths benchmark, 2026-10-21).
      const mathsFigure = component && MATHS_REVIEW_FIGURES.has(component.name);
      const what = stage.asset ? `a textbook diagram (${stage.asset.credit})` : stage.component === "drawn" ? "a line diagram drawn from a description" : mathsFigure ? `a code-drawn figure, ${component.title.split(":")[0].trim().replace(/^(?:A|An|The) /, "").replace(/^\w/, (c) => c.toLowerCase())} — it shows only what the parameters and the drawn words below give, nothing else the component could draw` : `a code-drawn ${component?.title ?? stage.component}`;
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
      // A shape graph shows no numbers: the reviewer is shown its shape, which is all the student sees,
      // so a sketch of an enzyme's optimum is never rejected for coordinates nobody can read (2026-10-18).
      if (stage.qualitative) {
        lines.push(`Main visual: a SHAPE GRAPH with no numbers on either axis — x axis "${stage.x.label}", y axis "${stage.y.label}". Judge its shape and named points only; it shows no values.`);
        for (const curve of stage.curves) lines.push(`Curve "${curve.label ?? curve.id}": ${curveShape(curve.expr, stage.x.min, stage.x.max)}.`);
        for (const m of stage.markers ?? []) lines.push(`Named point "${m.label ?? m.id}" on ${m.curve}.`);
        for (const g of stage.guides ?? []) lines.push(`Marked line "${g.label}".`);
        break;
      }
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
      lines.push(`Main visual: ${stage.figure ? "working written line by line beside a figure" : "an equation, step by step"}: ${stage.steps.map((s) => `${s.order.map((id) => text.get(id)).join(" ")}${s.caption ? ` (${s.caption})` : ""}`).join("  ⟶  ")}`);
      // The figure the working is written beside is judged as a figure board's would be.
      if (stage.figure) lines.push(...boardFacts({ ...spec, notes: [], stage: stage.figure }).split("\n").slice(1).map((l) => l.replace(/^Main visual:/, "Beside the working:")));
      break;
    }
    case "scene":
      lines.push(`Main visual: icons and boxes: ${stage.items.map((i) => `"${i.label ?? i.icon ?? i.id}${i.detail ? ` — ${i.detail}` : ""}"`).join(", ")}`);
      break;
    case "illustration":
      lines.push(`Main visual: a generated picture of ${stage.subject}`, `Labels: ${stage.parts.filter((p) => !stage.labels.length || stage.labels.includes(p.id)).map((p) => `"${p.name}"`).join(", ")}`);
      break;
    case "code": {
      // What the student SEES as each sentence plays — the lines lit, the variables, the call stack,
      // the structure's changes and the output — so a reviewer can judge the sync, not only the listing.
      lines.push(`Main visual: ${stage.language} code (numbered):\n${stage.lines.map((l, i) => `${i + 1}| ${l}`).join("\n")}`);
      if (stage.structure) lines.push(`Beside the code: a ${stage.structure.variant ? `${stage.structure.variant} ` : ""}${stage.structure.kind} starting as ${stage.structure.nodes.map((n) => n.value).join(", ") || "empty"}.`);
      if (stage.steps.length) {
        lines.push("As Aria speaks:");
        for (const st of stage.steps) {
          const parts = [`sentence ${st.s}: lights line${st.lines.length === 1 ? "" : "s"} ${st.lines.join(", ")}`];
          if (st.note) parts.push(`note "${st.note}"`);
          if (st.state?.length) parts.push(`variables ${st.state.map((v) => `${v.name} = ${v.value}`).join(", ")}`);
          if (st.stack?.length) parts.push(`call stack ${st.stack.map((f) => `${f.call}${f.value ? ` (${f.value})` : ""}`).join(" → ")}`);
          if (st.ops?.length) parts.push(`structure: ${st.ops.map((o) => JSON.stringify(o)).join(", ")}`);
          lines.push(`- ${parts.join("; ")}`);
        }
      }
      if (stage.trace) lines.push(`Trace table (${stage.trace.vars.join(", ")}): ${stage.trace.rows.map((r) => `sentence ${r.s}: ${r.values.join(", ")}`).join(" | ")}`);
      if (stage.output) lines.push(`Output shown on sentence ${stage.output.s}: ${stage.output.text}`);
      break;
    }
    case "structure":
      // The CS examiner reads what each sentence changes on the structure (it saw nothing here before).
      lines.push(`Main visual: ${describeStructure(stage.structure, stage.steps)}`);
      if (stage.steps.length) {
        lines.push("As Aria speaks:");
        for (const st of stage.steps) {
          const parts = [`sentence ${st.s}`];
          if (st.ops?.length) parts.push(`structure: ${st.ops.map((o) => JSON.stringify(o)).join(", ")}`);
          if (st.note) parts.push(`note "${st.note}"`);
          if (st.state?.length) parts.push(`variables ${st.state.map((v) => `${v.name} = ${v.value}`).join(", ")}`);
          lines.push(`- ${parts.join("; ")}`);
        }
      }
      break;
    case "sequence":
      lines.push(`Main visual: ${describeSequence(stage)}`);
      break;
    case "states":
      lines.push(`Main visual: ${describeStates(stage)}`);
      break;
    case "memory":
      lines.push(`Main visual: ${describeMemory(stage)}`);
      break;
    case "gantt":
      lines.push(`Main visual: ${describeGantt(stage)}`);
      break;
    case "mapping":
      lines.push(`Main visual: ${describeMapping(stage)}`);
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

/** A curve's shape in words: "rises, then falls (peak about 60% of the way along)". */
export function curveShape(expr: string, min: number, max: number): string {
  const ys = Array.from({ length: 13 }, (_, i) => evalExpr(expr, { x: min + (i / 12) * (max - min) }, NaN));
  if (ys.some((y) => !Number.isFinite(y))) return "a curve";
  const span = Math.max(...ys) - Math.min(...ys) || 1;
  const moves: string[] = [];
  for (let i = 1; i < ys.length; i++) {
    const d = (ys[i] - ys[i - 1]) / span;
    const m = d > 0.02 ? "rises" : d < -0.02 ? "falls" : "levels off";
    if (moves[moves.length - 1] !== m) moves.push(m);
  }
  const peak = ys.indexOf(Math.max(...ys));
  const peaked = moves.includes("rises") && moves.includes("falls") && peak > 0 && peak < ys.length - 1;
  return `${moves.join(", then ")}${peaked ? ` (highest about ${Math.round((peak / 12) * 100)}% of the way along)` : ""}`;
}

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
