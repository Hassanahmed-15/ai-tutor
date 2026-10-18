/**
 * WHAT ARIA SAYS IS WHAT THE BOARD WRITES (owner's report, 2026-10-16: "Aria says the full equation
 * but that equation is not shown on the screen").
 *
 * An equation board was checked only for being drawable. A term longer than 18 characters was cut
 * ("(5a − 2a) + (3b + "), and nothing compared the board with the narration, so Aria could say
 * "(5a − 2a) + (3b + 4b) = 3a + 7b" over a board that never wrote it. This finds what is wrong with
 * an equation board, as one sentence the board's model is shown when it is asked to try again.
 * Pure, so it is unit-tested directly.
 */

import { texError } from "../equationSpec";
import { canvasSentences } from "./plan";
import type { EquationStage } from "./types";
import { EQ_TOKEN_MAX } from "./validate";

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const SUPERSCRIPT: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };
const SUBSCRIPT: Record<string, string> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" };

/** Maths written two ways compared as one: spaces gone, every minus one minus, x² as x^2. */
export function normalizeMath(s: string): string {
  return s
    .toLowerCase()
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => `^${[...m].map((c) => SUPERSCRIPT[c]).join("")}`)
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (c) => SUBSCRIPT[c])
    .replace(/\^\{(\w+)\}/g, "^$1")
    .replace(/[−–—]/g, "-")
    .replace(/[×·∙⋅]|\\times|\\cdot/g, "*")
    .replace(/÷/g, "/")
    .replace(/[[\]{}]/g, (c) => (c === "[" || c === "{" ? "(" : ")"))
    .replace(/\s+/g, "");
}

/** A chunk of a spoken sentence that is maths: has a digit, an operator, a bracket or a power, or is one letter. */
const mathy = (chunk: string) => /[0-9²³⁴()[\]+\-−–×÷·/=^]/.test(chunk) || /^[a-z]$/i.test(chunk.replace(/[.,;:!?]+$/, ""));

/**
 * The equations a script says, as written in it: runs of maths around an "=", long enough to be
 * worth writing ("(5a − 2a) + (3b + 4b) = 3a + 7b", "4(2x − 3) = 8x − 12" — not "U = ax").
 */
export function spokenEquations(script: string): Array<{ sentence: number; text: string }> {
  const out: Array<{ sentence: number; text: string }> = [];
  canvasSentences(script).forEach((sentence, index) => {
    const chunks = sentence.split(/\s+/);
    let run: string[] = [];
    const flush = () => {
      const text = run.join(" ").replace(/^[:;,]+|[.,;:!?]+$/g, "").trim();
      run = [];
      const n = normalizeMath(text);
      // An equation: an "=", a side with an operator or bracket, and long enough to be one.
      if (n.includes("=") && /[-+*/()^]/.test(n) && n.length >= 8 && !out.some((o) => normalizeMath(o.text) === n)) out.push({ sentence: index, text });
    };
    for (const chunk of chunks) {
      // A colon ends what came before it ("group matching terms: (5a − 2a) …").
      if (/:$/.test(chunk)) {
        flush();
        continue;
      }
      if (mathy(chunk)) run.push(chunk);
      else flush();
      if (/[,;]$/.test(chunk)) flush();
    }
    flush();
  });
  return out;
}

/**
 * Why an equation board does not show what it must, or null. `raw` is the model's stage as written
 * (to catch what validation would otherwise have to cut); `stage` is the validated one.
 */
