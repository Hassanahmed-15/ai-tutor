import type { CanvasBoardSpec, CodeStage, EquationStage, QuizInteraction } from "./types";

/**
 * PREDICT BEFORE THE REVEAL, FOR MATHS AND COMPUTER SCIENCE ONLY (owner, 2026-10-20, after the
 * Visuals Lab: mid-board prediction comes back for maths and CS boards; every other subject keeps
 * the end-of-board "Check it" card only).
 *
 * Built by code from what the board already holds — no model call, nothing invented:
 *   - a CODE board asks what a variable holds after the lines of one step run, using the step's own
 *     Variables-panel values (CodeStage.steps[].state);
 *   - an EQUATION board that solves for one unknown asks for the answer before its last line.
 *
 * `at` is the board sentence that REVEALS the answer: the lecture holds before that sentence plays,
 * the card asks, and the narration (the reveal) resumes when the student continues. Research basis:
 * answering during a visualisation beats watching it (Hundhausen et al. 2002; Naps et al.).
 */
export type PredictCard = { at: number; card: QuizInteraction };

/** Words that make a lecture maths (and not a physics or chemistry lecture that happens to use "="). */
const MATHS_WORDS = /\b(math(s|ematics)?|algebra\w*|equations?|solv\w+|simultaneous|quadratic\w*|linear|inequalit\w+|fractions?|indices|index laws?|surds?|logarithms?|exponent\w*|expand\w*|factori[sz]\w*|brackets?|formula(e|s)?|rearrang\w+|subject of|sequences?|series|arithmetic|geometric|percentages?|ratio|proportion|differentiat\w+|derivatives?|integrat\w+|calculus|gradient|trigonometr\w+|pythagoras|polynomials?|functions?|graphs? of|coordinates?|vectors?|matri(x|ces)|probability|statistics|mean|median|variance|binomial|algebraic|unknown|variable|complet\w+ the square|square roots?|theorems?|hypotenuse|right[- ]angled|proofs?|prov(?:e|es|ing)|pythagor\w*|expressions?|simplif\w+|substitut\w+|mensuration|area|volume|angles?|triangles?|circles?|averages?|complex numbers?|argand|venn|sets?|permutations?|combinations?|binomial|distributions?|standard deviation|hypothesis tests?|regression|correlation|primes?|factors?|multiples?|integers?|decimals?|number lines?|bearings?|loci|locus|transformations?|congruen\w+|similar(?:ity)? (?:shapes|triangles)|polygons?|quadrilaterals?|cuboids?|cylinders?|cones?|spheres?|surds?|standard form|ratios?|percentages?|inequality|matrices|determinants?|proof by induction|induction|sine|cosine|tangents?|sin|cos|tan|sohcahtoa|radians?|logs?|exponentials?|modulus|parametric|asymptotes?|turning points?|stationary points?|tangent to|normal to|differential equations?|numerical methods?|iteration|trapezium rule|binomial expansion|partial fractions)\b/i;
const OTHER_SCIENCE = /\b(chemi\w+|reaction|moles?|electrolys\w+|titration|enzyme|photosynth\w+|cell|organism|velocity|acceleration|momentum|force|newton|voltage|current|resistance|circuit|waves?|physics|oscillat\w*|energy|economics?|demand|supply)\b/i;

/** A lecture (by its topic) whose equation boards are maths. */
export function isMathsTopic(topic: string): boolean {
  const t = topic ?? "";
  if (!MATHS_WORDS.test(t)) return false;
  const maths = (t.match(new RegExp(MATHS_WORDS.source, "gi")) ?? []).length;
  const other = (t.match(new RegExp(OTHER_SCIENCE.source, "gi")) ?? []).length;
  // A tie goes to the other science: "balancing chemical equations" is chemistry.
  return maths > other;
}

