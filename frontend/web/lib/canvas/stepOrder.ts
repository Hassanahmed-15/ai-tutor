import type { EquationStage, EquationStep } from "./types";

/**
 * WORKING IS WRITTEN IN SOLVING ORDER, THE ANSWER LAST (QA 2026-11-28: a "Recognizing Solution Types" board wrote
 * "x = 3" ABOVE "2x + 3 = 9 → 2x = 6"). The writer often gives one sentence several steps ("subtracting 3 and dividing
 * by 2 gives x = 3") and lists them in any order, and the "given before its use" repair (equationRepair givensFirst)
 * took the answer for a given. Within the steps of one sentence:
 *   - a step its caption calls the start ("Start with …", "Begin with …") goes first;
 *   - a solved line — a letter alone equal to a number ("x = 3", "y = −2.5", "k = 3/4") — goes after every line of
 *     that sentence that is still an equation in that letter alone (the working that reaches it).
 * Steps of different sentences never swap, nothing is added or dropped, and a step's own `at` times stay in
 * order (the moved steps take the sentence's times in their new order). Pure (lib/anim/stepOrder.test.ts).
 */

const FUNCTIONS = /\b(?:sin|cos|tan|cot|sec|csc|log|ln|exp|sqrt|lim|max|min|mod)\b/gi;
const SOLVED = /^\s*([A-Za-z])\s*=\s*[-−]?\s*\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?\s*$/;
const STARTS = /^\s*(?:start(?:ing)?|begin(?:ning)?)\b/i;

/** The single-letter unknowns of a line of working, or null when it is written in words (a label, not working). */
export function rowLetters(text: string): Set<string> | null {
  if (/\\text\{/.test(text)) return null;
  const plain = text.replace(/\\[a-z]+/gi, " ").replace(FUNCTIONS, " ");
  // Letters run together are a word or a unit ("cost", "cm", "or"): not a line of working in one unknown.
  if (/[A-Za-z]{2,}/.test(plain)) return null;
  return new Set(plain.match(/[A-Za-z]/g) ?? []);
}

/** The letter a solved line gives a value to ("x" for "x = 3"), else null. */
export function solvedLetter(text: string): string | null {
  return SOLVED.exec(text)?.[1] ?? null;
}

/** A step's line as text, from its tokens (hosted labels left out). */
function lineOf(stage: EquationStage, step: EquationStep): string {
  const tokens = new Map(stage.tokens.map((t) => [t.id, t]));
  return step.order.map((id) => tokens.get(id)).filter((t) => t && !t.on).map((t) => t!.text).join(" ").replace(/\s+/g, " ").trim();
}

/** The steps of one sentence put in solving order (see above). */
function orderGroup(stage: EquationStage, group: EquationStep[]): EquationStep[] {
  const out = [...group];
  const line = (st: EquationStep) => lineOf(stage, st);
  // The start first.
  const start = out.findIndex((st, k) => k > 0 && STARTS.test(st.caption ?? ""));
  if (start > 0) out.unshift(...out.splice(start, 1));
  // Each answer after the working that reaches it. Moving one never moves another past it twice: each answer is
  // looked at once, in the order the writer gave them.
  for (const answer of group) {
    const v = solvedLetter(line(answer));
    if (!v) continue;
    const at = out.indexOf(answer);
    let last = -1;
    out.forEach((st, k) => {
      if (k <= at || st === answer) return;
      const own = line(st);
      if (solvedLetter(own) === v) return;
      const letters = rowLetters(own);
      if (own.includes("=") && letters && letters.size === 1 && letters.has(v)) last = k;
    });
    if (last > at) {
      out.splice(at, 1);
      out.splice(last, 0, answer);
    }
  }
  return out;
}

/** The stage's steps in solving order; the same stage back when nothing moves. */
export function inSolvingOrder(stage: EquationStage): EquationStage {
  if (stage.steps.length < 2) return stage;
  const steps: EquationStep[] = [];
  let moved = false;
  for (let i = 0; i < stage.steps.length; ) {
    let j = i + 1;
    while (j < stage.steps.length && stage.steps[j].s === stage.steps[i].s) j++;
    const group = stage.steps.slice(i, j);
    const ordered = group.length > 1 ? orderGroup(stage, group) : group;
    if (ordered.some((st, k) => st !== group[k])) {
      moved = true;
      // The sentence's own times, in order, go to the steps in their new order.
      const times = group.map((st) => st.at).filter((a): a is number => a !== undefined).sort((a, b) => a - b);
      steps.push(...(times.length === group.length ? ordered.map((st, k) => ({ ...st, at: times[k] })) : ordered));
    } else steps.push(...group);
    i = j;
  }
  return moved ? { ...stage, steps } : stage;
}
