import { splitNarrationSentences } from "./voice";
import type { DyslexiaChunk, ReadingLevel } from "./dyslexiaLectureContent";

/**
 * Turn any beat script into short, standalone lines — with no model call.
 *
 * WHY THIS EXISTS. The dyslexia track used to read its lines from a hand-authored map keyed by the
 * twelve demo beat ids. A generated lecture has ids like `pdf-1`, so the lookup missed, the
 * narration effect returned early, and the lesson sat frozen on beat one with no audio and no way
 * forward. This is the floor that makes that impossible: every beat can always be split into
 * something speakable, instantly and offline.
 *
 * IT IS THE FALLBACK, NOT THE PRODUCT. Splitting on punctuation cannot genuinely simplify language —
 * it cannot swap "synthesise" for "make" — so the three reading levels differ here only in how much
 * text they show and how short the lines are. The real rewrite comes from the model
 * (`/api/dyslexia-chunks`), and this holds the screen together until it lands, or forever if it
 * fails.
 */

/** Longest line we will show, per level. Chosen from the hand-authored content: 5 words median. */
const MAX_WORDS: Record<ReadingLevel, number> = {
  simplest: 6,
  simple: 9,
  standard: 14,
};

/**
 * How many lines a beat gets before we stop.
 *
 * A generated script runs 100-150 words. Shown in full at six words a line that is twenty-five
 * lines, which is the wall of text this mode exists to prevent. Lower levels deliberately show
 * less, not just smaller.
 */
const MAX_LINES: Record<ReadingLevel, number> = {
  simplest: 5,
  simple: 8,
  standard: 12,
};

/**
 * Icons stand in for meaning, so they are matched on what a line is ABOUT.
 *
 * Ordered, first match wins — specific before general, since "water" appearing in a sentence about
 * energy should still read as energy if that word came first in the list.
 */
const ICON_RULES: Array<[RegExp, string]> = [
  [/\b(sun|sunlight|light|solar|photon)\b/i, "☀️"],
  [/\b(water|liquid|rain|h2o|moist)\b/i, "💧"],
  [/\b(plant|leaf|leaves|tree|grow|root)\b/i, "🌱"],
  [/\b(air|gas|oxygen|carbon|dioxide|co2)\b/i, "💨"],
  [/\b(energy|power|fuel|charge)\b/i, "⚡"],
  [/\b(food|sugar|glucose|eat|nutrient)\b/i, "🍬"],
  [/\b(cell|molecule|atom|particle|tiny)\b/i, "🔬"],
  [/\b(heat|hot|warm|temperature|burn)\b/i, "🔥"],
  [/\b(number|count|calculate|equation|formula|maths?|math)\b/i, "🔢"],
  [/\b(time|speed|fast|slow|second|minute)\b/i, "⏱️"],
  [/\b(move|motion|force|push|pull|gravity)\b/i, "🏃"],
  [/\b(compare|versus|difference|opposite|unlike)\b/i, "⚖️"],
  [/\b(because|so|therefore|means|result)\b/i, "➡️"],
  [/\b(question|why|how|what|wonder)\b/i, "❓"],
  [/\b(remember|important|key|note)\b/i, "⭐"],
];

/**
 * Icons for lines that match no rule.
 *
 * NOT a bullet. `•` is punctuation, not an emoji, and in the icon slot it renders as a blank box
 * beside lines that have a real picture — which reads as a missing image rather than a neutral
 * mark. These are deliberately generic and cycled by position, so a beat looks paced rather than
 * captioned with the same symbol five times over.
 */
const NEUTRAL_ICONS = ["📘", "🧩", "🔎", "🗂️", "🧠"];

export function iconForText(text: string, position = 0): string {
  for (const [pattern, icon] of ICON_RULES) {
    if (pattern.test(text)) return icon;
  }
  return NEUTRAL_ICONS[position % NEUTRAL_ICONS.length];
}

/**
 * Break one sentence at its natural joins.
 *
 * Splitting purely on word count would cut mid-phrase ("the plant uses light / to make sugar" is
 * fine; "the plant uses / light to make sugar" is not). Conjunctions and punctuation are where a
 * reader would pause anyway, so they are tried first, and a hard word-count split is the last
 * resort for a clause that is still too long.
 */
