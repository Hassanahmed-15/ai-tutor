/**
 * NO BOARD THAT ONLY REPEATS (owner, 2026-10-25: "don't u think there is a redundancy in the latest lec").
 * "The Proof of Prime Numbers" spread Euclid's five steps over ten boards: the finite list assumed twice,
 * 211 computed on two boards, the contradiction stated three times and the whole proof recited again at
 * the end; the Pythagoras lecture derived a² = cx and b² = cy on three boards. Typed maths lessons only
 * (lib/canvas/progressive.ts) — the planner is told not to (MATHS_NO_REPEAT), and a planned board whose
 * sentences mostly say what earlier boards said is merged into the board before it, before any board is
 * written. Pure: lib/anim tests it.
 */
import { canvasSentences } from "./plan";
import type { CanvasPlanBeat } from "./types";

/** What the board planner of a typed maths lesson is told. `compare`: the student asked for two routes compared. */
export function mathsNoRepeatRule(compare: boolean): string {
  return [
    "EVERY BOARD MOVES THE ARGUMENT ON (no repetition):",
    "- Each board adds ONE new step, idea or result that no earlier board has given. Never a board that re-states, re-derives or re-computes what an earlier board did.",
    "- A concrete example and its general form go on the SAME board (\"for 2, 3, 5, 7 the product plus one is 211; in general N = p₁ × … × pₙ + 1\") — never one board for the example and another that works the same example again.",
    "- A board's first sentence links to the last board in a few words; it never repeats the last board's result in full.",
    "- At most ONE recap, only as the last board, at most 3 sentences, naming the steps — never the whole proof again.",
    ...(compare ? ["- The student asked for the two approaches to be COMPARED: one board compares them side by side (a \"compare\" board) — what each route does, where the other one fails — never only a sentence in passing."] : []),
  ].join("\n");
}

/** Did the student ask for approaches to be compared (a question-card answer such as "Compare both")? */
export function asksToCompare(answers: string[]): boolean {
  return answers.some((a) => /\b(?:compar\w*|both|versus|vs\.?|side by side|contrast\w*)\b/i.test(a));
}

const STOP = new Set(["the", "and", "that", "this", "with", "for", "from", "now", "then", "thus", "therefore", "so", "because", "are", "is", "was", "be", "it", "its", "of", "to", "in", "on", "at", "by", "as", "we", "our", "us", "a", "an", "or", "not", "no", "every", "each", "any", "all", "one", "which", "what", "into", "gives", "give", "means", "say", "says", "board", "next", "first", "here", "there", "has", "have", "will", "can", "must", "only", "also", "again"]);

/** A sentence's content words, in order (subscripts as digits, endings dropped). */
function contentWords(sentence: string): string[] {
  const t = sentence.toLowerCase().replace(/[₀-₉]/g, (d) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(d))).replace(/[^a-z0-9ᵢₙ… ]/g, " ");
  return (t.match(/[a-z]+\d*|\d+/g) ?? []).map((w) => w.replace(/(?:ing|ed|es|s)$/, "") || w).filter((w) => !STOP.has(w) && (w.length > 1 || /\d/.test(w)));
}

/** A sentence's phrases: each pair of neighbouring content words ("divisible prime", "prime q"). */
function phrases(sentence: string): string[] {
  const w = contentWords(sentence);
  return w.slice(1).map((x, i) => `${w[i]} ${x}`);
}

/*
 * Calibrated on the two lectures that prompted this (2026-10-25), by the share of a board's phrases that
 * earlier boards already said (its first sentence, the link to the last board, not counted):
 *   re-derivations: Pythagoras "Why the similar-triangle ratios work" 0.50; the primes recital at the end 0.39;
 *   real next steps: the primes contradiction 0.38, "Cancelling the triangle areas" 0.39, the rest 0.00–0.32.
 * A real step and a repeat overlap near 0.4, and merging a real step is worse than keeping a repeat, so only
 * the clear cases are merged here; the rest is the planner's rule (mathsNoRepeatRule).
 */
const REPEATS = 0.45;      // a board that says this much again
const LAST_REPEATS = 0.33; // the last board: a recital of the proof
const FRESH = 0.5;         // a sentence with less than this said before is new, and is kept
const MIN_PHRASES = 12;    // too short a board to judge

/** The share of a board's phrases (after its first sentence) that earlier boards already said. */
export function repeatShare(script: string, said: Set<string>): number {
  const g = canvasSentences(script).slice(1).flatMap(phrases);
  return g.length < MIN_PHRASES ? 0 : g.filter((p) => said.has(p)).length / g.length;
}

/**
 * Merges every planned board that mostly repeats earlier boards into the board before it: its new sentences
 * (if any) close that board, and it is dropped. The opening map, the exam board and refreshers are left alone.
 */
export function mergeRepeatedBoards(beats: CanvasPlanBeat[]): { beats: CanvasPlanBeat[]; log: string[] } {
  const out: CanvasPlanBeat[] = [];
  const log: string[] = [];
  const said = new Set<string>();
  const remember = (script: string) => canvasSentences(script).flatMap(phrases).forEach((p) => said.add(p));
  beats.forEach((beat, i) => {
    const prev = out.at(-1);
    const skip = i === 0 || !prev || beat.refresher || beat.stage === "exam" || prev.stage === "exam" || prev.refresher;
    const share = skip ? 0 : repeatShare(beat.script, said);
    if (!skip && share >= (i === beats.length - 1 ? LAST_REPEATS : REPEATS)) {
      const fresh = canvasSentences(beat.script).slice(1).filter((s) => {
        const g = phrases(s);
        return g.length >= 2 && g.filter((p) => said.has(p)).length / g.length < FRESH;
      });
      if (fresh.length) prev!.script = `${prev!.script.trim()} ${fresh.join(" ")}`;
      log.push(`${beat.id} "${beat.title}" merged into ${prev!.id}: ${Math.round(share * 100)}% of it repeats earlier boards${fresh.length ? `; ${fresh.length} new sentence(s) kept` : ""}`);
      remember(beat.script);
      return;
    }
    remember(beat.script);
    out.push(beat);
  });
  if (out.length === beats.length) return { beats, log };
  // A later board that pointed into a dropped one points into the board it was merged into.
  const kept = new Set(out.map((b) => b.id));
  const into = new Map<string, string>();
  let last = "";
  for (const b of beats) {
    if (kept.has(b.id)) last = b.id;
    else into.set(b.id, last);
  }
  for (const b of out) if (b.inside && into.has(b.inside.beat)) b.inside = { ...b.inside, beat: into.get(b.inside.beat)! };
  return { beats: out, log };
}
