import { readingGrade } from "../studentCard";
import type { CanvasBoardSpec } from "./types";

/**
 * THE WORDS A STUDENT HEARS, CHECKED BY CODE (owner QA brief, 2026-11-28). A learner who picked "None of
 * these, it's all new to me" still got lessons at reading grade 8.6–10.5 (History the hardest), one term
 * said a dozen times in a short lesson, a heading dropped into a sentence as a fragment, a lesson that
 * switched currency half-way, a rate that changed its unit inside one calculation, and a line of working
 * with no word saying what it works out.
 *
 * Every check here is general: no topic, word or example is named. Each returns plain-English issues the
 * wording rewrite (lib/canvas/progressive.ts pitchScripts) is given, or the board writer is told. Pure.
 */

/** The narration's sentences, split as the canvas splits them (lib/canvas/plan.ts canvasSentences). */
export function sentencesOf(script: string): string[] {
  return script.split(/(?<=[.!?۔؟])\s+/).map((s) => s.trim()).filter(Boolean);
}

const wordList = (text: string) => text.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}'’-]/gu, "")).filter(Boolean);

/** How hard a script reads: Flesch-Kincaid grade, its sentences' lengths, and which run over `maxWords`. */
export function readability(script: string, maxWords = Infinity): { grade: number; sentences: number; maxSentenceWords: number; meanSentenceWords: number; long: number[] } {
  const sentences = sentencesOf(script);
  const lengths = sentences.map((s) => wordList(s).length);
  const total = lengths.reduce((a, b) => a + b, 0);
  return {
    grade: readingGrade(script),
    sentences: sentences.length,
    maxSentenceWords: lengths.length ? Math.max(...lengths) : 0,
    meanSentenceWords: sentences.length ? Math.round((total / sentences.length) * 10) / 10 : 0,
    long: lengths.flatMap((n, i) => (n > maxWords ? [i] : [])),
  };
}

/* ── one term said again and again ─────────────────────────────────────────────────────────── */

const STOP = new Set(("the a an and or of to in on for with by as at from is are be that this which what will would does do if when it its you your " +
  "they their them can more less than into only also so because then there here have has was were been being not but all any each how why about " +
  "these those such very just like one two three first second third next last new same other another every many much most some what while where " +
  "using solving choosing making finding comparing measuring calculating recognizing recognising understanding explaining describing working " +
  "lesson board part step steps example examples answer question check think pause quick").split(" "));
/** Long words everyone uses: not jargon however often they come. */
const EVERYDAY = new Set("everything everyone everybody especially actually usually really definitely immediately particular necessary information important different difference remember together already probably ordinary situation everyday".split(" "));

function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}
const norm = (t: string) => t.toLowerCase().replace(/[’']s\b/g, "").replace(/[-–]/g, " ").replace(/\s+/g, " ").trim();
const LEAD = /^(?:the|a|an|this|that|these|those|while|and|or|but|so|then|its|their|your)\s+/;

/**
 * The lesson's terms: what it names ("is called X", "known as X", "X means"), the content words of its
 * headings and topic, and words of four or more syllables. Everyday long words are not terms.
 */
export function lessonTermCandidates(scripts: string[], headings: string[] = []): string[] {
  const text = scripts.join(" ");
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(?:called|known as|termed)\s+(?:the\s+|an?\s+)?([a-z][a-z-]*(?:\s+[a-z][a-z-]*)?)/gi)) {
    const words = norm(m[1]).split(" ").filter((w) => !STOP.has(w));
    if (words.length) out.add(words.join(" "));
  }
  for (const m of text.matchAll(/\b([A-Za-z][a-z-]*(?:\s+[a-z][a-z-]*)?)\s+means\b/g)) {
    const term = norm(m[1]).replace(LEAD, "");
    const words = term.split(" ");
    if (words.every((w) => !STOP.has(w) && w.length >= 4)) out.add(term);
  }
  // Heading words of six letters or more: a short heading word ("sides", "money") is an everyday word.
  for (const h of headings) for (const w of norm(h).match(/[a-z]{6,}/g) ?? []) if (!STOP.has(w) && !EVERYDAY.has(w)) out.add(w.replace(/(?:ies)$/, "y").replace(/s$/, ""));
  for (const w of norm(text).match(/[a-z]{6,}/g) ?? []) if (syllables(w) >= 4 && !EVERYDAY.has(w) && !STOP.has(w)) out.add(w.replace(/s$/, ""));
  return [...out].filter((t) => t.length >= 4);
}