/** The mid-board prediction for this board, or null when it is not a maths/CS board or nothing fits. */
export function predictCardFor(spec: CanvasBoardSpec | undefined, topic: string): PredictCard | null {
  if (!spec) return null;
  // A board that already asks the student something mid-board (a slider, a drawing) keeps its own task.
  if (spec.interaction && !(spec.interaction.kind === "quiz" && spec.interaction.check)) return null;
  if (spec.stage.kind === "code") return codePredict(spec.stage);
  if (spec.stage.kind === "equation" && isMathsTopic(`${topic} ${spec.heading}`)) return equationPredict(spec.stage);
  return null;
}

/* ── code boards ─────────────────────────────────────────────────────────────────────────── */

const SHORT = 14;
const clean = (v: string) => v.trim();
const asNumber = (v: string): number | undefined => (/^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : undefined);

function codePredict(stage: CodeStage): PredictCard | null {
  const steps = (stage.steps ?? []).filter((st) => Number.isFinite(st.s));
  if (steps.length < 3) return null;
  type Pick = { k: number; name: string; before: string; after: string; line: number };
  const picks: Pick[] = [];
  for (let k = 1; k < steps.length; k++) {
    const prev = new Map((steps[k - 1].state ?? []).map((v) => [v.name, clean(v.value)]));
    const now = steps[k];
    // The reveal must be its own sentence, after the one before it, never the board's first.
    if (now.s < 1 || now.s <= steps[k - 1].s || !now.lines?.length) continue;
    for (const v of now.state ?? []) {
      const before = prev.get(v.name);
      const after = clean(v.value);
      if (before === undefined || before === after || !after || after.length > SHORT || before.length > SHORT) continue;
      if (traceShowsEarly(stage, v.name, after, now.s)) continue;
      // Name the line that changes it (the assignment), not the first lit line (a loop's condition).
      const line = now.lines.find((n) => assigns(stage.lines[n - 1] ?? "", v.name)) ?? now.lines[now.lines.length - 1];
      picks.push({ k, name: v.name, before, after, line });
    }
  }
  if (!picks.length) return null;
  // A step in the middle of the walk-through: the student has seen the pattern once, not the end of it.
  const pick = picks[Math.min(picks.length - 1, Math.max(0, Math.floor(picks.length / 2)))];
  const seen = steps.flatMap((st) => (st.state ?? []).filter((v) => v.name === pick.name).map((v) => clean(v.value)));
  const options = optionValues(pick.after, pick.before, seen);
  if (options.length < 3) return null;
  const lineText = (stage.lines[pick.line - 1] ?? "").trim();
  const question = `Predict: after line ${pick.line}${lineText && lineText.length <= 40 ? ` (${lineText})` : ""} runs, what does ${pick.name} hold?`;
  const card: QuizInteraction = {
    kind: "quiz",
    check: true,
    mode: "choice",
    question,
    options: options.map((value) => ({
      text: value,
      correct: value === pick.after,
      feedback:
        value === pick.after
          ? `Yes. After line ${pick.line}, ${pick.name} is ${pick.after}.`
          : value === pick.before
            ? `That is what ${pick.name} held before. Line ${pick.line} changes it to ${pick.after}.`
            : `Not quite. After line ${pick.line}, ${pick.name} is ${pick.after}. Watch the Variables panel.`,
    })),
    hint: { text: `Look at line ${pick.line}, and what ${pick.name} holds just before it runs.`, target: `line-${pick.line}` },
  };
  return { at: steps[pick.k].s, card };
}

