import { emptyProfile, type DepthLevel, type LearnerProfile, type PartReading } from "./learnerProfile";
import { matchSpokenAnswer } from "./spokenAnswer";

/**
 * THE INTAKE: WHAT THE STUDENT ALREADY KNOWS, ASKED SIMPLY (owner, 2026-10-20).
 *
 * A teacher testing Aria found the planning questions were the kind only someone who had mastered
 * the topic could answer ("A model scores 99% on training data and 60% on new data. Why?"): "why
 * would I come if I already know the answer?" So the conversation before a lesson is now two steps:
 *
 *   1. The topic's parts, as chips. The student taps the ones they have met: new to me, heard of
 *      it, or I know this. "It's all new to me" is one tap.
 *   2. Up to three VERY BASIC checks, only on parts marked "I know this" — one easy fact each, never
 *      a "why" puzzle. Parts that are new get no questions: there is nothing to check.
 *
 * Each part then has a status the lesson is built from: NEW or SHAKY parts are built from scratch,
 * step by step (the concept ladder); KNOWN parts get a one-line recap. Self-ratings alone are only
 * loosely right (r ≈ .29 across 22 meta-analyses), which is why "I know this" is checked and never
 * skips a part outright. Nothing here is remembered after the lesson (owner: this lesson only).
 *
 * Pure: the server writes the parts and checks (INTAKE_PROMPT), the client asks them, and this file
 * turns the answers into the profile the plan reads.
 */

export type IntakeCheck = { question: string; options: string[]; answer: number };
export type IntakePart = { id: string; label: string; check: IntakeCheck | null };
/** What the student tapped. */
export type PartMark = "new" | "heard" | "know";
/** How a check went: right, wrong, "not sure", or not asked. */
export type CheckOutcome = "right" | "wrong" | "unsure";

export const MAX_INTAKE_CHECKS = 3;
export const INTAKE_QUESTION = "Which parts have you met before?";

export const INTAKE_PROMPT = `You list the PARTS of a topic a student is about to learn, and one very basic check question for each part. Return JSON only:
{"parts": [{"label": string, "check": {"question": string, "options": [string, string, string], "answer": 0 | 1 | 2}}]}
- 4 to 6 parts, in the order they should be learned: a part comes after the parts it needs. Together they cover the topic as the student asked for it, nothing wider.
- "label": at most 5 words, in words THIS student already understands. A young student gets everyday words ("What plants need"), a university student the real terms ("Bias and variance"). A name, never a sentence or a question.
- "check": the EASIEST question that shows whether the student has really met this part: recognising a basic fact, a word, or what something is. NEVER a "why" question, a scenario to reason about, a calculation or a definition to recite. At most 12 words. Three options of at most 6 words each: exactly one right, the other two plainly wrong to anyone who has met the basics. "answer" is the index of the right option.
- The right option must be TEXTBOOK-CORRECT and complete on its own, never vague or half true (not "high training accuracy" for overfitting, not "water" for what electrolysis breaks down).
- Never give the answer away: the right option must not repeat a word of the part's label or of the question, and the question must not be answered by the topic's own name ("What is the process called?" is useless).
- Plain words at the student's level. No dashes of any kind.`;

