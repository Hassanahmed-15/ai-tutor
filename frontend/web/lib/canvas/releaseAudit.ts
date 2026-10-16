import { graphIssues } from "./graphCheck";
import { layoutPanel } from "./layout";
import { layoutIssues } from "./layoutQa";
import { checkNumbers, numberIssuesText } from "./numberCheck";
import { predictionRevealIssues, quizMatchesPrediction } from "./predict";
import { quizIssues } from "./quizLint";
import { semanticBoardIssues } from "./semanticGate";
import { critiqueStudentBoard, labelTexts } from "./studentCritic";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";
import { vseprIssues } from "./vsepr";

export type BoardReleaseFinding = { gate: "semantic" | "student-view" | "numbers" | "molecule" | "prediction" | "graph" | "quiz" | "layout" | "atom-balance"; message: string };

/** One authoritative release audit, used for generated boards and deterministic fallbacks alike. */
export function auditBoardForRelease(spec: CanvasBoardSpec, beat: CanvasPlanBeat): BoardReleaseFinding[] {
  const findings: BoardReleaseFinding[] = [];
  const add = (gate: BoardReleaseFinding["gate"], messages: string[]) => messages.forEach((message) => findings.push({ gate, message }));
  add("semantic", semanticBoardIssues(spec, beat));
  add("student-view", critiqueStudentBoard(spec, beat).issues);
  const interactionText: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") interactionText.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(spec.interaction);
  const arithmetic = [...labelTexts(spec), ...interactionText].flatMap((text) => checkNumbers(text));
  if (arithmetic.length) add("numbers", [`wrong numbers on the board: ${numberIssuesText(arithmetic)}`]);
  if (spec.stage.kind === "molecule") add("molecule", vseprIssues(spec.stage));
  if (spec.stage.kind === "atom-map") add("atom-balance", atomMapIssues(spec.stage));
  add("prediction", predictionRevealIssues(spec, beat));
  if (beat.teachingCycle && spec.interaction?.kind === "quiz") {
    const sentences = beat.script.split(/(?<=[.!?۔؟])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
    const match = quizMatchesPrediction(spec.interaction.question, sentences[beat.teachingCycle.predict] ?? "");
    if (!match.ok) add("prediction", [match.why ?? "the quiz asks a different question from the spoken prediction"]);
  }
  if (spec.stage.kind === "graph") add("graph", graphIssues(spec.stage, spec.interaction?.kind === "try" ? Object.fromEntries(spec.interaction.controls.map((control) => [control.var, control.value])) : {}));
  add("quiz", quizIssues(spec.interaction, `${beat.title} ${beat.brief} ${beat.script}`));
  if (spec.stage.kind === "scene" || spec.stage.kind === "flow") add("layout", layoutIssues(layoutPanel(spec), spec));
  // A figure squeezed into the board until its words cannot be read (a balance diagram's cards came
  // out at about 7 px, audit 2026-10-17) fails the student view, so the writer shortens or cuts them.
  if (spec.stage.kind === "figure" || spec.stage.kind === "diagram") {
    const figure = layoutPanel(spec).marks.find((m) => m.type === "figure");
    if (figure && figure.type === "figure") {
      // Judged on the larger text (90th percentile): small tick numbers on an axis are fine; the words
      // that carry the idea are not (measured on the 2026-10-17 boards: 10.9 px unreadable, 11.9 px fine).
      const sizes = figure.drawing.shapes.filter((sh) => sh.t === "text").map((sh) => (sh as { size: number }).size * figure.scale).sort((a, b) => a - b);
      const main = sizes.length ? sizes[Math.floor(sizes.length * 0.9)] : Infinity;
      if (main < 11.5) add("student-view", [`the diagram's words render at ${main.toFixed(1)} px, too small to read: use fewer items and shorter wording so it can be drawn larger`]);
    }
  }
  return findings;
}

const numbersIn = (text: string) => new Set((text.replace(/(\d),(\d{3})/g, "$1$2").match(/-?\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n))));

/**
 * A chart drawn from numbers the narration never says contradicts it: a box plot showed median 4
 * while Aria taught 3, 5, 5, 7, 20 (audit 2026-10-17). A data figure with three or more numbers must
 * take most of them from what Aria says.
 */
export function figureDataIssues(spec: CanvasBoardSpec, script: string): string[] {
  if (spec.stage.kind !== "figure" || !spec.stage.params || spec.stage.component === "drawn" || spec.stage.component === "library") return [];
  const values = Object.entries(spec.stage.params).filter(([k]) => !/^(title|units?|label|caption)$/i.test(k)).map(([, v]) => String(v)).join(" ");
  const drawn = [...numbersIn(values)].filter((n) => Math.abs(Number(n)) > 1);
  if (drawn.length < 3) return [];
  const said = numbersIn(script);
  const missing = drawn.filter((n) => !said.has(n));
  return missing.length > drawn.length / 2 ? [`the figure is drawn from numbers the narration never says (${missing.slice(0, 6).join(", ")}): use the data and values Aria states in this board's script`] : [];
}

/**
 * An atom map is ONE balanced reaction. Boards drew complete and incomplete combustion together
 * ("C₃H₈ → 3CO₂, 4H₂O, 6CO, C") and bromination with chlorination (audit 2026-10-17): the atoms
 * did not balance, and the cards overflowed the board. Every element's total must be equal on both
 * sides, and each card is labelled with one formula as the equation writes it.
 */
export function atomMapIssues(stage: Extract<CanvasBoardSpec["stage"], { kind: "atom-map" }>): string[] {
  const total = (groups: typeof stage.reactants) => {
    const t = new Map<string, number>();
    for (const g of groups) for (const a of g.atoms) t.set(a.element, (t.get(a.element) ?? 0) + a.count);
    return t;
  };
  const left = total(stage.reactants);
  const right = total(stage.products);
  const issues: string[] = [];
  const unbalanced = [...new Set([...left.keys(), ...right.keys()])].filter((e) => (left.get(e) ?? 0) !== (right.get(e) ?? 0));
  if (unbalanced.length) issues.push(`the atoms do not balance (${unbalanced.map((e) => `${e}: ${left.get(e) ?? 0} → ${right.get(e) ?? 0}`).join(", ")}) — show ONE balanced reaction per board, every reactant and product of that equation and nothing else, each count the total atoms in that term (2H₂O → H×4, O×2)`);
  const badLabels = [...stage.reactants, ...stage.products].filter((g) => /[=:]/.test(g.label) || g.label.split(/\s+/).length > 3);
  if (badLabels.length) issues.push(`label each card with its formula exactly as the equation writes it ("3CO₂", "C₃H₈"), never a sum or a note: ${badLabels.map((g) => `"${g.label}"`).join(", ")}`);
  if (stage.reactants.length + stage.products.length > 6) issues.push("at most six terms in one atom map — a longer reaction is a worked equation board");
  return issues;
}
