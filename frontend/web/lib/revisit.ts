import type { Beat } from "./lessonContent";
import { boardPictureMemoryOf, pointOnBoard, zoomView } from "./anim/illustratedLayout";

/**
 * GO BACK TO THE SLIDE THAT TAUGHT IT.
 *
 * The owner's brief (2026-09-29): "if a user asks a question on slide 9 about a topic already
 * explained on slide 1, no need to create it again — go to slide 1 and draw something or write
 * something on that to explain", then "jump back, then return": Aria says it was covered on slide 1,
 * slide 1 comes back on screen, the pen rings what she is talking about and writes a short note on
 * it, and the lecture carries on from where it stopped when the student says continue.
 *
 * This module decides WHICH earlier slide a question is about — deterministically and instantly, so
 * a question that is about the current slide goes on to the ordinary answer with no model call and
 * no delay — and lists what is on that slide's board for the answer to point at.
 */

const STOP = new Set(
  ("a an the and or but if of to in on at by for from with about into over under is are was were be been being do does did " +
    "what whats why how when where which who whom whose can could would should will shall may might must i me my we our you your it its " +
    "this that these those there here again explain explained tell say said mean means meant show shown slide part board earlier before " +
    "back remind reminded understand understood get got still not no yes please just really more some any also so then than very thing things " +
    "happen happens happened work works go going come make makes made like one lot bit kind sort way use used using help know")
    .split(/\s+/),
);

function stem(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9₂₃]/g, "").replace(/(ies)$/, "y").replace(/(es|s)$/, "");
}

export function questionTerms(question: string): string[] {
  const words = question.toLowerCase().split(/[^a-z0-9₂₃]+/).filter((w) => w.length > 2 && !STOP.has(w));
  return [...new Set(words.map(stem).filter((w) => w.length > 2))];
}

/** Every word written on a board: its texts, its listed labels, and a picture's located parts. */
export function boardWordsOf(beat: Beat): string[] {
  return [...new Set([...writtenWordsOf(beat), ...picturedPartsOf(beat)])];
}

/** What a board WRITES: its texts and its listed labels. */
function writtenWordsOf(beat: Beat): string[] {
  const words = new Set<string>();
  for (const op of beat.draw?.ops ?? []) {
    const code = (op as { code?: unknown }).code;
    if (typeof code !== "string") continue;
    for (const m of code.matchAll(/<text\b[^>]*>([^<{}]{2,80})<\/text>/g)) words.add(m[1].trim());
    for (const block of code.match(/<BoardLabels\b[\s\S]*?\/>/g) ?? []) {
      for (const m of block.matchAll(/\btext\s*:\s*"([^"]{2,60})"/g)) words.add(m[1].trim());
    }
  }
  return [...words].filter(Boolean);
}

/**
 * The parts a picture board's picture shows. Pictured, not taught: a slide building on an earlier
 * slide's picture carries all of its parts, whichever of them it talked about.
 */
function picturedPartsOf(beat: Beat): string[] {
  const parts: string[] = [];
  for (const op of beat.draw?.ops ?? []) {
    const memory = boardPictureMemoryOf((op as { code?: unknown }).code as string | undefined) as { parts?: Array<{ name?: unknown }> } | null;
    for (const part of memory?.parts ?? []) if (typeof part.name === "string") parts.push(part.name);
  }
  return parts;
}

function vocabulary(beat: Beat): { strong: Set<string>; weak: Set<string> } {
  const strong = new Set<string>();
  const weak = new Set<string>();
  const add = (set: Set<string>, text: string) => {
    for (const w of text.toLowerCase().split(/[^a-z0-9₂₃]+/)) if (w.length > 2 && !STOP.has(w)) set.add(stem(w));
  };
  add(strong, beat.title);
  for (const w of writtenWordsOf(beat)) add(strong, w);
  for (const w of picturedPartsOf(beat)) add(weak, w);
  for (const claim of beat.keyClaims ?? []) add(weak, typeof claim === "string" ? claim : "");
  add(weak, beat.script);
  return { strong, weak };
}

const EXPLICIT_ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };

/**
 * "Go back to slide 2", "on the first slide", "the previous slide": the slide the student named,
 * 0-based, when it is an earlier one.
 */