/** How often `term` is said in `text` (whole words, a plural or hyphen counts as the same). */
export function termCount(text: string, term: string): number {
  const words = norm(term).split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`\\b${words.join("[\\s-]+")}(?:s|es)?\\b`, "gi");
  return (norm(text).match(re) ?? []).length;
}

export type OverusedTerm = { term: string; count: number; perBoard: number[] };

/**
 * Terms said too often (owner: "after introducing it once, mostly use the plain phrase"): more than
 * `perBoard` times on one board, or more than the lesson's allowance (one a board, six at least) in all.
 * A word said mostly inside a longer term is counted as that term only.
 */
export function overusedTerms(scripts: string[], headings: string[] = [], options: { perBoard?: number; lesson?: number; topic?: string } = {}): OverusedTerm[] {
  const perBoardMax = options.perBoard ?? 3;
  const lessonMax = options.lesson ?? Math.max(6, scripts.length);
  const text = scripts.join(" ");
  // The lesson's own subject ("…linear equations") is said on every board by nature: only a board that piles it up counts.
  const topicWords = new Set(norm(options.topic ?? "").match(/[a-z]{4,}/g)?.map((w) => w.replace(/s$/, "")) ?? []);
  const counted = lessonTermCandidates(scripts, headings).map((term) => {
    const perBoard = scripts.map((s) => termCount(s, term));
    return { term, perBoard, count: perBoard.reduce((a, b) => a + b, 0) };
  }).filter((t) => t.count > 0);
  const phrases = counted.filter((t) => t.term.includes(" "));
  const kept = counted.filter((t) => t.term.includes(" ") || !phrases.some((p) => p.term.split(" ").includes(t.term) && p.count >= t.count * 0.6));
  return kept
    // A name ("the Third Estate", "Enlightenment"): written with a capital most of the times it is said.
    .filter((t) => !isMostlyName(text, t.term))
    .filter((t) => (t.count > lessonMax && !t.term.split(" ").every((w) => topicWords.has(w))) || t.perBoard.some((n) => n > perBoardMax))
    .sort((a, b) => b.count - a.count);
}

/** Said mostly with a capital, in the middle of a sentence: a name, not a term to plain-word. */
function isMostlyName(text: string, term: string): boolean {
  const first = term.split(" ")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const uses = [...text.matchAll(new RegExp(`(^|[.!?:]\\s+|\\s)(${first})`, "gi"))].filter((m) => !/[.!?:]/.test(m[1]) && m.index !== 0);
  const capital = uses.filter((m) => /^[A-Z]/.test(m[2])).length;
  return uses.length > 0 && capital / uses.length >= 0.5;
}

/* ── sentences that are not natural sentences ──────────────────────────────────────────────── */

export type Fragment = { i: number; why: string };

/**
 * Sentences that read as broken: one that starts mid-sentence (a dash or a small letter), one with a
 * heading word capitalised in the middle as if the heading were pasted in ("…is the Causes?") while the
 * lesson says that word in small letters elsewhere, and a few words with a number and no verb ("Part of 2%.").
 */