export function equationProblem(raw: unknown, stage: EquationStage, script: string): string | null {
  const r = obj(raw);
  for (const t of arr(r.tokens).map(obj)) {
    const text = typeof t.text === "string" ? t.text.trim() : "";
    if (text.length > EQ_TOKEN_MAX) return `the term "${text.slice(0, 30)}…" is ${text.length} characters: split it into smaller terms (each at most ${EQ_TOKEN_MAX}), one token per term, bracket group or sign`;
    if (typeof t.tex === "string" && t.tex.trim()) {
      const error = texError(t.tex.trim());
      if (error && !stage.tokens.some((k) => k.id === String(t.id) && k.tex)) return `the "tex" of "${text || String(t.id)}" does not typeset in KaTeX (${error.slice(0, 90)}): write plain LaTeX like "\\\\frac{x}{3}" or "x^2 + 6x + 9", with every backslash doubled in the JSON`;
    }
  }
  const ids = new Set(stage.tokens.map((t) => t.id));
  for (const [i, step] of arr(r.steps).map(obj).entries()) {
    const unknown = arr(step.order).map(String).find((id) => !ids.has(id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")));
    if (unknown) return `step ${i + 1} writes "${unknown}", which is not one of the tokens: every id in "order" must be a token's id`;
  }
  // Every term carries its LaTeX; a word written small over the arrow ("light", "heat") need not.
  const bare = stage.tokens.find((t) => !t.tex && !t.on && /[0-9a-z]/i.test(t.text));
  if (bare) return `the term "${bare.text}" has no "tex": every term of the maths carries its LaTeX ("tex"), so it is typeset properly`;
  // Maths, not sentences: a term that is words ("unknown rightward = known leftward", "horizontal:
  // right +") and a row that sets values side by side with nothing between them ("ΣFx 0 ΣFy 0",
  // "12 N 9 N") read as word salad on a forces board (live test, 2026-10-17).
  // A word equation's terms ("Expected frequency", "Net radiation") are fine; a sentence is not.
  const words = (t: string) => (t.match(/[A-Za-z]{3,}/g) ?? []).filter((w) => !/^(sin|cos|tan|log|exp|lim|max|min|mod|arg|det)$/i.test(w)).length;
  const prose = stage.tokens.find((t) => !t.on && (words(t.text) >= 5 || (words(t.text) >= 1 && /:/.test(t.text)) || (words(t.text) >= 2 && /[=≈<>]/.test(t.text))));
  if (prose) return `the term "${prose.text}" is words, not maths: keep the equation to symbols, numbers and units, and say or caption the words instead`;
  const op = /^[\s=≠≈<>≤≥+\-−–×÷·*/→⇒⇌±^(){}[\],;:]*$/;
  const endsOpen = /[=≠≈<>≤≥+\-−–×÷·*/→⇒(\[,]\s*$/;
  const startsOpen = /^\s*[=≠≈<>≤≥+\-−–×÷·*/→⇒)\],^]/;
  const termOf = new Map(stage.tokens.filter((t) => !t.on).map((t) => [t.id, t.text.trim()]));
  for (const [i, st] of stage.steps.entries()) {
    const row = st.order.map((id) => termOf.get(id)).filter((t): t is string => t !== undefined && t !== "");
    for (let k = 1; k < row.length; k++) {
      const a = row[k - 1], b = row[k];
      if (op.test(a) || op.test(b) || endsOpen.test(a) || startsOpen.test(b)) continue;
      // A coefficient and what it multiplies ("2", "x" or "3", "(x + 1)") are one product.
      if (/^[\d.]+$/.test(a) && (/^[a-zα-ω]$/i.test(b) || b.startsWith("("))) continue;
      return `step ${i + 1} writes "${a}" then "${b}" with nothing between them: put the relation or operator (=, +, ×) between them as its own term, or write them in separate steps`;
    }
  }
  // Every equation the narration says is written, whole, by one step.
  const text = new Map(stage.tokens.filter((t) => !t.on).map((t) => [t.id, t.text]));
  const written = stage.steps.map((st) => normalizeMath(st.order.map((id) => text.get(id) ?? "").join("")));
  for (const eq of spokenEquations(script)) {
    const want = normalizeMath(eq.text);
    if (!written.some((w) => w.includes(want))) {
      return `the narration says "${eq.text}" (sentence ${eq.sentence}) but no step writes it whole: give a step on sentence ${eq.sentence} an "order" that writes exactly that, both sides of the "="`;
    }
  }
  return null;
}