function splitClause(sentence: string, maxWords: number): string[] {
  const parts = sentence
    .split(/\s*[—–;:]\s*|,\s+(?=and\b|but\b|so\b|which\b|because\b|then\b)|\s+(?=and then\b)/i)
    .map((part) => part.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const part of parts) {
    const words = part.split(/\s+/);
    if (words.length <= maxWords) {
      out.push(part);
      continue;
    }
    // Still too long: break on the remaining commas before falling back to counting words.
    const commaParts = part.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
    for (const piece of commaParts.length > 1 ? commaParts : [part]) {
      const pieceWords = piece.split(/\s+/);
      if (pieceWords.length <= maxWords) {
        out.push(piece);
        continue;
      }
      out.push(...hardWrap(pieceWords, maxWords));
    }
  }

  // The same orphan rule across clauses: a comma or semicolon split can also leave a stub ("Has.",
  // "Building.") that no pull-back inside a single clause can see.
  const merged: string[] = [];
  for (const line of out) {
    if (merged.length > 0 && line.split(/\s+/).length <= 2) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${line}`;
      continue;
    }
    merged.push(line);
  }
  return merged;
}

/**
 * Words a line must never end on.
 *
 * Counting words alone produced lines like "And the more mass an object." / "Has." — grammatical
 * debris that is harder to read than the original sentence, which defeats the entire point. So a
 * cut is pulled back to the last word that can actually end a phrase.
 */
const NEVER_END_ON = new RegExp(
  "^(" +
    [
      // articles + determiners
      "a", "an", "the", "this", "that", "these", "those", "its", "his", "her", "their", "our", "your",
      // quantifiers — "between any." and "the more mass an object." both came from these
      "any", "some", "each", "every", "both", "all", "more", "most", "less", "few", "many", "much",
      "one", "two", "three", "no",
      // conjunctions + subordinators
      "and", "but", "or", "so", "as", "than", "then", "when", "while", "which", "who", "because", "if",
      // prepositions
      "of", "to", "in", "on", "at", "by", "for", "with", "from", "into", "onto", "about", "over",
      "under", "through", "between", "against",
      // auxiliaries — a line ending "has." is the clearest symptom
      "is", "are", "was", "were", "be", "been", "being", "am", "has", "have", "had", "do", "does",
      "did", "will", "would", "can", "could", "may", "might", "must", "should",
      // pronouns that dangle
      "it", "they", "we", "you", "he", "she",
    ].join("|") +
    ")$",
  "i",
);

/** Split an over-long clause, preferring a break that leaves each side readable. */
function hardWrap(words: string[], maxWords: number): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < words.length) {
    // Take a full line, then walk the end backwards off any word that cannot close a phrase.
    let end = Math.min(start + maxWords, words.length);
    if (end < words.length) {
      let cut = end;
      while (cut > start + 2 && NEVER_END_ON.test(words[cut - 1])) cut -= 1;
      // Only accept the pull-back if it leaves a line worth reading.
      if (cut > start + 2) end = cut;
    }
    out.push(words.slice(start, end).join(" "));
    start = end;
  }

  /**
   * Absorb an orphan tail.
   *
   * Pulling a cut backwards fixes the line it was on and pushes the problem to the next one — which
   * is how "…an object." was followed by a line reading only "Has." A one- or two-word remainder is
   * never a sentence, so it goes back onto the line it came from even though that line then runs a
   * little long. Slightly over the limit beats grammatical debris.
   */
  while (out.length > 1 && out[out.length - 1].split(/\s+/).length <= 2) {
    const orphan = out.pop() as string;
    out[out.length - 1] = `${out[out.length - 1]} ${orphan}`;
  }
  return out;
}

/** Sentence-case a fragment and give it a full stop, so a cut clause still reads as a line. */
function tidy(line: string): string {
  const trimmed = line.replace(/^[\s,;:—–]+/, "").replace(/[\s,;:—–]+$/, "").trim();
  if (!trimmed) return "";
  const cased = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(cased) ? cased : `${cased}.`;
}

/**
 * Split a script into short lines with icons.
 *
 * Never throws and never returns an empty array for non-empty input — the caller uses this to
 * guarantee a beat is always playable.
 */
export function heuristicChunks(script: string, level: ReadingLevel): DyslexiaChunk[] {
  const source = (script ?? "").trim();
  if (!source) return [];

  const maxWords = MAX_WORDS[level] ?? MAX_WORDS.simple;
  const maxLines = MAX_LINES[level] ?? MAX_LINES.simple;

  const lines: string[] = [];
  for (const sentence of splitNarrationSentences(source)) {
    for (const clause of splitClause(sentence, maxWords)) {
      const line = tidy(clause);
      if (line) lines.push(line);
    }
    if (lines.length >= maxLines) break;
  }

  // A script with no sentence-ending punctuation yields nothing above; fall back to the raw text so
  // the beat still speaks.
  const kept = (lines.length ? lines : [tidy(source)]).filter(Boolean).slice(0, maxLines);
  return kept.map((text, i) => ({ text, icon: iconForText(text, i) }));
}
