import { canvasSentences } from "./plan";
import { falseClauses, falseIdentities, normalizeMath, spokenEquations, spokenIsWritten, spokenMaths } from "./equationCheck";
import { SUBSCRIPT, SUPERSCRIPT } from "./mathChars";
import { checkNumbers, toExpr } from "./numberCheck";
import { evalExpr } from "./expr";
import type { EquationStage, EquationToken } from "./types";

/*
 * A ROW OF WORKING IS WRITTEN WHOLE. Four lectures of eleven showed broken maths (prompt bench,
 * 2026-10-18): "F = 2 kg × 3 m/s²  6 N", "2² − 5(2) + 6  4 − 10  0", "2 V + 4 V" for "2 V + 4 V = 6 V",
 * "(x − 2)(x − 3) = 0 ⇒ x − 2". The writer's step left out a second "=", a term or the result, or named
 * a token it never defined (dropped), and after three such attempts the closest board shipped anyway.
 * Yet the step's own caption ("2 kg × 3 m/s² = 6 N") or the sentence Aria says over it ("2² − 5(2) + 6
 * = 4 − 10 + 6 = 0") states the equation whole. A broken row is rebuilt from that, reusing the
 * writer's own tokens (their colours and highlights) and adding only the terms that were missing.
 */

const OPERATOR = /^(?:=|≠|≈|≤|≥|<|>|\+|−|-|–|×|÷|·|→|⇒|⇌|±|,|or|and|so|gives|then)$/;
// The words Aria joins two equations with ("x − 2 = 0 or x − 3 = 0"), kept between them on the board.
const CONNECTOR = /^(?:or|and|so|gives|then|giving)$/i;
const UNITS = new Set(["kg", "g", "mg", "m", "cm", "mm", "km", "s", "ms", "h", "min", "n", "kn", "j", "kj", "w", "kw", "v", "mv", "a", "ma", "ω", "kω", "pa", "kpa", "hz", "mol", "k", "°c", "°", "%", "m/s", "m/s²", "m²", "m³", "cm²", "cm³", "dm³", "g/cm³", "kg/m³", "n/m", "j/kg", "w/m²", "newtons", "volts", "amps", "ohms", "joules", "watts", "metres", "meters", "seconds"]);

const clean = (chunk: string) => chunk.replace(/^[("'“]+|[.,;:!?'"”]+$/g, "");
// A product of symbols written as one word ("AuU" for Aᵤ·U, "λH") is maths too; a short ordinary
// word ("It", "As") is not.
const SHORT_WORDS = /^(?:it|in|if|at|as|an|is|of|on|or|to|we|he|be|by|do|go|no|so|up|us|my|me|the|and|for|but|not|its)$/i;
const isMathChunk = (chunk: string) => {
  const c = clean(chunk);
  // ± and √ are maths too: without them "x = (−b ± √(b² − 4ac)) ÷ 2a" was read as "x = (−b" (benchmark).
  // sin/cos/tan as words: "sin θ = 3/5" was read as "θ = 3/5" (maths benchmark round 1).
  return /[0-9²³⁴()[\]+\-−–×÷·/=^≠≈<>≤≥→⇒±∓√∛∑∫π∠]/.test(chunk) || /^[a-zα-ω]$/i.test(c) || /^log_?[a-z0-9₀-₉]+$/i.test(c) || UNITS.has(c.toLowerCase())
    || /^(?:sin|cos|tan|sec|cosec|cot|ln|lim|exp)$/.test(c) || /[₀-₉ᵃ-ᶻⁿ⁺⁻]/.test(c)
    || (/^(?:[A-Zλμσθ][a-zᵤₙ₀-₉]?){1,3}$/.test(c) && !SHORT_WORDS.test(c));
};

/** The equations a sentence or caption writes out: runs of maths with an "=" (or ≠, ≈) and a term on each side. */
export function writtenEquations(text: string): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    const eq = run.join(" ").replace(/^[,;:]+|[.,;:!?]+$/g, "").trim();
    run = [];
    const terms = equationTerms(eq);
    const rel = terms.findIndex((t) => /^(?:=|≠|≈)$/.test(t));
    if (rel > 0 && rel < terms.length - 1 && /\d|[a-z]/i.test(eq)) out.push(eq);
  };
  for (const chunk of text.split(/\s+/).filter(Boolean)) {
    if (/:$/.test(chunk)) { flush(); continue; }
    if (isMathChunk(chunk)) run.push(chunk);
    else flush();
    if (/[,;]$/.test(chunk)) flush();
  }
  flush();
  return out;
}

/**
 * Every equation a sentence states, joined by the words Aria joins them with: "(x − 2)(x − 3) = 0 gives
 * x − 2 = 0 or x − 3 = 0" → one row. Two equations with more than a couple of words between them are
 * joined by a comma.
 */
export function joinedEquations(text: string, keep: (eq: string) => boolean = () => true): string[] {
  const eqs = writtenEquations(text).filter(keep);
  if (eqs.length < 2) return [];
  const terms: string[] = [];
  let from = 0;
  eqs.forEach((eq, i) => {
    const at = text.indexOf(eq, from);
    if (i > 0) {
      const between = text.slice(from, at < 0 ? from : at).replace(/[.,;:]/g, " ").trim().split(/\s+/).filter(Boolean);
      const word = between.length <= 2 ? between.find((w) => CONNECTOR.test(w)) : undefined;
      terms.push(word ? word.toLowerCase().replace(/^giving$/, "gives") : ",");
    }
    terms.push(...equationTerms(eq));
    from = at < 0 ? from : at + eq.length;
  });
  return [terms.join(" ")];
}

/** "2 kg × 3 m/s² = 6 N" → ["2 kg", "×", "3 m/s²", "=", "6 N"]; a leading minus stays with its number. */
export function equationTerms(eq: string): string[] {
  // Split at the top level only: "(−2)(−3)" and "(x − 2)" are one term each.
  const text = eq.replace(/\s+/g, " ").trim();
  const pieces: string[] = [];
  let depth = 0;
  let buf = "";
  const SPLIT = /^(?:=|≠|≈|≤|≥|<|>|\+|−|–|×|÷|→|⇒|⇌|±|,)/;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) depth = Math.max(0, depth - 1);
    const rest = text.slice(k);
    const word = depth === 0 && /^\s(?:or|and|so|gives|then)(?=\s)/.exec(rest);
    const op = depth === 0 && (SPLIT.exec(rest) || (/^-(?=\s)/.test(rest) && /\s$/.test(buf) ? ["-"] : null));
    if (word) { pieces.push(buf, word[0].trim()); buf = ""; k += word[0].length - 1; continue; }
    if (op) { pieces.push(buf, op[0]); buf = ""; k += op[0].length - 1; continue; }
    buf += c;
  }
  pieces.push(buf);
  const parts = pieces.map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const unary = /^[−–-]$/.test(p) && (out.length === 0 || OPERATOR.test(out[out.length - 1])) && i + 1 < parts.length;
    if (unary) { out.push(`−${parts[++i]}`); continue; }
    out.push(p);
  }
  return out;
}

const key = (t: string) => normalizeMath(t).replace(/\s+/g, "");

/** Two terms side by side with nothing between them, or a row that ends on an operator. */
export function malformedRow(terms: string[]): boolean {
  if (!terms.length) return false;
  if (OPERATOR.test(terms[terms.length - 1])) return true;
  // A row that opens on a relation lost its left side ("= cos²θ = 1 − …"; maths benchmark round 1).
  if (/^(?:=|≈|≠)$/.test(terms[0].trim())) return true;
  for (let k = 1; k < terms.length; k++) {
    const a = terms[k - 1], b = terms[k];
    // "− 5x" (a minus and a space) continues the expression; "−2" (no space) is a new number.
    if (OPERATOR.test(a) || OPERATOR.test(b) || /[=+×÷−\-→⇒(]$/.test(a) || /^(?:[=+×÷→⇒)^]|[−–-]\s)/.test(b)) continue;
    // A coefficient and what it multiplies ("2", "x" or "3", "(x + 1)") are one product.
    if (/^[\d.]+$/.test(a) && (/^[a-zα-ω]$/i.test(b) || b.startsWith("("))) continue;
    return true;
  }
  return false;
}

