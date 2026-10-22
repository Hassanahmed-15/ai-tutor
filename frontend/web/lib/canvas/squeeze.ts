import { canvasSentences } from "./plan";
import type { CanvasPlanBeat } from "./types";

/**
 * ONE STEP PER SENTENCE, FIXED IN THE PLAN (owner, 2026-10-22: "the synchronisation should be perfect").
 * A sentence that runs a whole trace ("tracing 'curiosity' gives c zero, u one, r one, i two …") or
 * explains several lines ("line one defines fib, and line two returns n") cannot be followed on a board
 * that lights one line per sentence. The CS examiner found them only after the board was written, and
 * growing the narration then cost a rewrite (CS round 3). Here code finds them in the plan, one small
 * call splits each into one sentence per line or step, and code checks no value was lost or invented —
 * so each board is written once, for the narration it plays with.
 */

const ACTIONS = /\b(?:record|visit|compare|push|pop|return|call|swap|print|move|add|set|change|become|remove|dequeue|enqueue|append|scan|choos|chose|mark|relax|update|store|increment|decrement|plac|output|leav|tr(?:y|ies|ied|ying)|check|sift|insert|delet|split|merg|explor|backtrack)(?:e|es|ed|ing|s)?\b/gi;
const LINE = /\bline (?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi;

/** Does this sentence pack several lines of code or several executed steps into one? */
export function squeezedSentence(sentence: string): boolean {
  if ((sentence.match(LINE) ?? []).length >= 2) return true;
  if ((sentence.match(/\bthen\b/gi) ?? []).length >= 2) return true;
  // "We repeat this process … until the array becomes [2, 3, 5, 7, 8, 9]": a whole run in one sentence.
  if (/\b(?:repeat\w*|continu\w*|keep\w*|carr(?:y|ies|ied) on)\b[^.]*\buntil\b/i.test(sentence) || /\band so on\b/i.test(sentence)) return true;
  if ((sentence.match(ACTIONS) ?? []).length >= 4) return true;
  // A run of steps: "c zero, u one, r one, i two, o three" — six or more short "name value" items. A
  // bare list of numbers is a result ("the pre-order sequence is 8, 3, 1, …"), one step; commas inside
  // brackets are a value's own ("[7, 2, 9, 4]").
  const flat = sentence.replace(/[[({][^\])}]*[\])}]/g, "LIST");
  const items = flat.split(/,\s*(?:and\s+)?/).filter((part) => /^\s*[A-Za-z"'][^\s,]*\s+\S+/.test(part) && part.trim().split(/\s+/).length <= 3);
  return items.length >= 6;
}

/** The squeezed sentences of each beat, as the splitting call reads them. */
export function squeezedInPlan(beats: CanvasPlanBeat[]): Array<{ beat: string; sentence: number; text: string }> {
  return beats.flatMap((b) => (b.refresher || b.overview || b.stage === "exam" ? [] : canvasSentences(b.script).map((text, sentence) => ({ beat: b.id, sentence, text })).filter((x) => squeezedSentence(x.text))));
}

/** Numbers and quoted values a sentence states: a split must keep every one and add none. */
function valuesOf(text: string): string[] {
  return [...text.matchAll(/-?\d+(?:\.\d+)?|"[^"]*"|'[^']*'/g)].map((m) => m[0]).sort();
}

/**
 * Puts the split sentences into the beats (in place): each squeezed sentence becomes its replacement,
 * and the board phrases planned for later sentences move with them. A replacement that loses or adds a
 * value, or is not 2 to 12 whole sentences, is not used (a board longer than 10 continues on the next one). Returns how many sentences were split.
 */
export function applySplits(beats: CanvasPlanBeat[], splits: Array<{ beat: string; sentence: number; sentences: string[] }>): number {
  let applied = 0;
  for (const beat of beats) {
    const mine = splits.filter((s) => s.beat === beat.id).sort((a, b) => b.sentence - a.sentence);
    if (!mine.length) continue;
    const sentences = canvasSentences(beat.script);
    let notes = beat.boardNotes ? [...beat.boardNotes] : undefined;
    for (const split of mine) {
      const old = sentences[split.sentence];
      const parts = split.sentences.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
      if (!old || parts.length < 2 || parts.length > 12 || parts.some((p) => !/[.!?]$/.test(p) || canvasSentences(p).length !== 1)) continue;
      const before = valuesOf(old), after = valuesOf(parts.join(" "));
      // Every value said is still said, and none is invented (a value may now be said more than once).
      if (!before.every((v) => after.includes(v)) || !after.every((v) => before.includes(v))) continue;
      sentences.splice(split.sentence, 1, ...parts);
      const grew = parts.length - 1;
      if (notes) notes = notes.map((n) => (n.s > split.sentence ? { ...n, s: n.s + grew } : n));
      applied++;
    }
    beat.script = sentences.join(" ");
    if (notes) beat.boardNotes = notes;
  }
  return applied;
}

export const SQUEEZE_PROMPT = `You rewrite a few sentences of a computer-science lesson so a student can follow each one on a board that lights ONE line of code per sentence. Each sentence given packs several steps into one: several lines of code explained together, or several executed steps of a trace (loop passes, calls, visits, swaps, values). Split each into 2 to 12 sentences: one per line of code (what it does and why) or one per executed step (what runs and what changes), each a natural sentence a teacher would say (\"The next letter, u, is a vowel, so count becomes one.\" — never the same opening repeated). Keep every number and value exactly as given — add none, drop none — and keep the teacher's words where you can. A sentence that only states a final result or sequence (\"The pre-order sequence is 8, 3, 1, 6\") is ONE step: return it unchanged as a single sentence, as you do any sentence that is really one step. Return JSON only: {"splits": [{"id": the id given, "sentences": [string, ...]}]}.`;
