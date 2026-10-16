import { evalExpr } from "./expr";

/**
 * WORKED NUMBERS, CHECKED BY CODE. A lecture once taught "a = −(8π)²(0.060) = −121 m s⁻²" (it is
 * −37.9) and its quiz marked that as the correct answer (audit 2026-10-15): nothing evaluated a
 * number. Language models are unreliable at arithmetic written in prose; executing it is not
 * (PAL / Program-of-Thoughts). This finds every "<calculation> = <number>" a student will read or
 * hear — "(10π)²(0.0566) = 56", "4.0√(0.120² − 0.072²) = 0.384", "12/6.0 = 2.0" — recomputes the
 * left side with the safe evaluator (lib/canvas/expr.ts), and reports any that disagree.
 *
 * Only calculations made purely of numbers are judged (a side with a variable — "1/f" — is left
 * alone), so a correct board is never flagged for algebra the checker cannot evaluate.
 */
export type NumberIssue = { calculation: string; stated: number; computed: number };

const SUPER: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-" };

/** Calculation as printed → the evaluator's syntax ("(8π)²(0.060)" → "(8*pi)^(2)*(0.060)"). */
export function toExpr(printed: string): string {
  let s = printed
    .replace(/[−–]/g, "-")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/(\d+(?:\.\d+)?)\s*°/g, "($1*pi/180)")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => `^(${[...m].map((c) => SUPER[c]).join("")})`)
    .replace(/π/g, " pi ")
    .replace(/√\s*\(/g, "sqrt(")
    .replace(/√\s*(\d+(?:\.\d+)?)/g, "sqrt($1)");
  // Implied multiplication: ")(", "2(", ")3", "2 pi", "pi 2", "pi(", ")pi", "2 sqrt(", ")sin(".
  for (let i = 0; i < 3; i++) {
    s = s
      .replace(/\)\s*\(/g, ")*(")
      .replace(/(\d)\s*\(/g, "$1*(")
      .replace(/\)\s*(\d)/g, ")*$1")
      .replace(/(\d)\s+pi\b/g, "$1*pi")
      .replace(/(\d)pi\b/g, "$1*pi")
      .replace(/\bpi\s*(\d)/g, "pi*$1")
      .replace(/\bpi\s*\(/g, "pi*(")
      .replace(/\)\s*pi\b/g, ")*pi")
      .replace(/(\d|\))\s*(sqrt|sin|cos|tan|ln|log)\s*\(/g, "$1*$2(");
  }
  s = s.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();
  // A negative exponent written "10^-11" stays one exponent: "^(-11)", not "^-1 × 11".
  s = s.replace(/\^\s*-\s*(\d+(?:\.\d+)?)/g, "^(-$1)");
  // A leading or bracketed minus negates the whole power: "−(10π)²" is −((10π)²), as printed
  // maths means it; the evaluator would square the negative ((−10π)²).
  return s.replace(/(^|[(*/+^,-]\s*)-\s*(?=[\d.(a-z])/g, "$1-1*");
}

const CALC_CHARS = "[\\s\\d.()+\\-−–×*/·÷^°π√⁰¹²³⁴⁵⁶⁷⁸⁹⁻]";
const CALC = new RegExp(`^(?:${CALC_CHARS}|sin|cos|tan|sqrt|ln|log)+$`);
// The stated answer, with its power of ten when written in standard form ("2.00 × 10^-10", "4.1 × 10⁶").
const NUMBER = /^\s*([-−–]?\s*\d[\d,]*(?:\.\d+)?)(?:\s*[×x*·]\s*10\s*(?:\^\s*\(?\s*([-−–]?\s*\d+)\s*\)?|([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)))?/;
const SUPER_DIGITS: Record<string, string> = { "⁻": "-", "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };
const exponentOf = (m: RegExpExecArray) => (m[2] ? Number(m[2].replace(/[−–\s]/g, (c) => (c.trim() ? "-" : ""))) : m[3] ? Number([...m[3]].map((c) => SUPER_DIGITS[c]).join("")) : 0);

/** Every "<pure-number calculation> = | ≈ <number>" in the text, with its computed value. */
export function checkNumbers(text: string): NumberIssue[] {
  const issues: NumberIssue[] = [];
  // Thousands separators ("1,100 + (−150) = 950") are part of the number, not a break in the sum.
  // A currency sign is part of the amount, not a break in the sum: "$42,000 + $2,500 = $45,000" went
  // unchecked, and an accounting test's model answer could be wrong (audit 2026-10-17).
  let t = text.replace(/\\[()[\]]/g, " ").replace(/[$£€¥₹](?=\s?\d)/g, "");
  for (let i = 0; i < 3; i++) t = t.replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
  for (let at = t.search(/[=≈]/); at >= 0; at = nextEq(t, at + 1)) {
    const m = NUMBER.exec(t.slice(at + 1));
    if (!m) continue;
    // "= 0.5π", "= 2x", "= 3√2": the answer is not a plain number, so there is nothing to compare.
    const after = t.slice(at + 1 + m[0].replace(/\s+$/, "").length);
    if (/^(?:[π√a-zA-Zα-ω(])|^\s*[π√]|^\s*[×x*·]\s*[a-zA-Zπ√(]/.test(after) && !/^\s*[×x*·]\s*10\b/.test(after)) continue;
    const exp = exponentOf(m);
    let stated = Number(m[1].replace(/[−–]/g, "-").replace(/[\s,]/g, "")) * 10 ** exp;
    // A chain of working ("4(4) − 7(2) − 2 = 16 − 14 − 2 = 0"): the right side is itself an
    // expression, so its value is what the left must equal — not its first number.
    const chained = /^\s*[+\-−–×*/÷^·]\s*[\d(√π]/.test(after);
    if (chained) {
      const rhs = (m[0] + after).split(/[=≈]/)[0].match(/^[\s\d.()+\-−–×*/·÷^°π√⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/)?.[0] ?? "";
      const value = rhs.trim() ? evalExpr(toExpr(rhs.trim()), {}) : NaN;
      if (!Number.isFinite(value)) continue;
      stated = value;
    }
    if (!Number.isFinite(stated)) continue;
    // The calculation: the longest stretch before "=" made only of numbers, operators and maths
    // functions, starting at a digit, bracket, sign, π or root, and stopping at the previous "=".
    const before = t.slice(Math.max(0, at - 90), at);
    const start = Math.max(before.lastIndexOf("="), before.lastIndexOf("≈")) + 1;
    const tail = before.slice(start);
    let calc = "";
    for (let i = 0; i < tail.length; i++) {
      const cand = tail.slice(i);
      if (/^[\s]*(?:[\d(−–\-π√]|(?:sin|cos|tan|sqrt|ln|log)\b)/.test(cand) && CALC.test(cand)) { calc = cand.trim(); break; }
    }
    // A bare number ("x = 0.060") is a statement, not a calculation.
    if (!calc || !/[+\-−–×*/·÷^√π²³⁰¹⁴⁵⁶⁷⁸⁹(]|sin|cos|tan|sqrt|ln|log/.test(calc.replace(/^[-−–]/, "")) || !/\d/.test(calc)) continue;
    let computed = evalExpr(toExpr(calc), {});
    if (!Number.isFinite(computed)) continue;
    // "420/600 = 70%": a stated percentage is the fraction × 100.
    if (/^\s*%/.test(after)) computed *= 100;
    const ok = chained ? Math.abs(computed - stated) <= Math.max(0.005, Math.abs(stated) * 0.02) : agrees(computed, stated, m[1], exp);
    if (!ok) issues.push({ calculation: `${calc} = ${m[0].trim()}`, stated, computed });
  }
  return issues;
}

function nextEq(t: string, from: number): number {
  const i = t.slice(from).search(/[=≈]/);
  return i < 0 ? -1 : from + i;
}

/** Equal to the precision the number was written to (half a unit in its last digit), or within 2%. */
function agrees(computed: number, stated: number, printed: string, exp = 0): boolean {
  const decimals = (printed.split(".")[1] ?? "").replace(/\D/g, "").length;
  const halfUnit = 0.5 * 10 ** (exp - decimals);
  const tol = Math.max(halfUnit * 1.01, Math.abs(stated) * 0.02);
  return Math.abs(computed - stated) <= tol;
}

/** One line for a model's retry: what is wrong and what the right value is. */
export function numberIssuesText(issues: NumberIssue[]): string {
  return issues.slice(0, 4).map((i) => `"${i.calculation}" is wrong — it evaluates to ${round(i.computed)}`).join("; ");
}

function round(n: number): string {
  const a = Math.abs(n);
  return a !== 0 && (a < 0.001 || a >= 1e6) ? n.toExponential(3) : String(Number(n.toPrecision(4)));
}