/** How much of `row` appears, in order, in `target` (0-1). */
function coverage(row: string[], target: string[]): number {
  const want = target.map(key);
  let at = 0;
  let hit = 0;
  for (const term of row.map(key)) {
    const found = want.indexOf(term, at);
    if (found >= 0) { hit++; at = found + 1; }
  }
  return row.length ? hit / row.length : 0;
}

const OP_TEX: Record<string, string> = { "=": "=", "≠": "", "≈": "\\approx", "≤": "\\leq", "≥": "\\geq", "<": "<", ">": ">", "+": "+", "−": "-", "-": "-", "–": "-", "×": "\\times", "÷": "\\div", "·": "\\cdot", "→": "\\rightarrow", "⇒": "\\Rightarrow", "⇌": "\\rightleftharpoons", "±": "\\pm" };
const SUPER_RUN = new RegExp(`[${Object.keys(SUPERSCRIPT).join("")}]+`, "g");
const SUB_RUN = new RegExp(`[${Object.keys(SUBSCRIPT).join("")}]+`, "g");

/** A plain-text term as LaTeX: "3 m/s²" → "3\,\text{m/s}^{2}", "−5(2)" → "-5(2)", "x²" → "x^{2}". */
export function plainTex(term: string): string {
  const t = term.trim();
  if (OP_TEX[t]) return OP_TEX[t];
  // "lim(h→0)(2x + h)" → \lim_{h \to 0}(2x + h)
  const lim = /^lim\s*\(?\s*([a-zα-ω])\s*(?:→|->)\s*([^)\s]+)\s*\)?\s*(.*)$/i.exec(t);
  if (lim) return `\\lim_{${lim[1]} \\to ${lim[2].replace(/[−–]/g, "-")}}${lim[3] ? plainTex(lim[3]) : ""}`;
  if (t === ",") return ",\\quad";
  if (CONNECTOR.test(t)) return `\\quad\\text{${t}}\\quad`;
  // Every superscript and subscript, letters and signs too: "8ᵏ⁺¹" was set as "8ᵏ⁺^{1}", which KaTeX
  // could not read and drew in red (maths benchmark round 1).
  const powers = (s: string) => s.replace(SUPER_RUN, (m) => `^{${[...m].map((c) => SUPERSCRIPT[c]).join("")}}`).replace(SUB_RUN, (m) => `_{${[...m].map((c) => SUBSCRIPT[c]).join("")}}`);
  // A matrix written as rows ("[[1, 2], [3, 4]]") is typeset as one; "n choose r" is the binomial coefficient.
  const matrix = /^\[\s*\[(.+)\]\s*\]$/.exec(t);
  if (matrix) {
    const rows = matrix[1].split(/\]\s*,\s*\[/).map((r) => r.split(",").map((x) => plainTex(x.trim())).join(" & "));
    if (rows.length >= 1 && rows.length <= 4) return `\\begin{pmatrix}${rows.join(" \\\\ ")}\\end{pmatrix}`;
  }
  // "2 factorial" written out by the writer from the narration is "2!" (maths benchmark round 4).
  if (/\bfactorial\b/.test(t)) return plainTex(t.replace(/(\d+|\b[a-zA-Z]|\))\s+factorial\b/g, "$1!"));
  const choose = /^(\w+)\s+choose\s+(\w+)$/.exec(t);
  if (choose) return `\\binom{${choose[1]}}{${choose[2]}}`;
  const unit = /^([−–-]?[\d.,]+)\s+([A-Za-zΩµ°%/]+)([⁰¹²³⁴⁵⁶⁷⁸⁹⁻]*)$/.exec(t);
  if (unit) return `${unit[1].replace(/[−–]/g, "-")}\\,\\text{${unit[2]}}${unit[3] ? powers(unit[3]) : ""}`;
  // Words first, keeping the spaces around them ("P(A and defect)" was set as "P(Aanddefect)"), and
  // before the operators turn into commands ("2×3" was set as "2\\text{times} 3"; maths benchmark).
  return powers(t)
    .replace(/[−–]/g, "-")
    // "log_bM" is log base b of M: "bM" was set as one word in the subscript (maths benchmark V4).
    .replace(/\blog_([A-Za-z0-9])\s*/g, "log_{$1} ")
    .replace(/(\s?)([A-Za-z]{2,}(?:\s+[A-Za-z]{2,})*)(\s?)/g, (_m, pre: string, run: string, post: string) =>
      /^(sin|cos|tan|log|ln|exp)$/.test(run) ? `${pre}\\${run}${post}` : `\\text{${pre ? " " : ""}${run}${post ? " " : ""}}`,
    )
    .replace(/×/g, "\\times ")
    .replace(/÷/g, "\\div ")
    .replace(/≠/g, "\\neq ")
    .replace(/[…⋯]/g, "\\dots ");
}

/**
 * Rebuild each broken row of working from the equation its caption or its sentence states. `cut`
 * marks steps that lost a term in validation (an undefined token, a trailing operator). Returns how
 * many rows were rebuilt.
 */
