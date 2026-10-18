import { canvasSentences } from "./plan";
import { normalizeMath } from "./equationCheck";
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
  return /[0-9²³⁴()[\]+\-−–×÷·/=^≠≈<>≤≥→⇒]/.test(chunk) || /^[a-zα-ω]$/i.test(c) || UNITS.has(c.toLowerCase())
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
export function joinedEquations(text: string): string[] {
  const eqs = writtenEquations(text);
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
const SUP: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-" };
const SUB: Record<string, string> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" };

/** A plain-text term as LaTeX: "3 m/s²" → "3\,\text{m/s}^{2}", "−5(2)" → "-5(2)", "x²" → "x^{2}". */
export function plainTex(term: string): string {
  const t = term.trim();
  if (OP_TEX[t]) return OP_TEX[t];
  // "lim(h→0)(2x + h)" → \lim_{h \to 0}(2x + h)
  const lim = /^lim\s*\(?\s*([a-zα-ω])\s*(?:→|->)\s*([^)\s]+)\s*\)?\s*(.*)$/i.exec(t);
  if (lim) return `\\lim_{${lim[1]} \\to ${lim[2].replace(/[−–]/g, "-")}}${lim[3] ? plainTex(lim[3]) : ""}`;
  if (t === ",") return ",\\quad";
  if (CONNECTOR.test(t)) return `\\quad\\text{${t}}\\quad`;
  const powers = (s: string) => s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => `^{${[...m].map((c) => SUP[c]).join("")}}`).replace(/[₀₁₂₃₄₅₆₇₈₉]+/g, (m) => `_{${[...m].map((c) => SUB[c]).join("")}}`);
  const unit = /^([−–-]?[\d.,]+)\s+([A-Za-zΩµ°%/]+)([⁰¹²³⁴⁵⁶⁷⁸⁹⁻]*)$/.exec(t);
  if (unit) return `${unit[1].replace(/[−–]/g, "-")}\\,\\text{${unit[2]}}${unit[3] ? powers(unit[3]) : ""}`;
  return powers(t)
    .replace(/[−–]/g, "-")
    .replace(/×/g, "\\times ")
    .replace(/÷/g, "\\div ")
    .replace(/≠/g, "\\neq ")
    .replace(/[A-Za-z]{2,}/g, (w) => (/^(sin|cos|tan|log|ln|exp)$/.test(w) ? `\\${w}` : `\\text{${w}}`));
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
    const fromSentence = [...writtenEquations(said), ...joinedEquations(said)];
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
