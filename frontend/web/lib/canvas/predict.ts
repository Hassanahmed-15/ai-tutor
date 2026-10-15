/**
 * THE PREDICTION SENTENCE, found the same way by the planner, the board writer and the player.
 * The quiz used to be written for a sentence picked by position (a third of the way in), which
 * missed the real "Predict: …?" sentence on 11 of 12 audited boards — the card asked something
 * other than what Aria had just asked (audit 2026-10-15).
 */
export function asksForPrediction(sentence: string): boolean {
  return /\bpredict\b/i.test(sentence) || (/\?\s*$/.test(sentence.trim()) && /\b(will|which|what|should|does|do|is|are|can)\b/i.test(sentence));
}

/** Index of the board's prediction sentence: an explicit "Predict" first, else a question; -1 if none. */
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";

export function predictionIndex(sentences: string[]): number {
  const explicit = sentences.findIndex((s, i) => i > 0 && /\bpredict\b/i.test(s));
  if (explicit >= 0) return explicit;
  return sentences.findIndex((s, i) => i > 0 && i < sentences.length - 1 && asksForPrediction(s));
}

const ANSWER_STOP = new Set("the a an and or of to in on for with by as at from is are be that this which what will would does do if when it its you your then because so therefore answer result".split(" "));
const answerWords = (s: string) => (s.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []).filter((word) => word.length > 2 && !ANSWER_STOP.has(word));
const answerNumbers = (s: string): string[] => [...(s.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? [])];

/**
 * A prediction is not a prediction when the board has already printed the answer. This inspects
 * only the authored board marks (not the answer options, which must of course include one correct
 * choice) and rejects answer-bearing text scheduled before the reveal sentence.
 */
export function predictionRevealIssues(spec: CanvasBoardSpec, beat: Pick<CanvasPlanBeat, "teachingCycle" | "script">): string[] {
  const cycle = beat.teachingCycle;
  if (!cycle) return [];
  const sentences = beat.script.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const reveal = sentences[cycle.reveal] ?? "";
  if (!reveal) return ["the planned reveal sentence is missing"];

  const early: string[] = [];
  const walk = (value: unknown, inheritedS = 0, key = "") => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach((item) => walk(item, inheritedS, key)); return; }
    const record = value as Record<string, unknown>;
    const s = typeof record.s === "number" ? record.s : inheritedS;
    for (const [childKey, child] of Object.entries(record)) {
      if (typeof child === "string" && /^(label|name|title|text|sub|caption)$/.test(childKey) && s < cycle.reveal) early.push(child);
      else if (child && typeof child === "object") walk(child, s, childKey);
    }
  };
  walk(spec.notes);
  walk(spec.stage);

  const issues: string[] = [];
  const revealNumbers = answerNumbers(reveal);
  for (const number of revealNumbers) {
    const leak = early.find((text) => answerNumbers(text).includes(number));
    if (leak) issues.push(`the answer value ${number} is visible before the reveal in "${leak}"`);
  }
  const revealWords = [...new Set(answerWords(reveal))];
  if (revealWords.length >= 2) {
    const leak = early.find((text) => {
      const shown = new Set(answerWords(text));
      const shared = revealWords.filter((word) => shown.has(word)).length;
      return shared >= 2 && shared / revealWords.length >= 0.7;
    });
    if (leak) issues.push(`the reveal is already printed before the student predicts: "${leak}"`);
  }
  return [...new Set(issues)];
}

/** Plan-level integrity for a complete teach → predict → reveal → transfer cycle. */
export function teachingCycleIssues(beat: Pick<CanvasPlanBeat, "overview" | "refresher" | "interaction" | "teachingCycle" | "script">): string[] {
  if (beat.overview || beat.refresher || beat.interaction === "try" || beat.interaction === "draw") return [];
  const sentences = beat.script.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const cycle = beat.teachingCycle;
  if (!cycle) return ["a substantive teaching board needs a prediction followed by a reveal and transfer example"];
  const prediction = sentences[cycle.predict] ?? "";
  const transfer = sentences[cycle.transfer] ?? "";
  const issues: string[] = [];
  if (!prediction.endsWith("?")) issues.push("the prediction must be its own question ending in ?");
  if (cycle.reveal !== cycle.predict + 1) issues.push("the answer must begin in the sentence immediately after the prediction");
  if (cycle.transfer <= cycle.reveal) issues.push("the transfer example must come after the reveal");
  const transferCue = /\b(apply|use|new|another|different|case|example|situation|scenario|suppose|imagine|given|calculate|if|when|now try)\b/i;
  if (!transferCue.test(transfer) || answerWords(transfer).length < 3) issues.push("the last sentence must give a concrete new case, not merely recap the answer");
  return issues;
}

const STOP = new Set("the a an and or of to in on for with by as at from is are be that this which what will would does do if when it its you your predict can should how much many".split(" "));
const contentWords = (s: string) => new Set((s.toLowerCase().match(/[a-z][a-z'-]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)));
const numbersIn = (s: string) => new Set((s.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? []).map(Number));

/**
 * Does the quiz ask what the spoken prediction asked? Most of the prediction's numbers must be in the
 * question, and the two must share at least a fifth of the prediction's content words.
 */
export function quizMatchesPrediction(question: string, prediction: string): { ok: boolean; why?: string } {
  const p = prediction.replace(/^\s*predict\s*:?\s*/i, "");
  // An old-style sentence that states its own answer ("predict f, T and ω before checking: f = 2.0 Hz…")
  // cannot be compared word for word; the plan prompt now requires a question ending in "?".
  if (!p.includes("?")) return { ok: true };
  // The card may leave out some givens, but not most of them: half or more of the prediction's
  // numbers (all of them when it names one or two) must be in the question.
  // Only the question's own givens count: the part before its "?" (no "?" — an old-style sentence
  // that also states the answer — then no number rule).
  const asked = p.includes("?") ? p.slice(0, p.lastIndexOf("?")) : "";
  const said = [...numbersIn(asked)];
  const missing = said.filter((n) => !numbersIn(question).has(n));
  if (said.length && missing.length > (said.length <= 2 ? 0 : said.length / 2)) return { ok: false, why: `the quiz must use the prediction's numbers (${missing.join(", ")})` };
  const pw = contentWords(p), qw = contentWords(question);
  if (!pw.size) return { ok: true };
  const shared = [...pw].filter((w) => qw.has(w) || qw.has(w.replace(/s$/, "")) || qw.has(`${w}s`)).length;
  // Low on purpose: a card may reword the question ("which pairing connects…" for "which curve
  // represents…"); only a different question shares almost nothing.
  return shared / pw.size >= 0.2 ? { ok: true } : { ok: false, why: "the quiz asks a different question from the spoken prediction" };
}