export function repairEquationRows(stage: EquationStage, script: string, cut: Set<number> = new Set()): number {
  const sentences = canvasSentences(script);
  const textOf = new Map(stage.tokens.map((t) => [t.id, t.text]));
  let fixed = 0;
  stage.steps.forEach((step, i) => {
    const tokensRow = step.order.map((id) => textOf.get(id) ?? "").filter(Boolean);
    // Compared term by term: a writer's token may hold several terms ("x = 2").
    const row = tokensRow.flatMap((t) => equationTerms(t));
    const hasRelation = row.some((t) => /^(?:=|≠|≈)$/.test(t));
    const fromCaption = step.caption ? writtenEquations(step.caption) : [];
    const said = sentences[step.s] ?? "";
    // A line another row already writes is not written again in a rebuilt row ("4² − 4×1×5 = −4"
    // appeared twice on a discriminant board; maths benchmark V1).
    const otherRows = stage.steps.filter((_, k) => k !== i).map((st) => key(st.order.map((id) => textOf.get(id) ?? "").join("")));
    const unwritten = (eq: string) => !otherRows.some((w) => w.includes(key(eq)));
    const fromSentence = [...writtenEquations(said).filter(unwritten), ...joinedEquations(said, unwritten)];
    const broken = malformedRow(tokensRow) || cut.has(i);
    // A row that only repeats the one before, while Aria states a NEW equation over it, writes that
    // equation: "lim(h→0)(2x + h) = 2x" was said over a copy of the previous line (2026-10-18).
    const previous = i > 0 ? stage.steps[i - 1].order.join("|") : null;
    if (previous !== null && step.order.join("|") === previous) {
      const written = stage.steps.map((st) => key(st.order.map((id) => textOf.get(id) ?? "").join("")));
      const fresh = writtenEquations(said).find((eq) => !written.some((w) => w.includes(key(eq))));
      if (fresh) {
        const order = equationTerms(fresh).map((term, k) => {
          const id = `fix-${i + 1}-${k + 1}`;
          const tex = plainTex(term);
          stage.tokens.push(tex ? { id, text: term, tex } : { id, text: term });
          textOf.set(id, term);
          return id;
        });
        step.order = order;
        step.highlight = [];
        fixed++;
        return;
      }
    }
    // The caption names this step's equation; a row that writes only its left side is unfinished.
    const unfinished = !hasRelation && fromCaption.length > 0;
    if (!broken && !unfinished) return;
    const targets = [...fromCaption, ...(broken ? fromSentence : [])].flatMap((eq) => {
      const terms = equationTerms(eq);
      // The caption may state only the row's end ("2 kg × 3 m/s² = 6 N" under "F = 2 kg × 3 m/s² 6 N"):
      // the row's own beginning is kept in front of it.
      // ...and a row that breaks off mid-way ("… = 0 ⇒ x − 2") continues with the rest of what Aria
      // says from the term where it broke off ("x − 2 = 0 or x − 3 = 0").
      // Only when the row's start is sound and all of its rest appears, in order, in what follows.
      // Judged on the writer's own terms ("0 + 2" then "x = 2" is two things jammed together).
      const merged: string[][] = [];
      tokensRow.forEach((_, m) => {
        if (m === 0 || !OPERATOR.test(tokensRow[m - 1].trim()) || malformedRow(tokensRow.slice(0, m - 1))) return;
        const tail = tokensRow.slice(m).flatMap((t) => equationTerms(t));
        // Aligned on a term, never on a sign: matching the tail's "=" to the sentence's first "=" wrote
        // "cos²θ = 1 − (3/5)² = 1 − (3/5)² = …" (maths benchmark round 1).
        if (!tail.length || OPERATOR.test(tail[0]) || /^[=≈]$/.test(tail[0])) return;
        const p = terms.findIndex((u) => key(u) === key(tail[0] ?? ""));
        if (p >= 0 && coverage(tail, terms.slice(p)) === 1) merged.push([...tokensRow.slice(0, m).flatMap((t) => equationTerms(t)), ...terms.slice(p)]);
      });
      return [terms, ...merged];
    });
    const candidates = targets
      .filter((terms) => !malformedRow(terms) && terms.length > 2)
      .map((terms) => ({ terms, cover: coverage(row, terms) }))
      // What Aria says over a broken row wins even when the row barely resembles it.
      .filter((c) => c.cover >= (broken ? 0.3 : 0.5) && c.terms.length >= Math.min(row.length, 3))
      .sort((a, b) => b.cover - a.cover || b.terms.length - a.terms.length);
    const best = candidates[0];
    if (!best) {
      if (!broken) return;
      // No equation to rebuild it from. A word label at the front goes to the caption ("Linear
      // equations"), and two whole equations side by side get a comma between them.
      let order = [...step.order];
      const isLabel = (id: string) => { const t = (textOf.get(id) ?? "").trim(); return /^[A-Za-z][A-Za-z\s'’-]+$/.test(t) && t.split(/\s+/).length <= 4; };
      const labels: string[] = [];
      while (order.length > 1 && isLabel(order[0])) labels.push((textOf.get(order.shift()!) ?? "").trim());
      const withCommas: string[] = [];
      order.forEach((id, k) => {
        if (k > 0) {
          const before = withCommas.map((x) => textOf.get(x) ?? "");
          const a = before[before.length - 1] ?? "", b = textOf.get(id) ?? "";
          const sinceComma = before.slice(before.lastIndexOf(",") + 1).join(" ");
          // Only between two WHOLE equations: "A = Aᵤ" then "U users" is not two equations
          // (a comma there read "A = Aᵤ, U users"; 2026-10-18).
          const rest = order.slice(k).map((x) => textOf.get(x) ?? "").join(" ");
          if (!OPERATOR.test(a) && !OPERATOR.test(b) && /[=≠≈]/.test(sinceComma) && /[=≠≈]/.test(rest.split(/[,;]/)[0])) {
            const comma = `fix-${i + 1}-sep-${k}`;
            stage.tokens.push({ id: comma, text: ",", tex: ",\\quad" });
            textOf.set(comma, ",");
            withCommas.push(comma);
          }
        }
        withCommas.push(id);
      });
      if (!malformedRow(withCommas.map((id) => textOf.get(id) ?? ""))) {
        step.order = withCommas;
        const label = labels.join(" ");
        if (label && !step.caption?.toLowerCase().includes(label.toLowerCase())) step.caption = step.caption ? `${label}: ${step.caption}`.slice(0, 64) : label;
        fixed++;
        return;
      }
      // Still nonsense ("0  0"): the last good row stays up while its sentence is said.
      const previous = stage.steps.slice(0, i).reverse().find((p) => !malformedRow(p.order.map((id) => textOf.get(id) ?? "")));
      if (previous) { step.order = [...previous.order]; step.highlight = (step.highlight ?? []).filter((h) => step.order.includes(h)); fixed++; }
      return;
    }
    const used = new Set<string>();
    const order: string[] = [];
    // Only this row's own terms (or ones no row uses) are reused: a term shared with another row makes
    // the board read the rows as one equation rearranged, and the earlier line is wiped.
    const elsewhere = new Set(stage.steps.filter((_, k) => k !== i).flatMap((st) => st.order));
    best.terms.forEach((term, k) => {
      const mine = stage.tokens.find((t) => !t.on && !used.has(t.id) && (step.order.includes(t.id) || !elsewhere.has(t.id)) && key(t.text) === key(term));
      if (mine) { used.add(mine.id); order.push(mine.id); return; }
      const id = `fix-${i + 1}-${k + 1}`;
      const tex = plainTex(term);
      // A lone "≠" is drawn as the character: KaTeX builds it from a glyph of its own font ("a /= 0").
      const token: EquationToken = tex ? { id, text: term, tex } : { id, text: term };
      stage.tokens.push(token);
      textOf.set(id, term);
      used.add(id);
      order.push(id);
    });
    step.order = order;
    if (step.highlight) step.highlight = step.highlight.filter((h) => order.includes(h));
    fixed++;
  });
  if (fixed) {
    // The writer's terms no row uses any more are dropped, so the board's term limit holds the working.
    const inUse = new Set(stage.steps.flatMap((st) => st.order));
    stage.tokens = stage.tokens.filter((t) => inUse.has(t.id) || (t.on && inUse.has(t.on)));
  }
  return fixed;
}

const NUMBER_WORDS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };
/** "thirty-six" → 36, "one-hundred" → 100; undefined for anything else. */
function numberWord(id: string): number | undefined {
  const parts = id.split("-").filter(Boolean);
  if (!parts.length || !parts.every((p) => p in NUMBER_WORDS)) return undefined;
  return parts.reduce((total, p) => (p === "hundred" ? Math.max(1, total) * 100 : total + NUMBER_WORDS[p]), 0);
}
const SIGNS: Record<string, { text: string; tex: string }> = { equals: { text: "=", tex: "=" }, eq: { text: "=", tex: "=" }, plus: { text: "+", tex: "+" }, minus: { text: "−", tex: "-" }, times: { text: "×", tex: "\\times" }, divide: { text: "÷", tex: "\\div" }, divided: { text: "÷", tex: "\\div" } };
const slugId = (v: unknown) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * An equation step that names an id the board has no token for is repaired in code, not sent back
 * for a whole rewrite (a live lecture's equation boards took 3 attempts and ~60 s each for this,
 * 2026-10-20): "equals-6" is the "=" sign, "thirty-six" is 36, an id that is a term's own text is
 * that term, and a plain word ("right-triangle") is not maths and is left out of the line. Works on
 * the model's raw stage, before validation. Returns how many ids it changed.
 */
export function repairEquationOrder(rawStage: unknown): number {
  if (!rawStage || typeof rawStage !== "object") return 0;
  const stage = rawStage as { tokens?: unknown; steps?: unknown };
  if (!Array.isArray(stage.tokens) || !Array.isArray(stage.steps)) return 0;
  const tokens = stage.tokens.filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === "object");
  const ids = new Set(tokens.map((t) => slugId(t.id)));
  const byText = new Map(tokens.map((t) => [slugId(t.text), String(t.id)]));
  let changed = 0;
  const add = (id: string, text: string, tex: string) => {
    if (!ids.has(id)) {
      tokens.push({ id, text, tex });
      (stage.tokens as unknown[]).push({ id, text, tex });
      ids.add(id);
    }
    return id;
  };
  for (const step of stage.steps) {
    if (!step || typeof step !== "object" || !Array.isArray((step as { order?: unknown }).order)) continue;
    const order = (step as { order: unknown[] }).order;
    const next: string[] = [];
    const used = new Set<string>();
    for (const raw of order) {
      const id = slugId(raw);
      if (ids.has(id) && used.has(id)) {
        // The same term twice in one line ("3 × 4 = 12, 3 + 4 = 7"): a line can show a token once,
        // so the second is its own copy — dropping it left "12 + = 7" on a live board (QA 2026-10-21).
        const src = tokens.find((t) => slugId(t.id) === id)!;
        let k = 2;
        while (ids.has(`${id}-${k}`)) k++;
        next.push(add(`${id}-${k}`, String(src.text ?? ""), String(src.tex ?? src.text ?? "")));
        changed++;
        continue;
      }
      if (ids.has(id)) { used.add(id); next.push(String(raw)); continue; }
      changed++;
      const sign = SIGNS[id.replace(/-\d+$/, "")];
      const word = numberWord(id);
      if (sign) {
        // The board's own sign token when it has one, else a new one.
        const own = tokens.find((t) => String(t.text).trim() === sign.text || (sign.text === "−" && String(t.text).trim() === "-"));
        next.push(own ? String(own.id) : add(id, sign.text, sign.tex));
      } else if (byText.has(id)) next.push(byText.get(id)!);
      else if (word !== undefined) next.push(add(id, String(word), String(word)));
      else if (/^\d+(?:-\d+)?$/.test(id)) next.push(add(id, id.replace("-", "."), id.replace("-", ".")));
      // A word is not part of the maths: left out of the line.
    }
    (step as { order: string[] }).order = next;
  }
  return changed;
}