export function explicitSlide(question: string, currentIndex: number): number | null {
  const q = question.toLowerCase();
  const numbered = /\b(?:slide|part|board)\s*(?:number\s*)?(\d{1,2})\b/.exec(q);
  if (numbered) return Number(numbered[1]) - 1;
  const ordinal = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:slide|part|board)\b/.exec(q);
  if (ordinal) return EXPLICIT_ORDINALS[ordinal[1]] - 1;
  if (/\b(?:previous|last|earlier)\s+(?:slide|part|board)\b/.test(q)) return currentIndex - 1;
  return null;
}

export type RevisitTarget = { index: number; reason: "named" | "taught"; terms: string[] };

/**
 * The earlier slide a question is about, or null to answer it as usual.
 *
 * A question is sent back only when an earlier slide taught its subject clearly more than the
 * current one does. Its words count twice when that slide's title or board WRITES them, once when
 * its narration says them or its picture merely shows them. A word on most of the lecture's slides
 * (the lecture's own topic, "photosynthesis" throughout a photosynthesis lecture) points nowhere in
 * particular and is not counted. The slide with the most wins; a tie goes to the earliest, where the
 * idea was first taught.
 */
export function findRevisitTarget(question: string, beats: Beat[], currentIndex: number): RevisitTarget | null {
  const hasBoard = (beat: Beat | undefined) => Boolean(beat && beat.slideKind !== "checkpoint" && beat.draw?.ops?.length);
  const named = explicitSlide(question, currentIndex);
  if (named !== null) {
    return named >= 0 && named < currentIndex && hasBoard(beats[named]) ? { index: named, reason: "named", terms: [] } : null;
  }
  const terms = questionTerms(question);
  if (!terms.length || currentIndex <= 0) return null;
  const seen = beats.slice(0, currentIndex + 1).map(vocabulary);
  const n = seen.length;
  const topical = (term: string) => {
    const df = seen.filter((v) => v.strong.has(term) || v.weak.has(term)).length;
    return df >= 3 && df / n > 0.6;
  };
  const counted = terms.filter((t) => !topical(t));
  const score = (v: { strong: Set<string>; weak: Set<string> }) =>
    counted.reduce((sum, t) => sum + (v.strong.has(t) ? 2 : v.weak.has(t) ? 1 : 0), 0);
  const current = score(seen[currentIndex]);
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < currentIndex; i++) {
    if (!hasBoard(beats[i])) continue;
    const s = score(seen[i]);
    if (s > bestScore + 1e-9) {
      best = i;
      bestScore = s;
    }
  }
  if (best < 0 || bestScore < 2 || current * 2 > bestScore) return null;
  return { index: best, reason: "taught", terms: terms.filter((t) => seen[best].strong.has(t) || seen[best].weak.has(t)) };
}

/** A written word on the old board to ring: matched by its text in the sandbox. */
export type RevisitMark = { text: string } | { x: number; y: number; name: string };

/**
 * Where to ring the answer's parts on the old board: a word written on it is ringed where it is
 * written; a picture's part with no label is ringed ON the picture, at the point the picture board
 * located it (through that board's own zoom).
 */
export function revisitMarks(beat: Beat, names: string[]): RevisitMark[] {
  const written = new Map(boardWordsOf(beat).map((w) => [w.toLowerCase(), w]));
  const code = (beat.draw?.ops ?? []).map((op) => (op as { code?: unknown }).code).find((c): c is string => typeof c === "string") ?? "";
  const memory = boardPictureMemoryOf(code) as { parts?: Array<{ name: string; x: number; y: number }>; focus?: string | null } | null;
  const labelled = new Set<string>();
  for (const m of code.matchAll(/textAnchor="middle">([^<]+)<\/text>/g)) labelled.add(m[1].toLowerCase());
  const focus = memory?.focus ? memory.parts?.find((p) => p.name === memory.focus) ?? null : null;
  const view = zoomView(focus);
  const marks: RevisitMark[] = [];
  for (const raw of names.slice(0, 3)) {
    const name = raw.trim().toLowerCase();
    const part = memory?.parts?.find((p) => p.name.toLowerCase() === name);
    if (part && !labelled.has(name)) {
      const { px, py } = pointOnBoard(part, view);
      marks.push({ x: Math.round(px), y: Math.round(py), name: part.name });
    } else if (written.has(name)) {
      marks.push({ text: written.get(name)! });
    }
  }
  return marks;
}
