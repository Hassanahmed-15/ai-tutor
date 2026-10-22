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

import { evalExpr } from "./expr";
import { texError } from "../equationSpec";
import { canvasSentences } from "./plan";
import type { EquationStage } from "./types";
import { EQ_TOKEN_MAX } from "./validate";
import { checkNumbers, toExpr } from "./numberCheck";
import { hasTopLevelSum } from "./equationRepair";

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

import { SUBSCRIPT, SUPERSCRIPT } from "./mathChars";
export { SUBSCRIPT, SUPERSCRIPT };
const SUPER_RUN = new RegExp(`[${Object.keys(SUPERSCRIPT).join("")}]+`, "g");
const SUB_ONE = new RegExp(`[${Object.keys(SUBSCRIPT).join("")}]`, "g");

/** Maths written two ways compared as one: spaces gone, every minus one minus, x² as x^2. */
export function normalizeMath(s: string): string {
  return s
    .toLowerCase()
    .replace(SUPER_RUN, (m) => { const e = [...m].map((c) => SUPERSCRIPT[c]).join(""); return /^\d+$/.test(e) ? `^${e}` : `^(${e})`; })
    .replace(SUB_ONE, (c) => SUBSCRIPT[c])
    .replace(/\^\{(\w+)\}/g, "^$1")
    .replace(/[−–—]/g, "-")
    .replace(/[×·∙⋅]|\\times|\\cdot/g, "*")
    .replace(/÷/g, "/")
    .replace(/[[\]{}]/g, (c) => (c === "[" || c === "{" ? "(" : ")"))
    .replace(/\s+/g, "")
    // "lim h→0", "lim(h→0)", "lim_(h→0)" and "\lim_(h\to0)" are the same limit.
    .replace(/\\to/g, "→")
    .replace(/log_/g, "log")
    .replace(/\\?lim_?\(([a-z]→[^()]+)\)/g, "lim$1")
    // "6 × sin 72°" and "6 sin 72°" are the same product; so are "(x − 2) × (x − 3)" and "(x − 2)(x − 3)".
    .replace(/(\d)\*(?=[a-z(√])/g, "$1")
    .replace(/\)\*(?=[(a-z])/g, ")");
}

/**
 * MATHS SAID IN WORDS, AS SYMBOLS. A narration reads its working aloud ("b equals 6 sine 72 degrees
 * divided by sine 35 degrees"); read as words, no check saw it — a board stopped at "b = 6 × sin 72°"
 * (5.71, not 9.95) and the answer was never written (maths benchmark, 2026-10-21).
 */
export function spokenMaths(text: string): string {
  return text
    .replace(/\bis equal to\b/gi, "=")
    .replace(/\bequals\b/gi, "=")
    .replace(/\bdivided by\b/gi, "÷")
    .replace(/\bmultiplied by\b/gi, "×")
    .replace(/(\d)\s+times\s+(?=[\d(a-z√])/gi, "$1 × ")
    .replace(/\bplus\b/gi, "+")
    .replace(/\bminus\b/gi, "−")
    .replace(/\s+squared\b/gi, "²")
    .replace(/\s+cubed\b/gi, "³")
    .replace(/\b(?:the )?square root of\s+/gi, "√")
    // "angle ACB equals 90 degrees" is ∠ACB = 90° (maths benchmark round 1: the proof's result was
    // never written, because "angle ACB" was not read as maths).
    .replace(/\bangle\s+([A-Z]{3})\b/g, "∠$1")
    .replace(/(\d+|\b[a-zA-Z]|\))\s+factorial\b/g, "$1!")
    .replace(/\bsine\b/gi, "sin")
    .replace(/\bcosine\b/gi, "cos")
    .replace(/(\d+(?:\.\d+)?)\s*degrees?\b/gi, "$1°")
    .replace(/(\d+(?:\.\d+)?)\s*(?:centimet(?:re|er)s?)\b/gi, "$1 cm")
    .replace(/(\d+(?:\.\d+)?)\s*(?:millimet(?:re|er)s?)\b/gi, "$1 mm")
    .replace(/(\d+(?:\.\d+)?)\s*(?:met(?:re|er)s?)\b/gi, "$1 m")
    // "log base 5 of 25²" is log₅(25²); "the natural log of x" is ln(x) — read as words they cut an
    // equation to "25² = 2 log" (maths benchmark R6).
    .replace(/\blog(?:arithm)? (?:to )?base (\w+) of ([\w.]+[²³]?)/gi, "log_$1($2)")
    .replace(/\b(?:the )?natural log(?:arithm)? of ([\w.]+[²³]?)/gi, "ln($1)");
}

/** A chunk of a spoken sentence that is maths: has a digit, an operator, a bracket or a power, or is one letter. */
// "lim", "→", "∞", "∫", "Σ": "f′(x) = lim h→0 [f(x + h) − f(x)] ÷ h" was not read as an equation at all,
// so the definition of the derivative was never required on the board; "…" cut "S = a + (a + d) + … + l"
// to "S = a + (a + d) +" (maths benchmark, 2026-10-21).
// Round 1 (2026-10-21): "S₂₀", "θ", "∠ACB", "sin" and "cos" as words broke runs, so "S₂₀ = 20(6 + 82) ÷ 2"
// was read as "= 20(6 + 82) ÷ 2" and "sin θ = 3/5" as "θ = 3/5".
const SUPER_ANY = new RegExp(`[${Object.keys(SUPERSCRIPT).join("")}]`);
const mathy = (chunk: string) => {
  const c = chunk.replace(/[.,;:!?]+$/, "");
  return /[0-9²³⁴()[\]+\-−–×÷·/=^±∓√π°≈→∞∫Σ…⋯∠∣|]/.test(chunk) || SUPER_ANY.test(c) || /[₀-₉ₐ-ₜᵢ-ᵥ]/.test(c)
    || /^(?:[a-zα-ωΑ-Ω]|sin|cos|tan|sec|cosec|csc|cot|arcsin|arccos|arctan|log|ln|lim|sqrt|exp|log_?[a-z0-9₀-₉]+)$/i.test(c)
    // Point and angle names in capitals ("AB", "ACB"), never a capitalised word.
    || /^[A-Z]{2,3}$/.test(c);
};

/**
 * The equations a script says, as written in it: runs of maths around an "=", long enough to be
 * worth writing ("(5a − 2a) + (3b + 4b) = 3a + 7b", "4(2x − 3) = 8x − 12" — not "U = ax").
 */
export function spokenEquations(script: string): Array<{ sentence: number; text: string }> {
  const out: Array<{ sentence: number; text: string }> = [];
  canvasSentences(script).forEach((said, index) => {
    const sentence = spokenMaths(said);
    const chunks = sentence.split(/\s+/);
    let run: string[] = [];
    let before = "";
    // Inside a condition ("when a = 5, A = 30° and B = 45°") until a word that reaches a result.
    let conditional = false;
    const flush = () => {
      // A run that opens on "=" lost its left side to words ("the area = 6 × 4 = 24"): the calculation
      // after it is still an equation, but a line never starts with "=".
      const text = run.join(" ").replace(/^[:;,]+|[.,;:!?]+$/g, "").trim().replace(/^[=≈]\s*/, "");
      run = [];
      const n = normalizeMath(text);
      // An equation: an "=", a side with an operator or bracket, and long enough to be one — or a
      // result, a letter equal to a number ("x = 1/2"), which the board must show as the answer. A
      // value after "from", "to", "at" or "when" is a condition, not a result: "from x = 1 to x = 3"
      // was written onto the working as ", x = 1" (maths benchmark, 2026-10-21).
      const condition = conditional || /^(?:from|to|at|when|where|for|between|if|with|until)$/i.test(before);
      // A result stated as approximate ("B = sin⁻¹(5 ÷ 14) ≈ 20.9°") is a result too.
      const value = n.replace(/≈/g, "=");
      const result = !condition && /^(?:[a-zα-ω]\d{0,3}|∠[a-z]{2,3}|(?:sin|cos|tan)[a-zα-ω])=(?:.*=)?[-±]?[\d.]+(\/[\d.]+)?(cm|mm|m|km|kg|g|s|°)?$/.test(value);
      // Short ones count ("x + y = 90°", "2x + 2y = 180°" — the proof's result was skipped at 7 characters).
      const m = normalizeMath(text);
      if (/[=≈]/.test(m) && !/^[=≈]|[=≈]$/.test(m) && (result || (/[-+*/()^]/.test(m) && m.length >= 6)) && !out.some((o) => normalizeMath(o.text) === m)) out.push({ sentence: index, text });
    };
    chunks.forEach((chunk, k) => {
      // A colon ends what came before it ("group matching terms: (5a − 2a) …") — after its own maths
      // ("substitute into a² + b² = c²:" kept its "c²").
      if (/:$/.test(chunk)) {
        if (mathy(chunk.slice(0, -1))) run.push(chunk.slice(0, -1));
        flush();
        return;
      }
      // Words inside an open bracket belong to it: "P(A and defect) = 0.6 × 0.02" was cut at "and",
      // and the board was given "defect) = 0.6 × 0.02" (maths benchmark, 2026-10-21).
      const open = run.join(" ").split("(").length - run.join(" ").split(")").length;
      const inEquation = run.some((r) => /[=≈]/.test(r));
      // "cos θ = 4/5 or −4/5": a second value of the same answer stays on its line; "c = 10 cm" keeps its unit.
      const alsoValue = inEquation && /^(?:or|and)$/i.test(chunk) && /^[-−±]?\d+(?:[./]\d+)?°?[.,;]?$/.test(chunks[k + 1] ?? "") && !/^[=≈+\-−×÷*/^]/.test(chunks[k + 2] ?? "");
      const unit = /\d$/.test(run[run.length - 1] ?? "") && /^(?:cm|mm|m|km|kg|g|s|ml|l|cm²|m²|cm³|m³)[.,;]?$/.test(chunk);
      // "6 choose 2" is one term (the board writes it as a binomial coefficient).
      const choose = /^choose$/i.test(chunk) && run.length > 0 && mathy(chunks[k + 1] ?? "");
      if (mathy(chunk) || alsoValue || unit || choose || (open > 0 && run.length < 8)) run.push(chunk);
      else {
        flush();
        before = chunk.replace(/[.,;:!?]+$/, "");
        // "substitute a = 7, l = 43 and n = 10 into S = n(a + l) ÷ 2": the values put in are inputs, not answers.
        if (/^(?:when|if|with|given|suppose|let|for|where|substitute|substituting|substitutes|put|putting|plug|plugging|insert|inserting)$/i.test(before)) conditional = true;
        else if (/^(?:so|therefore|thus|hence|gives?|giving|get|gets|obtain|find|finds|use|using|becomes?|is|are|equals?)$/i.test(before)) conditional = false;
      }
      if (/[,;]$/.test(chunk) && run.join(" ").split("(").length <= run.join(" ").split(")").length) flush();
    });
    flush();
  });
  return out;
}

/**
 * Is a spoken equation on the board? Whole, inside a written line — or, for a result ("x = −1/3"),
 * as one of the values a line gives that letter ("x = 1, −1/3").
 */
export function spokenIsWritten(eqText: string, written: string[]): boolean {
  const want = normalizeMath(eqText);
  if (written.some((w) => w.includes(want))) return true;
  // "b = 12 cm" said over "b = 12" written is written (it was added again; maths benchmark round 2).
  const noUnit = want.replace(/(\d)(?:cm|mm|km|kg|m|g|s|ml|l)(\^?[23])?$/, "$1");
  if (noUnit !== want && written.some((w) => new RegExp(`${noUnit.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![\\d.])`).test(w))) return true;
  const m = /^([a-z][0-9]?)=(-?[\d.]+(?:\/[\d.]+)?)$/.exec(want);
  if (!m) return false;
  const value = new RegExp(`[=,]${m[2].replace(/[./]/g, "\\$&")}(?![\\d.])`);
  return written.some((w) => w.includes(`${m[1]}=`) && value.test(w));
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
  // Two operators in a row ("12 + = 7") is a broken line, not maths ("= −3" is a sign, and fine).
  const textOf = new Map(stage.tokens.map((t) => [t.id, t.text.trim()]));
  for (const [i, st] of stage.steps.entries()) {
    const row = st.order.map((id) => textOf.get(id) ?? "").filter(Boolean);
    for (let k = 1; k < row.length; k++) {
      const a = row[k - 1], b = row[k];
      if (/^[+×÷=*/]$/.test(a) && /^[+×÷=*/]$/.test(b)) return `step ${i + 1} writes "${a} ${b}" — two operators side by side: every operator sits between two terms (repeat a term with its own token id if the line needs it twice)`;
    }
  }
  // Arithmetic on a line is checked like any label's: "3 + 16 = 25" (meant 9 + 16) went out on a
  // Pythagoras board because equation lines were never put through numberCheck (QA 2026-10-21).
  for (const [i, st] of stage.steps.entries()) {
    const line = st.order.map((id) => textOf.get(id) ?? "").filter(Boolean).join(" ");
    const wrong = checkNumbers(line)[0];
    if (wrong) return `step ${i + 1} writes "${line}", but ${wrong.calculation.replace(/\s*=[^=]*$/, "")} is ${wrong.computed}, not ${wrong.stated}: every "=" in a line must join equal values (put a separate calculation on its own line, never chain "2 × 3 = 6 + 1 = 7"), and every number must be exactly right ("3² + 4² = 9 + 16 = 25")`;
  }
  // A sum divided needs brackets: "x = −b ± √(b² − 4ac) ÷ 2a" is not the quadratic formula.
  for (const [i, st] of stage.steps.entries()) {
    const texts = st.order.map((id) => textOf.get(id) ?? "").filter(Boolean);
    let depth = 0, additive = false, start = 0;
    for (let k = 0; k < texts.length; k++) {
      const t = texts[k];
      if (depth === 0 && /^(?:=|≠|≈|,|or|and|so)$/.test(t)) { additive = false; start = k + 1; continue; }
      // Only a "±" sum is a fraction's numerator by convention (the quadratic formula): "1 + nx +
      // n(n − 1)x² ÷ 2!" divides only its last term, correctly — flagging it pushed the writer to bracket
      // the binomial theorem into a false line (maths benchmark round 4).
      if (depth === 0 && (/^[±∓]$/.test(t) || (/[±∓]/.test(t) && hasTopLevelSum(t)))) additive = true;
      if (depth === 0 && t === "÷" && additive) return `step ${i + 1} writes "${texts.join(" ")}", which divides only the last term: a sum or difference divided needs brackets round it, or better one fraction token — tex "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" for the quadratic formula`;
      depth += (t.match(/[([{]/g)?.length ?? 0) - (t.match(/[)\]}]/g)?.length ?? 0);
    }
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
      // A joining word between two results is maths as it is written: "x = 2 or x = 3".
      if (/^(?:or|and|so|gives|then|giving|therefore|hence)$/i.test(a) || /^(?:or|and|so|gives|then|giving|therefore|hence)$/i.test(b)) continue;
      // A coefficient and what it multiplies ("2", "x" or "3", "(x + 1)") are one product.
      if (/^[\d.]+$/.test(a) && (/^[a-zα-ω]$/i.test(b) || b.startsWith("("))) continue;
      return `step ${i + 1} writes "${a}" then "${b}" with nothing between them: put the relation or operator (=, +, ×) between them as its own term, or write them in separate steps`;
    }
  }
  // Every equation the narration says is written, whole, by one step.
  const text = new Map(stage.tokens.filter((t) => !t.on).map((t) => [t.id, t.text]));
  const written = stage.steps.map((st) => normalizeMath(st.order.map((id) => text.get(id) ?? "").join("")));
  for (const eq of spokenEquations(script)) {
    if (!spokenIsWritten(eq.text, written)) {
      return `the narration says "${eq.text}" (sentence ${eq.sentence}) but no step writes it whole: give a step on sentence ${eq.sentence} an "order" that writes exactly that, both sides of the "="`;
    }
  }
  // The lecture's own answer must make every line of its working true.
  const wrong = solutionContradictions(stage, script);
  if (wrong.length) return `wrong working: ${wrong.join("; ")} — every line must stay true for the answer the narration reaches; fix or remove those lines`;
  return null;
}