/**
 * A FALSE CHAIN SPLIT IN TWO. "2 × 3 = 6 + 1 = 7" says 6 = 7: two calculations run together with
 * one "=" too many (QA 2026-10-21, a quadratic board shipped it after three rewrites). When the part
 * up to the shared number is true ("2 × 3 = 6") and the chain is not, the row becomes "2 × 3 = 6,
 * 6 + 1 = 7" — the comma puts each on its own line (layout `clauses`). Kept only when the new row
 * checks clean. Returns how many rows it split.
 */
export function splitFalseChains(stage: EquationStage): number {
  const textOf = new Map(stage.tokens.map((t) => [t.id, t.text.trim()]));
  const tokenOf = new Map(stage.tokens.map((t) => [t.id, t]));
  const isOp = (t: string) => /^[+\-−×÷*/]$/.test(t);
  let split = 0;
  stage.steps.forEach((step, i) => {
    let order = [...step.order];
    for (let guard = 0; guard < 3; guard++) {
      const texts = order.map((id) => textOf.get(id) ?? "");
      if (!checkNumbers(texts.join(" ")).length) break;
      let changed = false;
      for (let e = 0; e < texts.length - 2; e++) {
        if (texts[e] !== "=" || !/^[−-]?\d+(?:\.\d+)?$/.test(texts[e + 1]) || !isOp(texts[e + 2])) continue;
        if (!texts.slice(e + 3).includes("=")) continue;
        const start = texts.lastIndexOf(",", e) + 1;
        const head = `${texts.slice(start, e).join(" ")} = ${texts[e + 1]}`;
        if (checkNumbers(head).length) continue;
        const src = tokenOf.get(order[e + 1])!;
        const copy = `${src.id}-again-${i + 1}`;
        const comma = `${src.id}-split-${i + 1}`;
        if (!tokenOf.has(copy)) {
          const c: EquationToken = { ...src, id: copy };
          const k: EquationToken = { id: comma, text: ",", tex: ",\\quad" };
          stage.tokens.push(c, k);
          tokenOf.set(copy, c).set(comma, k);
          textOf.set(copy, src.text.trim()).set(comma, ",");
        }
        order = [...order.slice(0, e + 2), comma, copy, ...order.slice(e + 2)];
        changed = true;
        break;
      }
      if (!changed) break;
    }
    const after = order.map((id) => textOf.get(id) ?? "").join(" ");
    if (order.length !== step.order.length && !checkNumbers(after).length) {
      step.order = order;
      split++;
    }
  });
  return split;
}

/** A term that is a sum or difference at its own top level ("−b ± √(b² − 4ac)", not "√(b² − 4ac)"). */
export function hasTopLevelSum(text: string): boolean {
  let depth = 0;
  const t = text.trim();
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth === 0 && i > 0 && "+−-±∓".includes(c) && !/[×÷*/^(=,]\s*$/.test(t.slice(0, i))) return true;
  }
  return false;
}
/** Paren depth change of a term ("(−5", "√(b²", "4ac))"). */
const depthOf = (t: string) => (t.match(/[([{]/g)?.length ?? 0) - (t.match(/[)\]}]/g)?.length ?? 0);
const ADDITIVE = /^[+\-−–±∓]$/;
const SEPARATOR = /^(?:=|≠|≈|,|or|and|so)$/;

/**
 * A SUM DIVIDED NEEDS ITS BRACKETS. "x = −5 ± √49 ÷ 4" reads −5 ± (√49 ÷ 4): the quadratic formula
 * went out without the brackets round its numerator (maths benchmark, 2026-10-21). Where a line divides
 * a sum or difference by a term with "÷", code puts the numerator in brackets. Returns how many it fixed.
 */
export function bracketDivisions(stage: EquationStage): number {
  const tokenOf = new Map(stage.tokens.map((t) => [t.id, t]));
  let fixed = 0;
  // One term that is itself a sum, then "÷", then one term: the textbook fraction, with its bar
  // ("−b ± √(b² − 4ac)" ÷ "2a" → one token typeset \frac{−b ± √(b² − 4ac)}{2a}).
  stage.steps.forEach((step) => {
    for (let k = 1; k < step.order.length - 1; k++) {
      const [a, op, b] = [tokenOf.get(step.order[k - 1]), tokenOf.get(step.order[k]), tokenOf.get(step.order[k + 1])];
      if (!a || !op || !b || op.text.trim() !== "÷") continue;
      // …or one term divided BY a sum ("1" ÷ "ad − bc" is 1/(ad − bc), never 1/ad − bc; round 3).
      const overSum = !hasTopLevelSum(a.text) && hasTopLevelSum(b.text) && !SEPARATOR.test(a.text.trim()) && !ADDITIVE.test(a.text.trim()) && !OPERATOR.test(a.text.trim());
      if (!overSum && (!hasTopLevelSum(a.text) || SEPARATOR.test(b.text.trim()) || ADDITIVE.test(b.text.trim()))) continue;
      const frac: EquationToken = { ...a, id: `${a.id}-over-${b.id}`, text: overSum ? `${a.text.trim()} ÷ (${b.text.trim()})` : `(${a.text.trim()}) ÷ ${b.text.trim()}`, tex: `\\frac{${a.tex ?? a.text}}{${b.tex ?? b.text}}` };
      if (!tokenOf.has(frac.id)) { stage.tokens.push(frac); tokenOf.set(frac.id, frac); }
      step.order = [...step.order.slice(0, k - 1), frac.id, ...step.order.slice(k + 2)];
      fixed++;
    }
  });
  stage.steps.forEach((step, i) => {
    for (let guard = 0; guard < 3; guard++) {
      const texts = step.order.map((id) => (tokenOf.get(id)?.text ?? "").trim());
      let depth = 0, sideStart = 0, additive = false, at = -1;
      for (let k = 0; k < texts.length; k++) {
        const t = texts[k];
        if (depth === 0 && SEPARATOR.test(t)) { sideStart = k + 1; additive = false; continue; }
        // Only a "±" sum: "−b ± √(b² − 4ac) ÷ 2a" is the quadratic formula's fraction, but "1 + nx +
        // n(n − 1)x² ÷ 2!" divides only its last term — bracketing it wrote a false binomial theorem
        // (maths benchmark round 3).
        if (depth === 0 && /[±∓]/.test(t)) additive = true;
        if (depth === 0 && t === "÷" && additive) { at = k; break; }
        depth += depthOf(t);
      }
      if (at < 0) break;
      const open: EquationToken = { id: `${step.order[sideStart]}-lp-${i + 1}-${guard}`, text: "(", tex: "(" };
      const close: EquationToken = { id: `${step.order[at - 1]}-rp-${i + 1}-${guard}`, text: ")", tex: ")" };
      stage.tokens.push(open, close);
      tokenOf.set(open.id, open).set(close.id, close);
      step.order = [...step.order.slice(0, sideStart), open.id, ...step.order.slice(sideStart, at), close.id, ...step.order.slice(at)];
      fixed++;
    }
  });
  return fixed;
}

/** A plain-number equation that is true ("25 + 24 = 49"). */
function trueNumberEquation(terms: string[]): boolean {
  const line = terms.join(" ");
  return terms.includes("=") && !/[a-zA-Zα-ω√]/.test(line) && checkNumbers(line).length === 0 && /\d\s*[+\-−×÷*/]\s*\d/.test(line);
}

