import type { EquationStage } from "./types";

/**
 * A LIVING EQUATION'S STEPS COME WHEN ARIA SAYS THEM (owner, 2026-11-11: "the right-hand equation changes too
 * quickly … not really synced; sometimes it never shows up, Aria only speaks"). The board writer often put
 * every step on one sentence — the last, sometimes — so the equation was empty while she worked it out and
 * then flashed through its steps at the end. Each step is moved to the sentence that says the numbers it
 * brings (never later than the writer put it, never before the step before it), and given where in that
 * sentence they are said. Pure (lib/anim/livingTiming.test.ts).
 */
const NUMBER = /\d+(?:\.\d+)?/g;

const numbersOf = (text: string) => [...text.matchAll(NUMBER)].map((m) => m[0]);

export function retimeLivingSteps(stage: EquationStage, sentences: string[]): EquationStage {
  const text = new Map(stage.tokens.map((t) => [t.id, t.text]));
  const shared = new Map<number, number>();
  for (const st of stage.steps) shared.set(st.s, (shared.get(st.s) ?? 0) + 1);
  /** Where in sentence i the numbers are said (−1: none), and how many of them it says. */
  const where = (i: number, wanted: string[]) => {
    const said = sentences[i] ?? "";
    const hits = wanted.map((n) => said.search(new RegExp(`(?<![\\d.])${n.replace(".", "\\.")}(?![\\d])`))).filter((k) => k >= 0);
    return { at: hits.length ? Math.min(...hits) / Math.max(1, said.length) : -1, count: hits.length };
  };
  let floor = 0;
  const before = new Set<string>();
  const steps = stage.steps.map((step) => {
    // The numbers this step brings that no earlier step showed ("100", not the "64" it adds up again).
    const fresh = step.order.filter((id) => !before.has(id)).flatMap((id) => numbersOf(text.get(id) ?? ""));
    const earlier = new Set([...before].flatMap((id) => numbersOf(text.get(id) ?? "")));
    const wanted = [...new Set(fresh.filter((n) => !earlier.has(n)))].sort((a, b) => b.length - a.length);
    step.order.forEach((id) => before.add(id));
    const own = Math.max(floor, Math.min(step.s, sentences.length - 1));
    let s = own, at = wanted.length ? where(own, wanted).at : -1;
    // Only a step that shares its sentence with others moves: the writer bunched them there. It goes to the
    // earliest sentence that says the most of its numbers — at least two of them, when it brings two or more,
    // so one number said in passing does not pull it early.
    if (wanted.length && (shared.get(step.s) ?? 0) > 1) {
      let best = { i: own, ...where(own, wanted) };
      for (let i = floor; i < own; i++) {
        const k = where(i, wanted);
        if (k.count > best.count || (k.count === best.count && k.count > 0 && i < best.i)) best = { i, ...k };
      }
      if (best.i !== own && best.count >= Math.min(2, wanted.length)) { s = best.i; at = best.at; }
    }
    floor = s;
    return { ...step, s, ...(at >= 0 ? { at: Math.round(at * 100) / 100 } : {}) };
  });
  return { ...stage, steps };
}

/** When each state comes, as sentence + fraction: given where it is said, else the states of one sentence share it evenly. */
export function stateTimes(steps: Array<{ s: number; at?: number }>): number[] {
  const bySentence = new Map<number, number[]>();
  steps.forEach((st, i) => bySentence.set(st.s, [...(bySentence.get(st.s) ?? []), i]));
  return steps.map((st, i) => {
    if (st.at !== undefined) return st.s + Math.min(0.95, st.at);
    const group = bySentence.get(st.s)!;
    return st.s + (group.indexOf(i) / group.length) * 0.9;
  });
}