/**
 * THE ANSWER MUST SATISFY THE WORKING (QA batch 4, 2026-10-21: a substitution board wrote
 * "x = 2x + 1" and "y = 10" while its narration solved x = 3, y = 7). The narration's final values
 * ("x = 3", "y = 7") are put into every equation the board writes using only those letters; a line
 * that comes out false is wrong maths. Lines with other letters, and boards that state no values, are
 * left alone — nothing correct is ever flagged.
 */
export function solutionContradictions(stage: EquationStage, script: string): string[] {
  return [...new Set(falseClauses(stage, script).map((f) => f.message))];
}

/** Each line of working the narration's answer makes false: its step, the clause, and why. */
export function falseClauses(stage: EquationStage, script: string): Array<{ step: number; clause: string; message: string }> {
  const norm = (s: string) => s.replace(/[−–]/g, "-").replace(/×/g, "*").replace(/÷/g, "/").replace(/²/g, "^2").replace(/³/g, "^3");
  // The values the narration settles on: the LAST "x = 3" for each single letter.
  const values: Record<string, number> = {};
  const seen: Record<string, Set<number>> = {};
  // How precisely each was said: "b = 9.95" (to 3 s.f.) is right for 9.9494….
  const halfUnit: Record<string, number> = {};
  const UNIT = "(?:\\s*(?:cm|mm|km|m|kg|g|s|°))?";
  // A value counts only when the letter stands alone at the start of a statement ("so x = 3",
  // "y = 2(3) + 1 = 7" → 7), never a letter inside a sum ("2x + y = 11" says nothing about y).
  const add = (letter: string, value: number, said = "") => {
    (seen[letter] ??= new Set()).add(value);
    const d = /\.(\d+)/.exec(said)?.[1].length ?? 0;
    if (d) halfUnit[letter] = 0.5 * 10 ** -d;
  };
  for (const clause of norm(spokenMaths(script)).split(/(?:[.;:,]\s+|\b(?:so|and|or|gives|giving|then|get|is|that|therefore|hence)\s+)/i)) {
    // "The two roots are x = 1": a letter = number after ordinary words counts as a value too — never
    // after an operator ("2x + y = 11" says nothing about y). Without it x = 1 was missed, x seemed to
    // have one value (−1/3), and the correct line "x = 1" was called wrong (maths benchmark).
    const plain = clause.trim().replace(/[.!?]+$/, "");
    const inside = new RegExp(`^(.*?[A-Za-z]{2,}\\s+)([a-z])\\s*=\\s*(-?\\d+(?:\\.\\d+)?)(?:\\/(\\d+(?:\\.\\d+)?))?${UNIT}(?:\\s+to\\s.*)?\\s*$`).exec(plain);
    if (inside && !/[=+\-*/^(]\s*$/.test(inside[1])) {
      add(inside[2], inside[4] ? Number(inside[3]) / Number(inside[4]) : Number(inside[3]), inside[4] ? "" : inside[3]);
      continue;
    }
    const m = /^\s*([a-z])\s*=\s*([^=]*?(?:=\s*[^=]*?)*)\s*$/.exec(plain);
    if (!m) continue;
    const last = (m[2].split("=").map((x) => x.trim()).pop() ?? "").replace(new RegExp(`${UNIT}(?:\\s+to\\s.*)?$`), "").trim();
    // A fraction is a value too ("x = 1/2" — read as nothing, x seemed to have one answer, −3).
    const frac = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(last);
    if (frac) add(m[1], Number(frac[1]) / Number(frac[2]));
    else if (/^-?\d+(?:\.\d+)?$/.test(last)) add(m[1], Number(last), last);
  }
  // A letter with two values ("x = 2 or x = 3", the roots of a quadratic) is not one answer: left out.
  for (const [k, set] of Object.entries(seen)) if (set.size === 1) values[k] = [...set][0];
  const known = Object.keys(values);
  if (!known.length) return [];
  const textOf = new Map(stage.tokens.map((t) => [t.id, t.text.trim()]));
  const asExpr = (side: string) => {
    let e = norm(side).replace(/\s+/g, "");
    for (let i = 0; i < 2; i++) e = e.replace(/(\d|\))([a-z(])/g, "$1*$2").replace(/([a-z])(\(|\d)/g, "$1*$2").replace(/\)\(/g, ")*(");
    return e;
  };
  const issues: Array<{ step: number; clause: string; message: string }> = [];
  for (const [stepIndex, st] of stage.steps.entries()) {
    const row = st.order.map((id) => textOf.get(id) ?? "").join(" ");
    for (const clause of row.split(/\s*(?:,|;|\band\b|\bor\b|\bso\b|\bthen\b|\btherefore\b|\bgives\b)\s*/)) {
      const sides = clause.split(/=/).map((x) => x.trim()).filter(Boolean);
      if (sides.length < 2) continue;
      // Function names and units are not unknowns ("b = 6 × sin 72° ÷ sin 35°").
      const letters = new Set((clause.replace(/\b(?:sin|cos|tan|sqrt|ln|log|pi|cm|mm|km|kg)\b/g, "").match(/[a-zA-Z]+/g) ?? []));
      if (!letters.size || ![...letters].every((l) => l.length === 1 && known.includes(l))) continue;
      const evalSide = (side: string) => {
        const exact = evalExpr(toExpr(side.replace(/\b(?:cm|mm|km|kg)\b/g, "")), values);
        return Number.isFinite(exact) ? exact : evalExpr(asExpr(side), values);
      };
      const vals = sides.map(evalSide);
      if (vals.some((v) => !Number.isFinite(v))) continue;
      // Said to a precision ("9.95 to three significant figures"): a line within rounding of it is right.
      const rel = Math.max(1e-6, ...[...letters].map((l) => (halfUnit[l] ? (2 * halfUnit[l]) / Math.max(1e-9, Math.abs(values[l])) : 0)));
      if (vals.some((v) => Math.abs(v - vals[0]) > rel * Math.max(1, Math.abs(vals[0])))) issues.push({ step: stepIndex, clause: clause.trim(), message: `"${clause.trim()}" is false for ${known.map((k) => `${k} = ${values[k]}`).join(", ")}` });
    }
  }
  return issues;
}

/**
 * A FORMULA'S NOTE IS THE FORMULA. "We write it as a divided by sine A equals b divided by sine B…"
 * had the note "Sine rule" while the board never wrote the rule (maths benchmark, 2026-10-21). For a
 * sentence that states an equation with an operator, its note becomes that equation in symbols when
 * the planner's note holds no equation — compact ("a/sin A = b/sin B = c/sin C"), at most 44 characters.
 */
export function formulaNotes(notes: Array<{ s: number; text: string }> | undefined, script: string): Array<{ s: number; text: string }> | undefined {
  const sentences = canvasSentences(script);
  const out = [...(notes ?? [])];
  for (const eq of spokenEquations(script)) {
    if (!/[+\-−×÷/^√²³]|sin|cos|tan/.test(eq.text.split("=").slice(1).join("=") + eq.text.split("=")[0])) continue;
    const compact = eq.text.replace(/\s*÷\s*/g, "/").replace(/\s+/g, " ").trim();
    if (compact.length > 44 || !sentences[eq.sentence]) continue;
    const at = out.findIndex((n) => n.s === eq.sentence);
    if (at >= 0 && /[=≈]/.test(out[at].text)) continue;
    // Already a note elsewhere ("S = n(a + l)/2" was written twice).
    if (out.some((n) => normalizeMath(n.text).replace(/÷/g, "/") === normalizeMath(compact))) continue;
    if (at >= 0) out[at] = { s: eq.sentence, text: compact };
    else out.push({ s: eq.sentence, text: compact });
  }
  out.sort((a, b) => a.s - b.s);
  return out.length ? out : notes;
}

/**
 * THE ANSWER IS WRITTEN. On a board whose picture is a figure, a sketch or a scene, the notes are the
 * only writing — and round 1 of the maths benchmark (2026-10-21) found the answer missing from them
 * again and again: "c = 10 cm" (Pythagoras), "f′(x) = 2x" (first principles), "y = (x − 4)² − 5"
 * (completing the square), "25² = 625". The last equation of each of the board's final three
 * sentences that state one is written as a note when no note already shows it; a note that breaks
 * off ("f′(x) = lim h→0", "a² + b² =") is completed from what Aria says, or dropped. At most six
 * notes: an added answer takes the place of a note without maths, never of another equation.
 */
/**
 * A NOTE IS WRITTEN WHEN IT IS SAID (owner, 2026-10-22: "nothing that will be taught in the future should
 * be present before"). A note timed to an earlier sentence than the first one that says it moves to that
 * sentence; it never moves earlier, and a note no sentence says (a summary) keeps its place.
 */
export function revealNotesWhenSaid<T extends { text: string; s: number }>(notes: T[], script: string): T[] {
  const sentences = canvasSentences(script);
  if (!sentences.length) return notes;
  const flat = (t: string) => normalizeMath(spokenMaths(t)).replace(/÷/g, "/");
  const said = sentences.map(flat);
  const words = sentences.map((t) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((w) => w.replace(/(?:es|s)$/, ""))));
  const saysIt = (note: string, k: number) => {
    const maths = flat(note);
    if (/[=<>≤≥+×÷/^]|\d/.test(note) && maths.length >= 3 && said[k].includes(maths)) return true;
    const own = [...new Set((note.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((w) => w.replace(/(?:es|s)$/, "")))];
    return own.length >= 2 && own.filter((w) => words[k].has(w)).length >= Math.ceil(own.length * 0.6);
  };
  return notes.map((n) => {
    const first = sentences.findIndex((_, k) => saysIt(n.text, k));
    return first > n.s ? { ...n, s: first } : n;
  });
}

/**
 * NO CUT OR REPEATED NOTES. "f′(x)=lim" (cut after its operator) and "f(x)=x²" beside "f(x)=x², x=2"
 * were written on one derivatives board (owner's lecture, 2026-10-22). A note that ends on a sign or
 * on a function with nothing to act on, or that is another note's first clause, is taken off.
 */
export function tidyNotes<T extends { text: string }>(notes: T[]): T[] {
  const flat = (t: string) => normalizeMath(t).replace(/÷/g, "/");
  const cut = (t: string) => /(?:[=+×÷*/−<>≤≥≈→-]|\b(?:lim|log|ln|sin|cos|tan|d\/dx)|[√∫])\s*$/i.test(t.trim()) && /[=<>≤≥≈]/.test(t);
  return notes.filter((n, i) => {
    if (cut(n.text)) return false;
    const me = flat(n.text);
    if (me.length < 3) return true;
    return !notes.some((o, j) => {
      if (j === i) return false;
      const other = flat(o.text);
      if (other === me) return j < i;
      return other.startsWith(me) && /^[,;]/.test(other.slice(me.length));
    });
  });
}

/**
 * NOTES IN THE ORDER SAID. Notes of one sentence were listed as the writer thought of them, so the
 * result often sat above the line that reaches it: "Point = (1, 3)" over "y = 1² + 2 × 1 = 3", and
 * "2x + 3 − 2x = 2x + 7 − 2x" over the equation it comes from (maths benchmark R8, 3 of 5 lectures).
 * Within a sentence a note goes where that sentence says it; a line made from another by doing the
 * same to both sides goes after it; a note the sentence does not say stays after the note before it.
 */
export function orderNotesAsSaid<T extends { text: string; s: number }>(notes: T[], script: string): T[] {
  if (notes.length < 2 || !script) return notes;
  const flat = (t: string) => normalizeMath(spokenMaths(t)).replace(/÷/g, "/");
  const said = canvasSentences(script).map(flat);
  const sidesOf = (t: string) => t.split(/[;,]/)[0].split(/[=≈]/).filter(Boolean);
  const where = (n: T): number => {
    const line = said[n.s] ?? "";
    const t = flat(n.text);
    const sides = sidesOf(t);
    for (const probe of [t, t.split(/[;,]/)[0], sides[sides.length - 1], sides[0]]) {
      if (probe && probe.length >= 2) {
        const i = line.indexOf(probe);
        if (i >= 0) return i;
      }
    }
    return Number.NaN;
  };
  const pos = notes.map(where);
  // Unsaid notes keep their place after the note before them (in the same sentence).
  for (let i = 0; i < notes.length; i++) {
    if (!Number.isNaN(pos[i])) continue;
    const prev = i > 0 && notes[i - 1].s === notes[i].s ? pos[i - 1] : -1;
    pos[i] = prev + 0.5;
  }
  // "a − 2x = b − 2x" is made from "a = b": after it.
  const sides = notes.map((n) => flat(n.text).split(/[=≈]/));
  for (let b = 0; b < notes.length; b++) {
    for (let a = 0; a < notes.length; a++) {
      if (a === b || notes[a].s !== notes[b].s || sides[a].length !== 2 || sides[b].length !== 2) continue;
      const [al, ar] = sides[a], [bl, br] = sides[b];
      if (bl !== al && br !== ar && al.length >= 2 && ar.length >= 2 && bl.startsWith(al) && br.startsWith(ar) && pos[b] <= pos[a]) pos[b] = pos[a] + 0.1;
    }
  }
  return notes.map((n, i) => ({ n, i })).sort((x, y) => x.n.s - y.n.s || pos[x.i] - pos[y.i] || x.i - y.i).map(({ n }) => n);
}

export function withResultNotes<T extends { id: string; text: string; s: number }>(notes: T[], script: string, make: (text: string, s: number, k: number) => T): T[] {
  const spoken = spokenEquations(script);
  const norm = (t: string) => normalizeMath(t).replace(/÷/g, "/");
  const short = (eq: string) => {
    const one = eq.replace(/\s*÷\s*/g, " ÷ ").replace(/\s+/g, " ").trim();
    if (one.length <= 34) return one;
    const sides = one.split(/\s*[=≈]\s*/);
    const pair = `${sides[0]} = ${sides[sides.length - 1]}`;
    return pair.length <= 34 ? pair : "";
  };
  // A broken note: completed by the spoken equation it begins, else taken off.
  // …or opens on "=" ("= 4 + h"), or leaves a bracket open ("(k + 1)(k/2 + 1) = (k + 1)(k"): the spoken
  // equation it is part of, else nothing.
  const unbalanced = (t: string) => (t.match(/\(/g)?.length ?? 0) !== (t.match(/\)/g)?.length ?? 0);
  let out = notes.flatMap((n) => {
    const t = n.text.trim();
    const endsOpen = /(?:[=+\-−×÷*/^]|\blim\s*[a-z]\s*→\s*\S+)\s*$/.test(t);
    const startsOpen = /^[=≈]/.test(t);
    if (!endsOpen && !startsOpen && !unbalanced(t)) return [n];
    const bare = norm(t.replace(/^[=≈]\s*/, ""));
    const whole = spoken.find((e) => (startsOpen ? norm(e.text).includes(bare) : norm(e.text).startsWith(bare)) && norm(e.text).length > bare.length);
    let text = "";
    if (whole && startsOpen) {
      // The note's own right side, after the left side Aria gives it: "(x + h)² − x² … = 2xh + h²".
      const lhs = whole.text.split(/\s*[=≈]\s*/)[0];
      text = short(`${lhs} = ${t.replace(/^[=≈]\s*/, "")}`);
    } else if (whole) text = short(whole.text);
    return text && !unbalanced(text) ? [{ ...n, text }] : [];
  });
  const shows = (eq: string) => out.some((n) => norm(n.text).includes(norm(eq)) || spokenIsWritten(eq, [norm(n.text)]));
  const bySentence = new Map<number, string>();
  for (const e of spoken) bySentence.set(e.sentence, e.text);
  const last = [...bySentence.entries()].sort((a, b) => a[0] - b[0]).slice(-4);
  let k = 0;
  for (const [s, eq] of last) {
    const text = short(eq);
    if (!text || shows(eq) || shows(text)) continue;
    const note = make(text, s, k++);
    if (out.length >= 6) {
      // Replace the word-only note nearest this sentence; never another equation.
      const words = out.map((n, i) => ({ n, i })).filter(({ n }) => !/[=≈]/.test(n.text)).sort((a, b) => Math.abs(a.n.s - s) - Math.abs(b.n.s - s))[0];
      if (!words) continue;
      out = out.map((n, i) => (i === words.i ? note : n));
    } else out.push(note);
  }
  return out.sort((a, b) => a.s - b.s);
}

/**
 * AN EXPANSION IS TRUE FOR EVERY VALUE. On a step whose sentence expands, multiplies out, simplifies or
 * factorises (and does not solve), each equation with letters on both sides must hold for any value of
 * them: "(1 + x) = (1 + x)(1 + x)" and "(1 + x)ⁿ = 1 + 4x + 6x² + 4x³ + x⁴" reached boards (maths
 * benchmark rounds 1–2). Tested at three sets of values. Returns the false clauses: step index and text.
 */
export function falseIdentities(stage: EquationStage, script: string): Array<{ step: number; clause: string }> {
  const sentences = canvasSentences(script);
  const textOf = new Map(stage.tokens.map((t) => [t.id, t.text.trim()]));
  const EXPAND = /\b(expand\w*|multipl\w*|brackets?|simplif\w*|factori[sz]\w*|factor out|collect\w*|identit\w*|rearrang\w*)\b/i;
  const SOLVE = /\b(solv\w*|roots?|solutions?|find (?:the value|x|y)|when \w+ =)\b/i;
  const sup = (s: string) => s.replace(new RegExp(`[${Object.keys(SUPERSCRIPT).join("")}]+`, "g"), (m) => `^(${[...m].map((c) => SUPERSCRIPT[c]).join("")})`);
  const asExpr = (side: string) => {
    let e = toExpr(sup(side)).replace(/\s+/g, "");
    for (let i = 0; i < 3; i++) e = e.replace(/(\d|\))([a-z(])/g, "$1*$2").replace(/([a-z])(\(|\d)/g, "$1*$2").replace(/\)\(/g, ")*(").replace(/([a-z])([a-z])/g, "$1*$2");
    return e;
  };
  const points = [1.37, 2.11, 0.53];
  const out: Array<{ step: number; clause: string }> = [];
  // Every equation on the board, as its outer sides. A clause that is the SAME EQUATION as another one —
  // left minus right a constant multiple of the other's — is a step of working, not a false identity:
  // "y − 4 = 4x − 8, y = 4x − 4" after "y − 4 = 4(x − 2)", and "3x + 5 − x = x + 13 − x" before
  // "2x + 5 = 13", were taken off the board because their sentences said "expand" or "collect" (maths
  // benchmark R8; the tangent's answer and the first step of working were never written).
  const written: Array<{ exprs: string[]; letters: string[]; clause: string; step: number }> = [];
  const LETTERS = ["x", "y", "z", "a", "b", "c", "m", "n", "k", "t"];
  const at = (eq: { exprs: string[] }, values: Record<string, number>) => evalExpr(eq.exprs[0], values) - evalExpr(eq.exprs[eq.exprs.length - 1], values);
  const sameEquation = (eq: { exprs: string[]; letters: string[]; clause: string; step: number }) => written.some((w) => {
    if (w.step === eq.step && w.clause === eq.clause) return false;
    const names = [...new Set([...eq.letters, ...w.letters])];
    if (!names.every((l) => LETTERS.includes(l) || l.length === 1)) return false;
    let ratio: number | null = null;
    for (const [k, p] of points.entries()) {
      const values = Object.fromEntries(names.map((l, j) => [l, p + j * 0.71 + k * 0.13]));
      const mine = at(eq, values), theirs = at(w, values);
      if (!Number.isFinite(mine) || !Number.isFinite(theirs) || Math.abs(theirs) < 1e-9) return false;
      const r = mine / theirs;
      if (ratio === null) ratio = r;
      else if (Math.abs(r - ratio) > 1e-6 * Math.max(1, Math.abs(ratio))) return false;
    }
    return ratio !== null && Math.abs(ratio) > 1e-9;
  });
  const candidates: Array<{ exprs: string[]; letters: string[]; clause: string; step: number }> = [];
  stage.steps.forEach((st, stepIndex) => {
    const said = sentences[st.s] ?? "";
    const checks = EXPAND.test(`${said} ${st.caption ?? ""}`) && !SOLVE.test(said);
    const row = st.order.map((id) => textOf.get(id) ?? "").join(" ");
    for (const clause of row.split(/\s*(?:,|;|\band\b|\bor\b|\bso\b|\bthen\b|\bgives\b)\s*/)) {
      const sides = clause.split(/=/).map((x) => x.trim()).filter(Boolean);
      if (sides.length < 2 || /[A-Z]|\b(?:sin|cos|tan|log|ln)\b|[^\x00-\x7F²³⁰¹⁴⁵⁶⁷⁸⁹ⁿᵏˣ⁺⁻−–×÷·√π]/.test(clause.replace(/[a-z]/g, ""))) continue;
      const letters = [...new Set(sup(clause).match(/[a-z]/g) ?? [])];
      if (!letters.length || letters.length > 3) continue;
      const exprs = sides.map(asExpr);
      const eq = { exprs, letters, clause: clause.trim(), step: stepIndex };
      written.push(eq);
      // Only letters on every side can make an identity ("2x + 5 = 13" is an equation to solve).
      if (!sides.every((x) => /[a-z]/.test(x))) continue;
      const false_ = checks && points.some((p, k) => {
        const values = Object.fromEntries(letters.map((l, j) => [l, p + j * 0.71 + k * 0.13]));
        const vals = exprs.map((e) => evalExpr(e, values));
        return vals.every(Number.isFinite) && vals.some((v) => Math.abs(v - vals[0]) > 1e-6 * Math.max(1, Math.abs(vals[0])));
      });
      if (false_) candidates.push(eq);
    }
  });
  for (const eq of candidates) if (!sameEquation(eq)) out.push({ step: eq.step, clause: eq.clause });
  return out;
}


/**
 * THE NARRATION'S OWN SUMS. "3 + 7 + 11 + 15 … gives 38" (it is 36) passed every check, because only
 * "calculation = number" was read (maths benchmark round 3). Spoken maths is translated, and "gives",
 * "is", "makes", "totals", "comes to" after a calculation count as "=".
 */
export function narrationArithmetic(script: string): ReturnType<typeof checkNumbers> {
  const text = spokenMaths(script).replace(/([\d)²³])\s*,?\s*\b(?:which is|gives|giving|is|makes|totals?|comes to|equal to)\b\s*(?=[-−]?\d)/gi, "$1 = ");
  return checkNumbers(text);
}