/**
 * A SIDE CALCULATION GETS ITS OWN LINE. "x = −5 ± √49 ÷ 4 = 25 + 24 = 49" glued the discriminant onto
 * the formula and claimed x = 49 (maths benchmark, 2026-10-21). Where a line's tail after an "=" is a
 * true sum of plain numbers that the line before it does not equal, the tail is split off after a
 * comma: "x = −5 ± √49 ÷ 4, 25 + 24 = 49". Returns how many rows it split.
 */
export function splitSideCalculations(stage: EquationStage): number {
  const tokenOf = new Map(stage.tokens.map((t) => [t.id, t]));
  let split = 0;
  // "(−3 ± 5)/4 = x = 1/2 or x = −2": the letter starts a new statement — a comma before it, not "=".
  for (const step of stage.steps) {
    const texts = step.order.map((id) => (tokenOf.get(id)?.text ?? "").trim());
    for (let k = 1; k < texts.length - 1; k++) {
      // "… = x = 1/2", or "… = [x = 1/2 or x = −2]" (a whole statement packed into one term).
      const letterThenEq = /^[a-z]$/i.test(texts[k + 1]) && texts[k + 2] === "=";
      const statement = /^[a-z][₀-₉0-9]?\s*=/i.test(texts[k + 1]);
      if (texts[k] !== "=" || !(letterThenEq || statement) || !/[\d)]/.test(texts[k - 1])) continue;
      const comma: EquationToken = { id: `${step.order[k]}-then`, text: ",", tex: ",\\quad" };
      if (!tokenOf.has(comma.id)) { stage.tokens.push(comma); tokenOf.set(comma.id, comma); }
      step.order = [...step.order.slice(0, k), comma.id, ...step.order.slice(k + 1)];
      split++;
      break;
    }
  }
  stage.steps.forEach((step, i) => {
    const texts = step.order.map((id) => (tokenOf.get(id)?.text ?? "").trim());
    if (!checkNumbers(texts.join(" ")).length) return;
    let depth = 0;
    const eqs: number[] = [];
    texts.forEach((t, k) => { if (depth === 0 && t === "=") eqs.push(k); depth += depthOf(t); });
    for (const e of eqs.slice(1)) {
      const tail = texts.slice(e + 1);
      const end = tail.findIndex((t) => t === ",");
      const calc = end < 0 ? tail : tail.slice(0, end);
      if (!trueNumberEquation(calc)) continue;
      const comma: EquationToken = { id: `${step.order[e]}-side-${i + 1}`, text: ",", tex: ",\\quad" };
      stage.tokens.push(comma);
      tokenOf.set(comma.id, comma);
      step.order = [...step.order.slice(0, e), comma.id, ...step.order.slice(e + 1)];
      split++;
      return;
    }
  });
  return split;
}

/**
 * THE BOARD WRITES WHAT ARIA SAYS. An equation the narration states that no step writes — the final
 * answer "x = ½ or x = −3", read out over a board that stopped one line early (maths benchmark,
 * 2026-10-21) — is written on its own sentence: on that sentence's step after a comma, or as a new
 * step. Returns how many equations it wrote.
 */
export function writeSpokenEquations(stage: EquationStage, script: string): number {
  const text = new Map(stage.tokens.filter((t) => !t.on).map((t) => [t.id, t.text]));
  const writtenNow = () => stage.steps.map((st) => normalizeMath(st.order.map((id) => text.get(id) ?? "").join("")));
  let added = 0;
  const sentences = canvasSentences(script);
  let last: { sentence: number; text: string } | null = null;
  for (const eq of spokenEquations(script)) {
    if (!normalizeMath(eq.text) || spokenIsWritten(eq.text, writtenNow())) continue;
    if (completeStartedLine(stage, eq, text, added)) {
      last = eq;
      added++;
      continue;
    }
    const ids = equationTerms(eq.text).map((term, k) => {
      const id = `said-${eq.sentence}-${added}-${k}`;
      const tex = plainTex(term);
      stage.tokens.push(tex ? { id, text: term, tex } : { id, text: term });
      text.set(id, term);
      return id;
    });
    if (!ids.length) continue;
    const step = stage.steps.find((st) => st.s === eq.sentence);
    // The statement completes the line already there ("B = sin⁻¹(5 ÷ 14)" → "… ≈ 20.9°"): it replaces it.
    const rowOf = (st: EquationStage["steps"][number]) => normalizeMath(st.order.map((id) => text.get(id) ?? "").join(""));
    const unfinished = step && rowOf(step) && normalizeMath(eq.text).startsWith(rowOf(step));
    if (step && unfinished) {
      step.order = ids;
    } else if (step) {
      // Joined as Aria joins them ("x = 1/2 or x = −3"), else by a comma.
      const said = sentences[eq.sentence] ?? "";
      const between = last && last.sentence === eq.sentence ? said.slice(said.indexOf(last.text) + last.text.length, said.indexOf(eq.text)) : "";
      const word = /^\W*(or|and)\W*$/i.exec(between.trim())?.[1]?.toLowerCase();
      const sep = `said-${eq.sentence}-${added}-sep`;
      stage.tokens.push(word ? { id: sep, text: word, tex: `\\quad\\text{${word}}\\quad` } : { id: sep, text: ",", tex: ",\\quad" });
      text.set(sep, word ?? ",");
      // In the order Aria says them: "into S = n(a + l) ÷ 2, giving S = 10(7 + 43) ÷ 2 = 250" put the
      // formula AFTER the substitution it came before (maths benchmark, 2026-10-21).
      const before = clauseSaidAfter(step.order, text, eq, said);
      step.order = before === undefined ? [...step.order, sep, ...ids] : [...step.order.slice(0, before), ...ids, sep, ...step.order.slice(before)];
    } else {
      stage.steps.push({ s: eq.sentence, order: ids, highlight: [] });
      stage.steps.sort((a, b) => a.s - b.s);
    }
    last = eq;
    added++;
  }
  return added;
}

/**
 * Where in a row a newly said equation belongs: at its start (0) when Aria says it before the row's
 * first clause, else undefined — added at the end, never into the middle of "x − 2 = 0 or x − 3 = 0".
 */
function clauseSaidAfter(order: string[], text: Map<string, string>, eq: { text: string }, said: string): number | undefined {
  const saidNorm = normalizeMath(spokenMaths(said));
  const end = order.findIndex((id) => /^(?:,|;|and|or)$/.test((text.get(id) ?? "").trim()));
  const first = normalizeMath(order.slice(0, end < 0 ? order.length : end).map((id) => text.get(id) ?? "").join(""));
  const eqAt = saidNorm.indexOf(normalizeMath(eq.text));
  const firstAt = first.includes("=") ? saidNorm.indexOf(first) : -1;
  return eqAt >= 0 && firstAt > eqAt ? 0 : undefined;
}

/**
 * WORDS ARE NOT WORKING. A writer's word token on a row of maths ("Arithmetic series", carried on every
 * row before the equations Aria says; maths benchmark, 2026-10-21) is taken off: a clause of only words
 * beside clauses with an "=", and then a step left with words only, when the board has maths. A word
 * equation ("glucose + oxygen → carbon dioxide + water") is one clause with its operators: untouched.
 */
