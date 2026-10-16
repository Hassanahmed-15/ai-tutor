/**
 * THE PREDICTION SENTENCE, found the same way by the planner, the board writer and the player.
 * The quiz used to be written for a sentence picked by position (a third of the way in), which
 * missed the real "Predict: …?" sentence on 11 of 12 audited boards — the card asked something
 * other than what Aria had just asked (audit 2026-10-15).
 */
export function asksForPrediction(sentence: string): boolean {
  // A question in Urdu or Arabic ("…؟") has no English question word to look for.
  return /\bpredict\b/i.test(sentence) || (/\?\s*$/.test(sentence.trim()) && /\b(will|which|what|should|does|do|is|are|can)\b/i.test(sentence)) || (/؟\s*$/.test(sentence.trim()) && !/[A-Za-z]{3}/.test(sentence));
}

/** Index of the board's prediction sentence: an explicit "Predict" first, else a question; -1 if none. */
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";

export function predictionIndex(sentences: string[]): number {
  const explicit = sentences.findIndex((s, i) => i > 0 && /\bpredict\b/i.test(s));
  if (explicit >= 0) return explicit;
  return sentences.findIndex((s, i) => i > 0 && i < sentences.length - 1 && asksForPrediction(s));
}

const ANSWER_STOP = new Set("the a an and or of to in on for with by as at from is are be that this which what will would does do if when it its you your then because so therefore answer result".split(" "));
const answerWords = (s: string) => (s.toLowerCase().match(/\p{L}[\p{L}\p{M}'-]+/gu) ?? []).filter((word) => word.length > 2 && !ANSWER_STOP.has(word));
// A number in a name (S1, D2, P1, Q2, x₂) is a label, not an answer (audit 2026-10-17: "S1 → S2" failed
// every attempt at a supply-shift board).
const answerNumbers = (s: string): string[] => [...(s.replace(/(\d),(\d{3})/g, "$1$2").match(/(?<![A-Za-z_])\d+(?:\.\d+)?(?![A-Za-z])/g) ?? [])];

type BoardText = { text: string; s: number; holder?: Record<string, unknown> };

/**
 * Every piece of text the board shows, with the sentence it appears on and the element that holds
 * its timing. An equation token has no timing of its own: it appears with the first step that
 * places it (treating every token as shown from sentence 0 rejected maths boards whose answer is
 * only worked in a later step — similarity audit 2026-10-17).
 */
function boardTexts(spec: CanvasBoardSpec): BoardText[] {
  const out: BoardText[] = [];
  const walk = (value: unknown, inheritedS: number, holder: Record<string, unknown> | undefined) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach((item) => walk(item, inheritedS, holder)); return; }
    const record = value as Record<string, unknown>;
    const own = typeof record.s === "number";
    const s = own ? (record.s as number) : inheritedS;
    const h = own ? record : holder;
    for (const [childKey, child] of Object.entries(record)) {
      if (typeof child === "string" && /^(label|name|title|text|sub|caption|detail)$/.test(childKey)) out.push({ text: child, s, holder: h });
      else if (child && typeof child === "object") walk(child, s, h);
    }
  };
  walk(spec.notes, 0, undefined);
  if (spec.stage.kind === "equation") {
    const first = new Map<string, number>();
    for (const step of [...spec.stage.steps].sort((a, b) => a.s - b.s)) for (const id of step.order) if (!first.has(id)) first.set(id, step.s);
    for (const token of spec.stage.tokens) if (first.has(token.id)) out.push({ text: token.text, s: first.get(token.id)! });
    walk(spec.stage.steps, 0, undefined);
  } else {
    walk(spec.stage, 0, undefined);
  }
  return out;
}

/** The board text that gives the answer away before the reveal sentence, and why. */
function revealLeaks(spec: CanvasBoardSpec, beat: Pick<CanvasPlanBeat, "teachingCycle" | "script">): Array<{ mark: BoardText; why: string }> {
  const cycle = beat.teachingCycle;
  if (!cycle) return [];
  const sentences = beat.script.split(/(?<=[.!?۔؟])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const reveal = sentences[cycle.reveal] ?? "";
  if (!reveal) return [];
  const early = boardTexts(spec).filter((m) => m.s < cycle.reveal);
  // What Aria has already SAID — the worked example before the question, and the question's own
  // givens — may be on the board: the scale factor 1.5 worked out in sentence 1 is not a leak of an
  // answer that also uses 1.5 (similarity audit 2026-10-17).
  const said = sentences.slice(0, cycle.predict + 1).join(" ");
  const given = new Set(answerNumbers(said));
  const out: Array<{ mark: BoardText; why: string }> = [];
  for (const number of answerNumbers(reveal).filter((n) => !given.has(n))) {
    for (const mark of early.filter((m) => answerNumbers(m.text).includes(number))) out.push({ mark, why: `the answer value ${number} is visible before the reveal in "${mark.text}"` });
  }
  const saidWords = new Set(answerWords(said));
  const revealWords = [...new Set(answerWords(reveal))].filter((w) => !saidWords.has(w));
  if (revealWords.length >= 2) {
    for (const mark of early) {
      const shown = new Set(answerWords(mark.text));
      const shared = revealWords.filter((word) => shown.has(word)).length;
      if (shared >= 2 && shared / revealWords.length >= 0.7) out.push({ mark, why: `the reveal is already printed before the student predicts: "${mark.text}"` });
    }
  }
  return out;
}

/**
 * A prediction is not a prediction when the board has already printed the answer. This inspects
 * only the authored board marks (not the answer options, which must of course include one correct
 * choice) and rejects answer-bearing text scheduled before the reveal sentence.
 */
export function predictionRevealIssues(spec: CanvasBoardSpec, beat: Pick<CanvasPlanBeat, "teachingCycle" | "script">): string[] {
  const cycle = beat.teachingCycle;
  if (!cycle) return [];
  const sentences = beat.script.split(/(?<=[.!?۔؟])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  if (!sentences[cycle.reveal]) return ["the planned reveal sentence is missing"];
  return [...new Set(revealLeaks(spec, beat).map((l) => l.why))];
}

/**
 * Holds back what would give the answer away: an element whose text carries the answer appears on
 * the reveal sentence instead of before it, and an arrow never appears before the things it joins.
 * Rejecting such a board instead sent 3 of 4 maths boards to the plain backup (audit 2026-10-17).
 * Returns how many elements were moved; what cannot be moved (an equation token) is left for the gate.
 */
export function deferRevealLeaks(spec: CanvasBoardSpec, beat: Pick<CanvasPlanBeat, "teachingCycle" | "script">): number {
  const cycle = beat.teachingCycle;
  if (!cycle) return 0;
  let moved = 0;
  for (const { mark } of revealLeaks(spec, beat)) {
    if (mark.holder && typeof mark.holder.s === "number" && mark.holder.s < cycle.reveal) { mark.holder.s = cycle.reveal; moved++; }
  }
  if (moved && (spec.stage.kind === "flow" || spec.stage.kind === "scene")) {
    const at = new Map<string, number>(((spec.stage.kind === "flow" ? spec.stage.nodes : spec.stage.items) as Array<{ id: string; s: number }>).map((n) => [n.id, n.s]));
    for (const arrow of spec.stage.arrows) arrow.s = Math.max(arrow.s, at.get(arrow.from) ?? 0, at.get(arrow.to) ?? 0);
  }
  return moved;
}

/** Plan-level integrity for a complete teach → predict → reveal → transfer cycle. */
export function teachingCycleIssues(beat: Pick<CanvasPlanBeat, "overview" | "refresher" | "interaction" | "teachingCycle" | "script"> & { stage?: CanvasPlanBeat["stage"] }): string[] {
  // The exam-practice board models a full-mark answer; it has no prediction of its own.
  if (beat.overview || beat.refresher || beat.stage === "exam" || beat.interaction === "try" || beat.interaction === "draw") return [];
  const sentences = beat.script.split(/(?<=[.!?۔؟])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  const cycle = beat.teachingCycle;
  if (!cycle) return ["a substantive teaching board needs a prediction followed by a reveal and transfer example"];
  const prediction = sentences[cycle.predict] ?? "";
  const issues: string[] = [];
  if (!/[?؟]$/.test(prediction)) issues.push("the prediction must be its own question ending in ?");
  if (cycle.reveal !== cycle.predict + 1) issues.push("the answer must begin in the sentence immediately after the prediction");
  // The transfer sentence is welcome but not required: a board may end on its answer. Demanding one
  // made the planner (or a filler line) tack on "now try a new example" to every board.
  if (cycle.transfer < cycle.reveal) issues.push("the transfer example must come after the reveal");
  // A closing recap is not a fault worth a whole new plan: only the order of the cycle is enforced.
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