/** Does this line of code set `name`? ("x = …", "x += 1", "x ← …", "x++", "let x = …", "for x in …") */
function assigns(line: string, name: string): boolean {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s;(])(?:let |var |const |int |float |double |auto |for )?${n}\\s*(?:[-+*/%]?=(?!=)|←|:=|\\+\\+|--|\\s+in\\b)`).test(line);
}

/** The trace table already prints this value for this variable before the reveal: no prediction left. */
function traceShowsEarly(stage: CodeStage, name: string, value: string, at: number): boolean {
  const col = stage.trace?.vars.indexOf(name) ?? -1;
  if (col < 0) return false;
  return (stage.trace?.rows ?? []).some((r) => r.s < at && clean(r.values[col] ?? "") === value);
}

/** The right value, the value before, other values it takes, then near numbers: 3 or 4, shuffled by a fixed rule. */
function optionValues(right: string, before: string, seen: string[]): string[] {
  const out: string[] = [right];
  const push = (v: string | undefined) => {
    if (v === undefined) return;
    const t = clean(v);
    if (t && t.length <= SHORT && !out.includes(t) && out.length < 4) out.push(t);
  };
  push(before);
  for (const v of seen) push(v);
  const n = asNumber(right);
  if (n !== undefined) {
    const b = asNumber(before);
    if (b !== undefined && b !== n) push(String(n + (n - b)));
    push(String(n + 1));
    push(String(n - 1));
  }
  return order(out);
}

/** A fixed, answer-independent order (alphabetical / numeric) so the right answer is not always first. */
function order(values: string[]): string[] {
  return [...values].sort((a, b) => {
    const x = asNumber(a);
    const y = asNumber(b);
    return x !== undefined && y !== undefined ? x - y : a.localeCompare(b);
  });
}

/* ── equation boards ─────────────────────────────────────────────────────────────────────── */

function rowText(stage: EquationStage, order: string[]): string {
  const byId = new Map(stage.tokens.map((t) => [t.id, t]));
  return order
    .map((id) => byId.get(id)?.text ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "x = 4", "c = √100 = 10 cm": one letter, then (any working, then) "=" a number and an optional short unit. */
const SOLVED = /^([a-zA-Z])\s*=(?:.*=)?\s*(−|-)?\s*(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)\s*([a-zA-Z]{1,3}\d?)?$/;

function equationPredict(stage: EquationStage): PredictCard | null {
  const steps = stage.steps ?? [];
  if (steps.length < 2) return null;
  const last = steps[steps.length - 1];
  const prev = steps[steps.length - 2];
  if (last.s < 1 || last.s <= prev.s) return null;
  const m = SOLVED.exec(rowText(stage, last.order).replace(/−/g, "-"));
  if (!m) return null;
  const unknown = m[1];
  const negative = Boolean(m[2]);
  const value = m[3].replace(/\s+/g, "");
  const unit = m[4] ? ` ${m[4]}` : "";
  // A length or a count cannot be negative: the sign slip is no option there.
  const signless = Boolean(unit);
  const right = `${negative ? "−" : ""}${value}`;
  const flipped = negative ? value : `−${value}`;
  // "Stopped one step early": a number from the line before that is not the answer.
  const earlier = (rowText(stage, prev.order).match(/\d+(?:\.\d+)?/g) ?? []).filter((x) => x !== value);
  const options = signless ? [right] : [right, flipped];
  for (const x of earlier.reverse()) if (!options.includes(x) && options.length < 4) options.push(x);
  const n = Number(value);
  if (options.length < 3 && Number.isFinite(n)) options.push(String((negative ? -n : n) + 1).replace("-", "−"));
  if (options.length < 3) return null;
  const card: QuizInteraction = {
    kind: "quiz",
    check: true,
    mode: "choice",
    question: `Predict before the last line: what is ${unknown}?`,
    options: order(options.map((o) => o.replace("−", "-"))).map((o) => {
      const text = `${unknown} = ${o.replace("-", "−")}${unit}`;
      const correct = o.replace("-", "−") === right;
      return {
        text,
        correct,
        feedback: correct
          ? `Yes: ${unknown} = ${right}${unit}.`
          : o.replace("-", "−") === flipped
            ? `Check the sign. Working it through gives ${unknown} = ${right}${unit}.`
            : `Not quite. That number is from a step before the end. Working it through gives ${unknown} = ${right}${unit}.`,
      };
    }),
  };
  return { at: last.s, card };
}