export function fragmentSentences(script: string, heading = "", lessonText = script): Fragment[] {
  const out: Fragment[] = [];
  const headingWords = new Set((heading.toLowerCase().match(/[a-z]{4,}/g) ?? []));
  const lowerUses = (w: string) => (lessonText.match(new RegExp(`\\b${w}s?\\b`, "g")) ?? []).length;
  sentencesOf(script).forEach((sentence, i) => {
    const s = sentence.replace(/^["“‘'(]+/, "");
    if (/^[—–-]|^\.\.\.|^…/.test(s)) return out.push({ i, why: "it starts with a dash, mid-thought" });
    if (/^[a-z]/.test(s)) return out.push({ i, why: "it starts mid-sentence, with a small letter" });
    const tokens = s.split(/\s+/);
    for (let k = 1; k < tokens.length; k++) {
      const raw = tokens[k].replace(/[^A-Za-z]/g, "");
      if (!/^[A-Z][a-z]{3,}$/.test(raw)) continue;
      const prev = tokens[k - 1];
      const next = tokens[k + 1] ?? "";
      // Part of a name ("the Third Estate", "Second World War") or after a colon: a capital is right there.
      if (/[:.!?]$/.test(prev) || /^[A-Z]/.test(prev.replace(/^["“‘'(]+/, "")) || /^[A-Z]/.test(next)) continue;
      // Two names joined ("the First and Second Estates", "Bank of England").
      if (/^(?:and|or|of|de|la|von|van|&)$/i.test(next) && /^[A-Z]/.test(tokens[k + 2] ?? "")) continue;
      // A common word the lesson otherwise writes small, capitalised here as if a heading or label were pasted in.
      const lower = raw.toLowerCase();
      if (lowerUses(lower) >= (headingWords.has(lower) ? 1 : 2)) return out.push({ i, why: `"${raw}" is capitalised mid-sentence, as if a ${headingWords.has(lower) ? "heading" : "label"} were pasted in` });
    }
    const words = wordList(s);
    if (words.length <= 4 && /\d/.test(s) && !/[=?!]/.test(s) && !/\b(?:is|are|was|were|gives?|makes?|equals?|has|have|had|get|gets|got|pay|pays|paid|costs?|leaves?)\b/i.test(s)) out.push({ i, why: "it is a few words and a number, not a sentence" });
  });
  return out;
}

/* ── currency and units ───────────────────────────────────────────────────────────────────── */

/** Major currencies, by their symbols and names. ("pounds" alone is also a weight, so only "£" and "pounds sterling".) */
const CURRENCIES: Array<[string, RegExp]> = [
  ["dollars", /(?:US)?\$\s?\d|\bdollars?\b/gi],
  ["pounds", /£\s?\d|\bpounds? sterling\b/gi],
  ["euros", /€\s?\d|\beuros?\b/gi],
  ["rupees", /[₹₨]\s?\d|\bRs\.?\s?\d|\brupees?\b/gi],
  ["yen", /\byen\b/gi],
  ["yuan", /\byuan\b|\brenminbi\b/gi],
  ["naira", /₦\s?\d|\bnaira\b/gi],
  ["taka", /৳\s?\d|\btaka\b/gi],
  ["rand", /\brand\b(?=\s|[.,;])/g],
  ["pesos", /\bpesos?\b/gi],
  ["dirhams", /\bdirhams?\b/gi],
  ["riyals", /\briy?als?\b/gi],
  ["ringgit", /\bringgit\b/gi],
  ["shillings", /\bshillings?\b/gi],
  ["francs", /\bfrancs?\b/gi],
  ["livres", /\blivres?\b/gi],
];

export function currenciesIn(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [name, re] of CURRENCIES) {
    const n = (text.match(re) ?? []).length;
    if (n) out.set(name, n);
  }
  return out;
}

/**
 * ONE CURRENCY A LESSON (a lesson switched currencies half-way). Null when it uses one, or when it is ABOUT
 * more than one (exchange, conversion). Else the main one (most used; the first said on a tie) and the boards
 * that use another.
 */
export function mixedCurrency(scripts: string[]): { main: string; others: string[]; boards: number[] } | null {
  const all = scripts.join(" ");
  if (/\b(?:exchange rates?|exchanged?|convert(?:ed|ing|s)?|conversion|currenc(?:y|ies) (?:markets?|union))\b/i.test(all)) return null;
  const counts = currenciesIn(all);
  if (counts.size < 2) return null;
  const firstAt = (name: string) => scripts.findIndex((s) => currenciesIn(s).has(name));
  const main = [...counts.entries()].sort((a, b) => b[1] - a[1] || firstAt(a[0]) - firstAt(b[0]))[0][0];
  const others = [...counts.keys()].filter((c) => c !== main);
  return { main, others, boards: scripts.flatMap((s, i) => (others.some((o) => currenciesIn(s).has(o)) ? [i] : [])) };
}

const TIME_UNIT = "(second|minute|hour|day|week|month|year|night|shift|term)";
const RESULT = /=|\bequals?\b|\bgives?\b|\bwhich is\b|\bmakes?\b|\bcomes to\b/i;

/**
 * A RATE THAT CHANGES ITS UNIT INSIDE ONE CALCULATION ("10 dollars multiplied by 4 hours, which equals 40
 * dollars per day"): the result is "per <unit>" but nothing before it is per that unit or counts that unit.
 * Also a working line that gives two different rates for one result. Null when the units hold.
 */
export function rateUnitClash(line: string): string | null {
  const marker = RESULT.exec(line);
  if (!marker) return null;
  const before = line.slice(0, marker.index);
  const after = line.slice(marker.index);
  const resultRate = new RegExp(`(?:\\bper|\\/|\\ba|\\ban|\\beach)\\s*${TIME_UNIT}s?\\b`, "i").exec(after);
  if (!resultRate) return null;
  const unit = resultRate[1].toLowerCase();
  // The working already counts in that unit ("8 hours a day", "per day", "daily"): it holds.
  const adverb: Record<string, RegExp> = { day: /\bdaily\b/i, hour: /\bhourly\b/i, week: /\bweekly\b/i, month: /\bmonthly\b/i, year: /\byearly\b|\bannual/i };
  if (new RegExp(`\\b${unit}s?\\b`, "i").test(before) || adverb[unit]?.test(before)) return null;
  const inputRates = [...before.matchAll(new RegExp(`(?:\\bper|\\/)\\s*${TIME_UNIT}s?\\b`, "gi"))].map((m) => m[1].toLowerCase());
  const inputUnits = [...before.matchAll(new RegExp(`\\d[\\d.,]*\\s*${TIME_UNIT}s?\\b`, "gi"))].map((m) => m[1].toLowerCase());
  if (!inputRates.length && !inputUnits.length) return null;
  return `the result is "per ${unit}" but the working is in ${[...new Set([...inputRates.map((u) => `per ${u}`), ...inputUnits.map((u) => `${u}s`)])].join(" and ")}: keep the same unit through the calculation, or say the step that converts it`;
}

/* ── lines of working ─────────────────────────────────────────────────────────────────────── */

/** A line that is only numbers and signs ("50 − 40 = 10"): bare arithmetic, with no word saying what it is. */
export function isBareArithmetic(line: string): boolean {
  const t = line.replace(/\\(?:times|div|cdot|left|right|,)/g, " ").replace(/[{}]/g, "").trim();
  return /=/.test(t) && /\d/.test(t) && /^[\d\s.,+\-−–×÷*/=()[\]%^:≈<>]+$/.test(t);
}

export type WorkingLine = { text: string; label?: string };

/**
 * Faults in a board's lines of working: a bare arithmetic line with no label (a caption or a note on its
 * sentence) saying what it works out, two currencies in one line, a rate whose unit changes in the line.
 */
export function workingLineIssues(lines: WorkingLine[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const t = line.text.replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (isBareArithmetic(t) && !(line.label && /[a-z]{3,}/i.test(line.label))) out.push(`the line "${t}" is bare arithmetic: give it a short label saying what it works out, and put the units on its numbers`);
    const money = currenciesIn(t);
    if (money.size > 1) out.push(`the line "${t}" mixes ${[...money.keys()].join(" and ")}: use one currency`);
    const clash = rateUnitClash(t);
    if (clash) out.push(`in the line "${t}", ${clash}`);
  }
  return [...new Set(out)];
}

/**
 * A board's lines of working: each equation step's row with its caption (or the note on its sentence) as its
 * label, and every note. What `workingLineIssues` reads.
 */
export function boardWorkingLines(spec: Pick<CanvasBoardSpec, "notes" | "stage">): WorkingLine[] {
  const out: WorkingLine[] = [];
  const noteOn = (s: number) => spec.notes.find((n) => n.s === s && /[a-z]{3,}/i.test(n.text.replace(/\d/g, "")))?.text;
  if (spec.stage.kind === "equation") {
    const text = new Map(spec.stage.tokens.map((t) => [t.id, t.text]));
    for (const step of spec.stage.steps) out.push({ text: step.order.map((id) => text.get(id) ?? "").join(" "), label: step.caption || noteOn(step.s) });
  }
  for (const n of spec.notes) out.push({ text: n.text, label: /[a-z]{3,}/i.test(n.text.replace(/\d/g, "")) ? n.text : undefined });
  return out;
}

/* ── claims with no exceptions ─────────────────────────────────────────────────────────────── */

const ABSOLUTE = /\b(none|never|always|nobody|no one|nothing|entirely|completely|totally|all of|every single|not any|not a single|no (?:taxes?|money|rights?|power|say|vote|role|effect|one|tax))\b/i;

/** The all-or-nothing word a sentence leans on ("paid none", "never", "always"), for the fact-check to weigh; null when there is none. */
export function absoluteClaim(sentence: string): string | null {
  const m = ABSOLUTE.exec(sentence);
  return m ? m[1].toLowerCase() : null;
}

/* ── one board's script, for the rewrite ───────────────────────────────────────────────────── */

export type WordingTarget = { grade: number; sentenceWords: number };

/**
 * What the wording rewrite must fix on one board: above the reading grade, sentences over the length,
 * a term said too often, a sentence that is not a natural sentence, another currency than the lesson's,
 * a unit changing inside a calculation. Empty when the board reads well.
 */
export function scriptIssues(script: string, target: WordingTarget, lesson: { heading?: string; lessonText?: string; overused?: OverusedTerm[]; boardIndex?: number; currency?: ReturnType<typeof mixedCurrency> } = {}): string[] {
  const issues: string[] = [];
  const r = readability(script, target.sentenceWords);
  if (r.grade > target.grade + 1) issues.push(`it reads at grade ${r.grade}; aim for grade ${Math.max(2, target.grade - 1)}`);
  if (r.long.length) issues.push(`sentence${r.long.length === 1 ? "" : "s"} ${r.long.map((i) => i + 1).join(", ")} ha${r.long.length === 1 ? "s" : "ve"} more than ${target.sentenceWords} words: make ${r.long.length === 1 ? "it" : "each"} two short sentences, one idea each`);
  const k = lesson.boardIndex ?? -1;
  for (const t of lesson.overused ?? []) {
    const here = k >= 0 ? t.perBoard[k] ?? 0 : termCount(script, t.term);
    if (here >= 2) issues.push(`"${t.term}" is said ${t.count} times in the lesson (${here} here): say it once where it matters, and use the plain words for it the other times`);
  }
  for (const f of fragmentSentences(script, lesson.heading ?? "", lesson.lessonText ?? script)) issues.push(`sentence ${f.i + 1} is not a natural sentence (${f.why}): say it as one whole, natural spoken sentence`);
  if (lesson.currency && k >= 0 && lesson.currency.boards.includes(k)) issues.push(`it uses ${lesson.currency.others.join(" and ")}, but the lesson's money is ${lesson.currency.main}: say every amount in ${lesson.currency.main}`);
  sentencesOf(script).forEach((s, i) => { const clash = rateUnitClash(s); if (clash) issues.push(`sentence ${i + 1}: ${clash}`); });
  return issues;
}

/** One lesson's numbers for the QA log and the before/after report. */
export function lessonReadability(scripts: string[], headings: string[] = [], sentenceWords = 15, topic = ""): { grade: number; maxSentenceWords: number; meanSentenceWords: number; longSentences: number; overused: OverusedTerm[]; currency: ReturnType<typeof mixedCurrency>; fragments: number; unitClashes: number } {
  const all = scripts.join(" ");
  const r = readability(all, sentenceWords);
  return {
    grade: r.grade,
    maxSentenceWords: r.maxSentenceWords,
    meanSentenceWords: r.meanSentenceWords,
    longSentences: r.long.length,
    overused: overusedTerms(scripts, headings, { topic }),
    currency: mixedCurrency(scripts),
    fragments: scripts.reduce((n, s, i) => n + fragmentSentences(s, headings[i] ?? "", all).length, 0),
    unitClashes: scripts.reduce((n, s) => n + sentencesOf(s).filter((x) => rateUnitClash(x)).length, 0),
  };
}

/* ── a rewrite that may split a long sentence in two ───────────────────────────────────────── */

/** The fields of a plan board that point at its sentences by number. */
export type SentenceIndexed = {
  script: string;
  boardNotes?: Array<{ s: number; text: string }>;
  teachingCycle?: { teach: number; predict: number; reveal: number; transfer: number };
  sentenceBlocks?: string[];
};

/**
 * A rewrite given as ONE ENTRY PER ORIGINAL SENTENCE, each entry one sentence or (when `maxPerEntry` is 2) two
 * short ones. Everything that points at a sentence by number follows it: a note on a split sentence goes with its
 * first half (the board is re-timed to the words later). Null when the entries do not line up with the sentences.
 * A strict-source board (`sentenceBlocks`) never splits: each sentence is boxed against its own passage.
 */
export function applySentenceRewrite<T extends SentenceIndexed>(beat: T, entries: unknown, maxPerEntry = 2): Pick<T, "script" | "boardNotes" | "teachingCycle" | "sentenceBlocks"> | null {
  const old = sentencesOf(beat.script);
  if (!Array.isArray(entries) || entries.length !== old.length) return null;
  const most = beat.sentenceBlocks?.length ? 1 : maxPerEntry;
  const pieces: string[][] = [];
  for (const e of entries) {
    const text = typeof e === "string" ? e.replace(/\s+/g, " ").trim() : "";
    const parts = sentencesOf(text);
    if (!parts.length || parts.length > most || !/[.!?۔؟]$/.test(text)) return null;
    pieces.push(parts);
  }
  const start: number[] = [];
  let at = 0;
  for (const p of pieces) { start.push(at); at += p.length; }
  const map = (s: number) => start[Math.max(0, Math.min(start.length - 1, s))];
  const out = { script: pieces.flat().join(" ") } as Pick<T, "script" | "boardNotes" | "teachingCycle" | "sentenceBlocks">;
  if (beat.boardNotes) out.boardNotes = beat.boardNotes.map((n) => ({ ...n, s: map(n.s) }));
  if (beat.teachingCycle) { const c = beat.teachingCycle; out.teachingCycle = { teach: map(c.teach), predict: map(c.predict), reveal: map(c.reveal), transfer: map(c.transfer) }; }
  if (beat.sentenceBlocks) out.sentenceBlocks = pieces.flatMap((p, i) => p.map(() => beat.sentenceBlocks![i] ?? beat.sentenceBlocks![beat.sentenceBlocks!.length - 1]));
  return out;
}