/** The parts the model wrote, checked: 2 to 6 named parts, each check with three options and a valid answer. */
export function sanitizeIntake(raw: unknown): IntakePart[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { parts?: unknown }).parts) ? ((raw as { parts: unknown[] }).parts) : [];
  const seen = new Set<string>();
  const parts: IntakePart[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const label = typeof rec.label === "string" ? undash(rec.label).replace(/[.?!]+$/, "").trim().slice(0, 48) : "";
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    const c = rec.check && typeof rec.check === "object" ? (rec.check as Record<string, unknown>) : null;
    const options = Array.isArray(c?.options) ? (c!.options as unknown[]).filter((o): o is string => typeof o === "string" && o.trim().length > 0).map((o) => undash(o).trim().slice(0, 60)) : [];
    const answer = typeof c?.answer === "number" ? Math.round(c.answer) : -1;
    const question = typeof c?.question === "string" ? undash(c.question).trim().slice(0, 140) : "";
    const valid = question && options.length >= 2 && options.length <= 4 && answer >= 0 && answer < options.length && new Set(options.map((o) => o.toLowerCase())).size === options.length;
    // A check whose right answer repeats the part's own words, or the question's, proves nothing.
    const check = valid && !givesAway(options[answer], `${label} ${question}`) ? shuffled({ question, options, answer }, label) : null;
    parts.push({ id: `part-${parts.length + 1}`, label, check });
    if (parts.length >= 6) break;
  }
  return parts.length >= 2 ? parts : [];
}

/**
 * The cards in a fixed but varied order: the model put the right answer first in most checks
 * (probe, 2026-10-20), so tapping "A" would have passed. Seeded by the part, so it never jumps.
 */
function shuffled(check: IntakeCheck, seed: string): IntakeCheck {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const order = check.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { question: check.question, options: order.map((i) => check.options[i]), answer: order.indexOf(check.answer) };
}