export function dropWordClauses(stage: EquationStage): number {
  const text = new Map(stage.tokens.map((t) => [t.id, t.text.trim()]));
  const hosted = new Set(stage.tokens.filter((t) => t.on).map((t) => t.id));
  const SEP = /^(?:,|;|and|or|so|then)$/;
  const words = (ids: string[]) => ids.length > 0 && ids.every((id) => /^\p{L}[\p{L}\s'’-]*$/u.test(text.get(id) ?? "") && !/^(?:[a-zA-Z]|sin|cos|tan|log|ln|lim)$/.test(text.get(id) ?? ""));
  const isMaths = (ids: string[]) => ids.some((id) => /^[=≈<>≤≥]$/.test(text.get(id) ?? "") || /[=≈]/.test(text.get(id) ?? ""));
  let dropped = 0;
  for (const step of stage.steps) {
    const clauses: Array<{ ids: string[]; sep?: string }> = [{ ids: [] }];
    for (const id of step.order) {
      if (SEP.test(text.get(id) ?? "") && !hosted.has(id)) { clauses[clauses.length - 1].sep = id; clauses.push({ ids: [] }); }
      else clauses[clauses.length - 1].ids.push(id);
    }
    if (!clauses.some((c) => isMaths(c.ids))) continue;
    const kept = clauses.filter((c) => !words(c.ids.filter((id) => !hosted.has(id))) || isMaths(c.ids));
    if (kept.length === clauses.length) continue;
    dropped += clauses.length - kept.length;
    step.order = kept.flatMap((c, i) => [...c.ids, ...(i < kept.length - 1 && c.sep ? [c.sep] : [])]);
  }
  // A phrase that is no operator's operand ("A(2, 1), B(5, 7), C(8, 13)" followed by "AB and AC",
  // nothing between them; maths benchmark V4) is a label, not working. A word equation's terms sit
  // between operators ("glucose + oxygen → carbon dioxide + water") and stay.
  const OP = /^(?:[=≈<>≤≥+\-−–×÷*/→⇌]|\\to)$/;
  if (stage.steps.some((st) => isMaths(st.order))) {
    for (const step of stage.steps) {
      const row = step.order.filter((id) => !hosted.has(id));
      const keep = step.order.filter((id) => {
        if (hosted.has(id)) return true;
        const t = text.get(id) ?? "";
        if (!/\s/.test(t) || !words([id])) return true;
        const k = row.indexOf(id);
        // Alone on its row it is a word step, handled below; beside an operator it is a term.
        return row.length === 1 || [row[k - 1], row[k + 1]].some((n) => n && OP.test(text.get(n) ?? ""));
      });
      if (keep.length && keep.length < step.order.length) {
        dropped += step.order.length - keep.length;
        step.order = keep;
      }
    }
  }
  // A step left with words only, on a board of maths, goes; its caption passes to the step before.
  if (stage.steps.some((st) => isMaths(st.order))) {
    stage.steps = stage.steps.filter((st, i, all) => {
      if (isMaths(st.order) || !words(st.order.filter((id) => !hosted.has(id)))) return true;
      const prev = all[i - 1];
      if (prev && !prev.caption && st.caption) prev.caption = st.caption;
      dropped++;
      return false;
    });
  }
  return dropped;
}

/**
 * A line the writer began with the same working on its right ("P(A ∩ D) = 0.60 × 0.02", said as
 * "P(A and defect) = 0.60 × 0.02 = 0.012") is finished with the part Aria says next ("= 0.012") —
 * not written a second time beside itself (maths benchmark, 2026-10-21). True when it did that.
 */
function completeStartedLine(stage: EquationStage, eq: { sentence: number; text: string }, text: Map<string, string>, added: number): boolean {
  const step = stage.steps.find((st) => st.s === eq.sentence);
  if (!step) return false;
  const terms = equationTerms(eq.text);
  const firstEq = terms.indexOf("=");
  if (firstEq < 1) return false;
  // The row's clauses, split at its separators.
  const clauses: string[][] = [[]];
  for (const id of step.order) {
    if (/^(?:,|;|and|or)$/.test((text.get(id) ?? "").trim())) clauses.push([]);
    else clauses[clauses.length - 1].push(id);
  }
  for (const clause of clauses) {
    const row = normalizeMath(clause.map((id) => text.get(id) ?? "").join(""));
    const rhs = row.slice(row.indexOf("=") + 1);
    if (!row.includes("=") || !/[-+*/×÷^]/.test(rhs)) continue;
    // The spoken right side, term by term, until it matches the row's: what follows is missing.
    for (let k = firstEq + 1; k < terms.length - 1; k++) {
      if (normalizeMath(terms.slice(firstEq + 1, k + 1).join("")) !== rhs) continue;
      const tail = terms.slice(k + 1);
      if (!/^[=≈]$/.test(tail[0] ?? "")) return false;
      const ids = tail.map((term, j) => {
        const id = `said-${eq.sentence}-${added}-${j}`;
        const tex = plainTex(term);
        stage.tokens.push(tex ? { id, text: term, tex } : { id, text: term });
        text.set(id, term);
        return id;
      });
      const at = step.order.indexOf(clause[clause.length - 1]) + 1;
      step.order = [...step.order.slice(0, at), ...ids, ...step.order.slice(at)];
      return true;
    }
  }
  return false;
}

/**
 * WRONG WORKING IS NEVER SHIPPED. A line the narration's own answer makes false ("b = 6 × sin 72°"
 * where Aria says b = 6 sin 72° ÷ sin 35° = 9.95; maths benchmark, 2026-10-21) is taken off the board:
 * its clause from a row of several, or the whole step — never the board's only step. Run after
 * writeSpokenEquations, so the line Aria says is already there. Returns how many it removed.
 */
export function dropFalseWorking(stage: EquationStage, script: string): number {
  const text = new Map(stage.tokens.map((t) => [t.id, t.text.trim()]));
  let dropped = 0;
  for (let guard = 0; guard < 6; guard++) {
    const bad = falseClauses(stage, script)[0];
    if (!bad) break;
    const step = stage.steps[bad.step];
    // The row as clauses of token ids, split where the checker splits it.
    const clauses: string[][] = [[]];
    const seps: string[] = [];
    for (const id of step.order) {
      if (/^(?:,|;|and|or|so|then|therefore|gives)$/.test(text.get(id) ?? "")) { seps.push(id); clauses.push([]); }
      else clauses[clauses.length - 1].push(id);
    }
    const at = clauses.findIndex((c) => c.map((id) => text.get(id) ?? "").join(" ").trim() === bad.clause);
    if (at < 0) break;
    if (clauses.filter((c) => c.length).length > 1) {
      const keep = clauses.flatMap((c, i) => (i === at ? [] : [...(i > 0 && i - 1 !== at - 1 && seps[i - 1] ? [seps[i - 1]] : []), ...c]));
      step.order = keep[0] && /^(?:,|;|and|or|so)$/.test(text.get(keep[0]) ?? "") ? keep.slice(1) : keep;
    } else if (stage.steps.length > 1) stage.steps.splice(bad.step, 1);
    else break;
    dropped++;
  }
  return dropped;
}

/**
 * A PROOF EARNS ITS RESULT. "x + y = 90°" (caption "We aim to prove x + y = 90°") was the first row of
 * the working, and the step that later derives it — the same tokens — only lit that top row: the board
 * stated the result before proving it (maths benchmark, 2026-10-21). A first row that the working
 * reaches again later, stated as the aim, is taken off; the later step then writes it in its place.
 * Returns true when it removed one.
 */
export function dropGoalRow(stage: EquationStage, script = ""): boolean {
  if (stage.steps.length < 3) return false;
  const text = new Map(stage.tokens.map((t) => [t.id, t.text]));
  const rowOf = (order: string[]) => normalizeMath(order.map((id) => text.get(id) ?? "").join(""));
  const [first, ...rest] = stage.steps;
  const row = rowOf(first.order);
  if (!row.includes("=")) return false;
  // Reached by a later row, or stated by Aria on a later sentence ("… so angle ACB equals 90 degrees"):
  // then it is written there, where it is proved.
  const reached = rest.some((st) => rowOf(st.order) === row || (st.order.length >= first.order.length && first.order.every((id) => st.order.includes(id))))
    || spokenEquations(script).some((e) => e.sentence > first.s && normalizeMath(e.text) === row);
  const said = canvasSentences(script)[first.s] ?? "";
  const aim = /\b(aim|goal|prove|show that|want to show|target|we will show)\b/i;
  if (!reached || !(aim.test(first.caption ?? "") || aim.test(said))) return false;
  stage.steps = rest;
  return true;
}

/**
 * EVERY STEP IS MATHS. "Tree routes", "One route", "Event total" were written as steps of an equation
 * board (maths benchmark, 2026-10-21). A step that writes only words, with a maths step after it, is
 * taken off; its words become that step's caption when it has none. Returns how many it removed.
 */
export function dropWordSteps(stage: EquationStage): number {
  const text = new Map(stage.tokens.map((t) => [t.id, t.text.trim()]));
  // Limits with nothing to belong to ("3x² + 2", "₁³" — an integral's bounds without its sign) say
  // nothing: taken out of the row (maths benchmark, 2026-10-21).
  for (const st of stage.steps) {
    if (st.order.length > 1) st.order = st.order.filter((id) => !/^[₀-₉⁰-⁹¹²³⁻₋]+$/.test(text.get(id) ?? ""));
  }
  const isWords = (st: EquationStage["steps"][number]) => {
    const row = st.order.map((id) => text.get(id) ?? "").join(" ").trim();
    return Boolean(row) && !/[0-9=≠≈<>+\-−×÷/^√π²³()]/.test(row) && !/(?:^|\s)[a-zA-Zα-ω](?:\s|$)/.test(row) && /[A-Za-z]{3,}/.test(row);
  };
  let dropped = 0;
  for (let i = 0; i < stage.steps.length - 1; i++) {
    const st = stage.steps[i];
    if (!isWords(st)) continue;
    const next = stage.steps.slice(i + 1).find((x) => !isWords(x));
    if (!next) break;
    if (!next.caption) next.caption = st.order.map((id) => text.get(id) ?? "").join(" ").trim().slice(0, 50);
    stage.steps.splice(i, 1);
    i--;
    dropped++;
  }
  return dropped;
}

/**
 * A BROKEN LINE IS NEVER SHIPPED. "3log₂8 = × 3 = 9" (a term lost, two operators side by side) went
 * out after three rewrites (maths benchmark, 2026-10-21). Its clause is taken off the row — or the whole
 * step when that was all it wrote and another step remains. Run after writeSpokenEquations, which has
 * written the line Aria says. Returns how many it removed.
 */
export function dropBrokenClauses(stage: EquationStage): number {
  const text = new Map(stage.tokens.map((t) => [t.id, t.text.trim()]));
  const SEP = /^(?:,|;|and|or|so|then|therefore|gives)$/;
  const OP = /^[+×÷=*/·]$/;
  let dropped = 0;
  for (let i = 0; i < stage.steps.length; i++) {
    const step = stage.steps[i];
    const clauses: string[][] = [[]];
    const seps: string[] = [];
    // Split only outside brackets: "(5 − 2, 7 − 1)" written with its own comma is one term.
    let level = 0;
    for (const id of step.order) {
      const t = text.get(id) ?? "";
      if (level === 0 && SEP.test(t)) { seps.push(id); clauses.push([]); continue; }
      clauses[clauses.length - 1].push(id);
      for (const ch of t) level = Math.max(0, level + (ch === "(" ? 1 : ch === ")" ? -1 : 0));
    }
    // Also a line that starts on "=" or leaves a bracket open ("S₂₀ = 20 ( 6 + 82", ", = 2 × 34° = 68°";
    // maths benchmark round 1).
    const depth = (c: string[]) => c.map((id) => text.get(id) ?? "").join("").split("").reduce((d, ch) => d + (ch === "(" ? 1 : ch === ")" ? -1 : 0), 0);
    // A line that starts on "×", "÷" or "+" is the tail of one cut in two ("× 72π = 24π" under
    // "V = ⅓ × π", "× numerator derivative"; maths benchmark R9).
    const broken = (c: string[]) => c.some((id, k) => k > 0 && OP.test(text.get(c[k - 1]) ?? "") && OP.test(text.get(id) ?? "")) || (c.length > 0 && /^[=≈+×÷·*/]/.test(text.get(c[0]) ?? "")) || depth(c) !== 0
      // A sign alone ("≠" as a whole row; maths benchmark round 2), or a line that ends on one
      // ("(1 + x)ⁿ = 1 +"; round 3).
      || (c.length === 1 && /^[=≈≠<>≤≥+×÷·*/−-]$/.test(text.get(c[0]) ?? ""))
      || (c.length > 1 && /^[=≈≠<>≤≥+×÷·*/−-]$/.test(text.get(c[c.length - 1]) ?? ""));
    if (!clauses.some(broken)) continue;
    const keep = clauses.filter((c) => c.length && !broken(c));
    if (keep.length) {
      step.order = keep.flatMap((c, k) => (k > 0 ? [seps[0] ?? c[0], ...c] : c)).filter((id, k, all) => !(SEP.test(text.get(id) ?? "") && (k === 0 || k === all.length - 1)));
      dropped++;
    } else if (stage.steps.length > 1) {
      stage.steps.splice(i, 1);
      i--;
      dropped++;
    }
  }
  return dropped;
}

/**
 * A GIVEN COMES BEFORE ITS USE. "∠AOB = 2 × ∠ACB = 68°" was written above "∠ACB = 34°" on the same
 * sentence (maths benchmark round 1): a step that only states a value ("∠ACB = 34°", "a = 7") moves
 * above the step of its sentence that uses it. Returns how many it moved.
 */
export function givensFirst(stage: EquationStage): number {
  const text = new Map(stage.tokens.map((t) => [t.id, t.text]));
  const rowOf = (order: string[]) => order.map((id) => text.get(id) ?? "").join(" ").replace(/\s+/g, " ").trim();
  let moved = 0;
  for (let j = 1; j < stage.steps.length; j++) {
    const given = /^(∠[A-Z]{3}|[A-Za-z][₀-₉]?)\s*=\s*[-−]?\d+(?:\.\d+)?\s*°?$/.exec(rowOf(stage.steps[j].order));
    if (!given) continue;
    const name = given[1];
    const i = stage.steps.findIndex((st, k) => k < j && st.s === stage.steps[j].s && rowOf(st.order).includes(name));
    if (i < 0) continue;
    const [step] = stage.steps.splice(j, 1);
    stage.steps.splice(i, 0, step);
    moved++;
  }
  return moved;
}

/**
 * ONE LINE, WRITTEN ONCE. "first × derivative of second + second × derivative of first" was written
 * three times on one product-rule board (owner's derivatives lecture, 2026-10-22). A row, or a clause
 * of one, that repeats another goes; the copy kept is the one on the sentence that says it, else the
 * first. Returns how many copies it removed.
 */
export function dropRepeatedRows(stage: EquationStage, script: string): number {
  const text = new Map(stage.tokens.map((t) => [t.id, t.text.trim()]));
  const SEP = /^(?:,|;|and|or|so|then|gives)$/;
  // Operators said as words count as written ones ("first times derivative of second plus …").
  const words = (t: string) => t.replace(/\btimes\b/gi, "×").replace(/\bplus\b/gi, "+").replace(/\bminus\b/gi, "−").replace(/\bdivided by\b/gi, "÷");
  const flat = (t: string) => normalizeMath(spokenMaths(words(t))).replace(/÷/g, "/");
  const said = canvasSentences(script).map(flat);
  const rows = stage.steps.map((st) => {
    const clauses: Array<{ ids: string[]; sep?: string }> = [{ ids: [] }];
    let level = 0;
    for (const id of st.order) {
      const t = text.get(id) ?? "";
      if (level === 0 && SEP.test(t)) { clauses[clauses.length - 1].sep = id; clauses.push({ ids: [] }); continue; }
      clauses[clauses.length - 1].ids.push(id);
      for (const ch of t) level = Math.max(0, level + (ch === "(" ? 1 : ch === ")" ? -1 : 0));
    }
    return clauses.filter((c) => c.ids.length);
  });
  const key = (c: { ids: string[] }) => flat(c.ids.map((id) => text.get(id) ?? "").join(" "));
  const where = new Map<string, Array<{ row: number; clause: number }>>();
  rows.forEach((cs, r) => cs.forEach((c, k) => {
    const id = key(c);
    if (id.length >= 3) where.set(id, [...(where.get(id) ?? []), { row: r, clause: k }]);
  }));
  const gone = new Set<string>();
  for (const [id, at] of where) {
    if (at.length < 2) continue;
    const keep = at.find((a) => (said[stage.steps[a.row].s] ?? "").includes(id)) ?? at[0];
    for (const a of at) if (a !== keep) gone.add(`${a.row}:${a.clause}`);
  }
  if (!gone.size) return 0;
  const steps: EquationStage["steps"] = [];
  rows.forEach((cs, r) => {
    const kept = cs.filter((_, k) => !gone.has(`${r}:${k}`));
    if (!kept.length) return;
    const order = kept.flatMap((c, k) => (k < kept.length - 1 ? [...c.ids, c.sep ?? cs.find((x) => x.sep)?.sep ?? ""] : c.ids)).filter(Boolean);
    steps.push({ ...stage.steps[r], order });
  });
  if (!steps.length) return 0;
  stage.steps = steps;
  return gone.size;
}

/**
 * NOTHING IS WRITTEN BEFORE IT IS SAID. Reviewers marked "the answer is written above its working"
 * on most maths boards (maths benchmark R5–R6): the writer timed the result with an early sentence,
 * so it appeared, top of the board, before the lines that reach it. A row Aria states in a later
 * sentence — and in none up to the one it is timed to — is written when she says it; rows stay in the
 * order they are written, so that answer drops below its working. Returns how many rows moved.
 */
export function revealWhenSaid(stage: EquationStage, script: string): number {
  const unitless = (s: string) => s.replace(/(\d)(?:cm|mm|km|kg|ml|m|g|s|l)(?:\^?[23])?(?![a-z])/g, "$1");
  const said = spokenEquations(script).map((e) => ({ sentence: e.sentence, eq: unitless(normalizeMath(e.text)) })).filter((e) => e.eq.includes("="));
  if (!said.length) return 0;
  const text = new Map(stage.tokens.map((t) => [t.id, t.text]));
  // A row's clauses ("…, …", "… so …", "… → …"); a said equation is in one when it is the whole clause
  // or runs between its "=" signs ("36+64=100" in "36+64=100=c^2"), never inside a number ("x=1" in "x=12").
  const clauses = (order: string[]) => unitless(normalizeMath(order.map((id) => text.get(id) ?? "").join(" "))).split(/,|→|so|therefore|hence/).filter(Boolean);
  const holds = (clause: string, eq: string) => {
    for (let i = clause.indexOf(eq); i >= 0; i = clause.indexOf(eq, i + 1)) {
      if ((i === 0 || clause[i - 1] === "=") && (i + eq.length === clause.length || clause[i + eq.length] === "=")) return true;
    }
    return false;
  };
  let moved = 0;
  for (const step of stage.steps) {
    const own = clauses(step.order);
    const when = said.filter((e) => own.some((c) => holds(c, e.eq))).map((e) => e.sentence);
    if (!when.length || when.some((s) => s <= step.s)) continue;
    step.s = Math.min(...when);
    moved++;
  }
  if (moved) stage.steps = stage.steps.map((st, i) => ({ st, i })).sort((a, b) => a.st.s - b.st.s || a.i - b.i).map(({ st }) => st);
  return moved;
}

/**
 * WRONG ARITHMETIC NEVER SHIPS. "6 + 10 + 14 + 18 + 22 = 5 terms …" and "6! ÷ 2! × 4! = 15" reached a
 * board (maths benchmark round 2): a clause whose arithmetic the number check proves false is taken
 * off — the line Aria says is already written by then (writeSpokenEquations) — and a step left with
 * nothing goes, never the board's only one. Returns how many clauses it removed.
 */
export function dropWrongArithmetic(stage: EquationStage): number {
  const text = new Map(stage.tokens.map((t) => [t.id, t.text.trim()]));
  const SEP = /^(?:,|;|and|or|so|then|therefore|gives)$/;
  let dropped = 0;
  for (let i = 0; i < stage.steps.length; i++) {
    const step = stage.steps[i];
    const clauses: Array<{ ids: string[]; sep?: string }> = [{ ids: [] }];
    let level = 0;
    for (const id of step.order) {
      const t = text.get(id) ?? "";
      if (level === 0 && SEP.test(t)) { clauses[clauses.length - 1].sep = id; clauses.push({ ids: [] }); continue; }
      clauses[clauses.length - 1].ids.push(id);
      for (const ch of t) level = Math.max(0, level + (ch === "(" ? 1 : ch === ")" ? -1 : 0));
    }
    const wrong = (c: { ids: string[] }) => c.ids.length > 0 && (checkNumbers(c.ids.map((id) => text.get(id) ?? "").join(" ")).length > 0 || falseNumberChain(c.ids.map((id) => text.get(id) ?? "").join(" ")));
    if (!clauses.some(wrong)) continue;
    const keep = clauses.filter((c) => c.ids.length && !wrong(c));
    dropped += clauses.length - keep.length;
    if (keep.length) step.order = keep.flatMap((c, k) => [...c.ids, ...(k < keep.length - 1 && c.sep ? [c.sep] : [])]);
    else if (stage.steps.length > 1) { stage.steps.splice(i, 1); i--; }
  }
  return dropped;
}

/** A false expansion ("(1 + x) = (1 + x)(1 + x)"; equationCheck.ts falseIdentities) is taken off its row. */
export function dropFalseIdentities(stage: EquationStage, script: string): number {
  const bad = falseIdentities(stage, script);
  if (!bad.length) return 0;
  const text = new Map(stage.tokens.map((t) => [t.id, t.text.trim()]));
  const SEP = /^(?:,|;|and|or|so|then|gives)$/;
  let dropped = 0;
  for (let i = stage.steps.length - 1; i >= 0; i--) {
    const wrong = new Set(bad.filter((b) => b.step === i).map((b) => b.clause.replace(/\s+/g, " ")));
    if (!wrong.size) continue;
    const step = stage.steps[i];
    const clauses: Array<{ ids: string[]; sep?: string }> = [{ ids: [] }];
    for (const id of step.order) {
      if (SEP.test(text.get(id) ?? "")) { clauses[clauses.length - 1].sep = id; clauses.push({ ids: [] }); }
      else clauses[clauses.length - 1].ids.push(id);
    }
    const isBad = (c: { ids: string[] }) => wrong.has(c.ids.map((id) => text.get(id) ?? "").join(" ").replace(/\s+/g, " ").trim());
    const keep = clauses.filter((c) => c.ids.length && !isBad(c));
    if (keep.length === clauses.filter((c) => c.ids.length).length) continue;
    dropped += 1;
    if (keep.length) step.order = keep.flatMap((c, k) => [...c.ids, ...(k < keep.length - 1 && c.sep ? [c.sep] : [])]);
    else if (stage.steps.length > 1) stage.steps.splice(i, 1);
  }
  return dropped;
}


/**
 * Number sides that disagree: "29 = 40 − 29 = 11" (a chain that says 29 = 11) and "1 ≠ 1" (maths
 * benchmark round 3). Every side made only of numbers is evaluated; a chain is false when two differ, a
 * "≠" when its two sides are equal.
 */
export function falseNumberChain(clause: string): boolean {
  const numeric = (side: string) => /^[\s\d.()+\-−–×÷*/^²³√π!]+$/.test(side) && /\d/.test(side);
  const value = (side: string) => evalExpr(toExpr(side.trim()), {});
  if (/≠/.test(clause)) {
    const [a, b] = clause.split("≠");
    const sideA = (a ?? "").split(/=/).pop() ?? "", sideB = (b ?? "").split(/=/)[0] ?? "";
    if (numeric(sideA) && numeric(sideB)) {
      const va = value(sideA), vb = value(sideB);
      if (Number.isFinite(va) && Number.isFinite(vb) && Math.abs(va - vb) < 1e-9) return true;
    }
  }
  const sides = clause.split(/[=≈]/).map((x) => x.trim()).filter(Boolean);
  const vals = sides.filter(numeric).map(value).filter(Number.isFinite);
  if (vals.length < 2 || /≈/.test(clause)) return false;
  return vals.some((v) => Math.abs(v - vals[0]) > 1e-6 * Math.max(1, Math.abs(vals[0])));
}

/**
 * A ROW NEVER STARTS OR ENDS ON A JOINING WORD OR COMMA: "gives 2 − 5 = −3 ," and "y = 2x + 1 ," (maths
 * benchmark round 3: rows split from a chain kept their joins). Returns how many it trimmed.
 */
export function trimRowJoins(stage: EquationStage): number {
  const text = new Map(stage.tokens.map((t) => [t.id, t.text.trim()]));
  const JOIN = /^(?:,|;|and|or|so|then|therefore|gives|giving|which gives)$/i;
  let trimmed = 0;
  for (const step of stage.steps) {
    const before = step.order.length;
    while (step.order.length > 1 && JOIN.test(text.get(step.order[0]) ?? "")) step.order.shift();
    while (step.order.length > 1 && JOIN.test(text.get(step.order[step.order.length - 1]) ?? "")) step.order.pop();
    if (step.order.length !== before) trimmed++;
  }
  return trimmed;
}