/** True when the right answer's content words are already in the label or the question. */
function givesAway(right: string, context: string): boolean {
  const words = (t: string) => (t.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((w) => w.replace(/(ies|es|s|ing|ed|al)$/, "").slice(0, 6)).filter((w) => w.length >= 4 && !GENERIC.has(w));
  const seen = new Set(words(context));
  const own = words(right);
  return own.length > 0 && own.some((w) => seen.has(w));
}
const GENERIC = new Set(["what", "which", "when", "with", "that", "this", "does", "make", "used", "part", "thing", "have", "from", "into", "they", "their", "only", "more", "most"]);

/** The parts to check: those marked "I know this" that have a check, in teaching order, at most three. */
export function checksToAsk(parts: IntakePart[], marks: Record<string, PartMark>, max = MAX_INTAKE_CHECKS): IntakePart[] {
  return parts.filter((p) => marks[p.id] === "know" && p.check).slice(0, max);
}

/** A check's answer as the student gave it (a card's text, said or tapped). */
export function gradeCheck(part: IntakePart, answer: string): CheckOutcome {
  if (!part.check || /^\s*(not sure|i don'?t know|no idea|skip|just teach me)\s*$/i.test(answer)) return "unsure";
  const said = norm(answer);
  const right = norm(part.check.options[part.check.answer]);
  if (said === right) return "right";
  const picked = part.check.options.findIndex((o) => norm(o) === said);
  if (picked >= 0) return "wrong";
  // A TYPED answer (the card's Other box): the option it means, read as a spoken answer is; one that
  // means none of them is "not sure", so the part is taught properly rather than marked wrong.
  const meant = matchSpokenAnswer(answer, part.check.options);
  if (meant?.kind === "option") return norm(meant.option) === right ? "right" : "wrong";
  return "unsure";
}

/**
 * Where the student stands on each part. "I know this" holds only when its check was right (or it
 * was not one of the three checked, after the others passed); a wrong or unsure check, and "heard of
 * it", make the part shaky; everything else is new.
 */
export function readParts(parts: IntakePart[], marks: Record<string, PartMark>, outcomes: Record<string, CheckOutcome>): PartReading[] {
  const checked = Object.values(outcomes);
  const allPassed = checked.length > 0 && checked.every((o) => o === "right");
  return parts.map((p) => {
    const mark = marks[p.id] ?? "new";
    const outcome = outcomes[p.id];
    if (mark === "know") {
      if (outcome === "right") return { label: p.label, status: "known" };
      // Not checked (past the three, or no usable check): trusted only when every check asked passed.
      if (outcome === undefined && allPassed) return { label: p.label, status: "known" };
      return { label: p.label, status: "shaky" };
    }
    return { label: p.label, status: mark === "heard" ? "shaky" : "new" };
  });
}

/**
 * The profile the plan is built from. The level follows how much of the topic is already theirs:
 * nothing known reads as a beginner (2), some as intermediate (3), most of it as advanced (4). It is
 * evidence (checked), so it is held with high confidence.
 */
export function profileFromIntake(topic: string, readings: PartReading[], base: LearnerProfile = emptyProfile(topic), ownWords = ""): LearnerProfile {
  const known = readings.filter((r) => r.status === "known").map((r) => r.label);
  const shaky = readings.filter((r) => r.status === "shaky").map((r) => r.label);
  const fresh = readings.filter((r) => r.status === "new").map((r) => r.label);
  const share = readings.length ? known.length / readings.length : 0;
  const level: DepthLevel = known.length === 0 ? 2 : share > 0.5 ? 4 : 3;
  const hypothesis = [
    fresh.length ? `New to ${list(fresh)}: build ${fresh.length === 1 ? "it" : "them"} from scratch, step by step.` : "",
    shaky.length ? `Only a loose grip on ${list(shaky)}: teach ${shaky.length === 1 ? "it" : "them"} properly, a little faster.` : "",
    known.length ? `Already knows ${list(known)}: a one-line recap where it is needed, no re-teaching.` : "",
  ].filter(Boolean).join(" ");
  return {
    ...base,
    topic,
    claimedLevel: level,
    confidence: "high",
    masteredConcepts: known.slice(0, 8),
    weakConcepts: [...shaky, ...fresh].slice(0, 8),
    teachingHypothesis: hypothesis || null,
    parts: readings,
    ownWords: ownWords.replace(/\s+/g, " ").trim().slice(0, 300) || null,
    updatedAt: new Date().toISOString(),
  };
}

/** The parts' statuses as the lesson planner reads them (empty when the intake did not run). */
export function partsPlanLine(readings: PartReading[] | undefined): string {
  if (!readings?.length) return "";
  const word = { new: "NEW, build from scratch", shaky: "SHAKY, build it again properly", known: "KNOWN, one-line recap only" } as const;
  return `\n\nWHAT THIS STUDENT ALREADY KNOWS, part by part (they marked it; "known" was confirmed by a basic check):\n${readings.map((r, i) => `${i + 1}. ${r.label}: ${word[r.status]}`).join("\n")}`;
}

/**
 * A spoken answer on the parts screen: the parts named ("I know photosynthesis and chlorophyll",
 * "I've heard of regularisation"), "it's all new" / "none of them", or "done". Names are matched on
 * their distinctive words, so "the chlorophyll one" finds "Leaves and chlorophyll".
 */
export function matchSpokenParts(text: string, parts: IntakePart[]): { marks: Record<string, PartMark>; allNew: boolean; done: boolean } {
  const said = ` ${text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ")} `;
  const allNew = /\b(all (of it is |of them are |is )?new|it'?s all new|none( of (them|these|it))?|nothing|never heard|no idea|don'?t know (any|anything)|new to me)\b/.test(said);
  const done = /\b(done|that'?s (it|all)|that is (it|all)|next|continue|carry on|go on|ready|let'?s (go|start)|finished)\b/.test(said);
  const marks: Record<string, PartMark> = {};
  if (allNew) return { marks, allNew, done: true };
  const heard = /\bheard (of|about)\b|\ba (bit|little)\b|\bsort of\b|\bkind of\b/.test(said);
  const saidWords = new Set(said.split(" ").filter(Boolean).map(stem));
  const wordsOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w.length >= 4 && !STOP.has(w)).map(stem);
  const labelWords = parts.map((p) => wordsOf(p.label));
  for (const [k, part] of parts.entries()) {
    // A word several parts share ("plants" in three of them) names none of them alone: a part is named by
    // a word only it has, or — when it has none — by all of its words.
    const own = labelWords[k].filter((w) => labelWords.filter((ws) => ws.includes(w)).length === 1);
    const every = part.label.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w.length >= 3 && !/^(?:what|how|why|the|and|with|from|that|this|into|about|its|their)$/.test(w)).map(stem);
    const named = own.length ? own.some((w) => saidWords.has(w)) : every.length > 0 && every.every((w) => saidWords.has(w));
    if (named) marks[part.id] = heard ? "heard" : "know";
  }
  return { marks, allNew: false, done };
}

/**
 * A TYPED answer to "which parts do you know" (the card's Other box): the parts it says the student
 * knows, clause by clause — "I know photosynthesis and chlorophyll but not the light reactions" ticks
 * the first two; a clause that says not, never, new or no idea ticks nothing. "It's all new" is all new.
 */
export function typedParts(text: string, parts: IntakePart[]): { known: string[]; allNew: boolean } {
  const known = new Set<string>();
  for (const clause of text.split(/[.;!?]|,\s*(?:but|except)\b|\b(?:but|except|although|though|however)\b/i)) {
    if (!clause.trim() || /\b(?:not|don'?t|do not|never|no|haven'?t|hasn'?t|can'?t|cannot|new|unsure|confus\w*|struggl\w*|weak|forgot|forget)\b/i.test(clause)) continue;
    const heard = matchSpokenParts(clause, parts);
    for (const [id, mark] of Object.entries(heard.marks)) if (mark === "know") known.add(id);
  }
  return { known: [...known], allNew: !known.size && matchSpokenParts(text, parts).allNew };
}

const STOP = new Set(["what", "with", "from", "that", "this", "they", "them", "your", "into", "their", "about", "makes", "make", "does", "work", "works", "part", "parts", "basic", "basics", "idea", "ideas", "matters", "things"]);
function stem(w: string): string {
  return w.replace(/(ing|ies|es|s|ed)$/, "").slice(0, 6);
}
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function undash(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ", ").replace(/\s+-\s+/g, ", ");
}
function list(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * THE QUESTIONS AS ONE CARD (owner, 2026-10-20: "exactly like Claude asks questions"): the parts as
 * one multi-select question (a tick means "I know this"; "it's all new" clears the ticks), then one
 * single-choice tab per check on a ticked part, at most three. The tabs follow the ticks live.
 */
export const ALL_NEW = "None of these, it's all new to me";
export const NOT_SURE = "Not sure";
export type IntakeCardQuestion = { id: string; header: string; question: string; multi?: boolean; options: Array<{ label: string; description?: string }> };

export function intakeCard(parts: IntakePart[], known: string[]): IntakeCardQuestion[] {
  const marks = markOf(known);
  return [
    { id: "parts", header: "What you know", question: INTAKE_QUESTION, multi: true, options: [...parts.map((p) => ({ label: p.label })), { label: ALL_NEW, description: "Aria builds every part from the very beginning" }] },
    ...checksToAsk(parts, marks).map((p) => ({
      id: `check-${p.id}`,
      header: p.label.length > 16 ? `${p.label.slice(0, 15).trimEnd()}…` : p.label,
      question: p.check!.question,
      options: [...p.check!.options.map((label) => ({ label })), { label: NOT_SURE, description: "No problem: Aria teaches it properly" }],
    })),
  ];
}

/** The ticked parts as marks: ticked is "I know this", everything else is new. */
export function markOf(known: string[]): Record<string, PartMark> {
  return Object.fromEntries(known.map((id) => [id, "know" as const]));
}

/** On Submit: every asked check graded (unanswered counts as not sure). */
export function gradeCard(parts: IntakePart[], known: string[], answers: Record<string, string>): Record<string, CheckOutcome> {
  return Object.fromEntries(checksToAsk(parts, markOf(known)).map((p) => [p.id, answers[p.id] ? gradeCheck(p, answers[p.id]) : "unsure" as const]));
}
