import { canvasSentences } from "./plan";
import type { CanvasBoardSpec, CanvasCue, IllustrationStage } from "./types";

/**
 * ARIA TALKS THE STUDENT THROUGH THE PICTURE (owner, 2026-10-25: "explain the figure more, like point at
 * different parts of the figure, and actually relate the board text to the figure"). On a course board's
 * picture, every time a sentence names a labelled part the pointer goes to it at the moment she says it,
 * not once per label: the first mention circles the part, a later one points at it again. Up to three
 * parts a sentence, in the order she names them. Nothing is drawn on the picture for it (owner, later
 * the same day: no ring or dot — the picture's printed labels are the only labels); the camera leans in
 * and Dot flies to the part.
 *
 * Pure: the cues come from the script and the picture's located parts (lib/canvas/coursePicturePrompt.ts
 * withCoursePicture, lib/canvas/mathsPicture.ts withMathsPicture); lib/canvas/layout.ts draws the link from a
 * note to the part it names.
 */
export function partMentionCues(spec: CanvasBoardSpec, script: string): CanvasCue[] {
  const picture = pictureOf(spec);
  // A maths picture (lib/canvas/mathsPicture.ts, white on black on the board) is talked through the same way,
  // by its printed labels only: the pointer goes to a label read off the picture, never to a guessed point.
  const maths = Boolean(picture?.onBoard);
  if (!picture?.coursePicture && !maths) return spec.cues;
  const parts = picture!.parts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && (maths ? Boolean(p.labelBox) : talkable(p.name)));
  const named = maths ? mathsMentionAt : mentionAt;
  if (!parts.length) return spec.cues;
  const ids = new Set(parts.map((p) => p.id));
  const sentences = canvasSentences(script);
  const mentioned = new Set<string>();
  const cues: CanvasCue[] = [];
  sentences.forEach((sentence, s) => {
    const hits = parts
      .map((p) => ({ p, at: named(sentence, p.name) }))
      .filter((h) => h.at >= 0)
      .sort((a, b) => a.at - b.at)
      .slice(0, 3);
    for (const h of hits) {
      cues.push({ s, at: Math.round(Math.min(0.85, Math.max(0.05, h.at / Math.max(1, sentence.length))) * 100) / 100, action: mentioned.has(h.p.id) ? "point" : "circle", target: h.p.id });
      mentioned.add(h.p.id);
    }
  });
  // A labelled part the narration never names keeps the pointer it had on its label's sentence.
  const kept = spec.cues.filter((c) => !(c.target && ids.has(c.target) && (c.action === "point" || c.action === "circle")) || (c.target && !mentioned.has(c.target)));
  return [...kept, ...cues].sort((a, b) => a.s - b.s || (a.at ?? 0) - (b.at ?? 0));
}

/** The picture on a board: a picture board's, or the one beside a course board's working. */
export function pictureOf(spec: CanvasBoardSpec): IllustrationStage | undefined {
  return spec.stage.kind === "illustration" ? spec.stage : spec.stage.kind === "equation" ? spec.stage.picture : undefined;
}

/** A maths label written as a symbol or a short expression ("a", "C", "AB", "m + n", "90°", "x′"), not in words. */
export function symbolLabel(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= 12 && !/[A-Za-z]{3,}/.test(t);
}

/**
 * Where a maths picture's label is NAMED in the text, or -1. A symbol is named only as the part it labels —
 * after a word for that part ("legs a and b", "hypotenuse c", "its side length is a + b", "angle at C",
 * "Bases: a and b") — never inside working ("a² = c·m", "where m + n = c", "(a + b)²"), where pointing at
 * the picture would be noise. A label in words ("trapezoid", "height") is found as on a course picture.
 */
export function mathsMentionAt(text: string, name: string): number {
  if (!symbolLabel(name)) return mentionAt(text, name);
  const pattern = new RegExp(name.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*"), "g");
  for (const m of text.matchAll(pattern)) {
    const at = m.index!;
    const end = at + m[0].length;
    if (/[A-Za-z0-9_²³′']/.test(text[at - 1] ?? " ") || /[A-Za-z0-9_²³′'^]/.test(text[end] ?? " ")) continue;
    // Part of working: an operator straight before or after it.
    const after = text.slice(end).trimStart();
    if (/[-+−=×·*/^(]$/.test(text.slice(0, at).trimEnd()) || /^[-+−=×·*/^²³(]/.test(after)) continue;
    // ... or said aloud ("side length a plus b" is the length a + b, not side a).
    if (/^(?:plus|minus|times|over|divided|multiplied|squared|cubed|to the power)\b/i.test(after)) continue;
    // "a", "A" and "I" are words too: "the corner of a room" names no side a.
    if (/^[aAI]$/.test(name.trim()) && /^[A-Za-z]{2,}/.test(after) && !/^(?:and|or|is|are|was|has|have|meets?|lies|on|at|of|in|to|from|with|opposite)\b/i.test(after)) continue;
    if (NAMED.test(text.slice(Math.max(0, at - 60), at))) return at;
  }
  return -1;
}

const PART = "(?:sides?|legs?|hypotenuses?|angles?|vertex|vertices|corners?|points?|segments?|lines?|lengths?|bases?|heights?|altitudes?|radius|radii|diameters?|chords?|arcs?|edges?|widths?|labell?ed|called|marked|named)";
const LINK = "(?:of|is|are|has|have|equal|equals|to|at|its|the|length|lengths|called|labell?ed|by|as)";
const SYM = "(?:[A-Za-z]{1,2}[′']?|\\d+°?)";
/** Text ending in a word for a part of the figure, then perhaps "is", "of length", and earlier symbols of a list ("a and"). */
const NAMED = new RegExp(`\\b${PART}\\b(?:\\s+${LINK}\\b)*\\s*[:=]?\\s*(?:${SYM}\\s*(?:,\\s*and|,|and|or)\\s*)*$`, "i");

/** A part the pointer can follow by name: a one-letter label ("M", "r") is a symbol the working uses everywhere. */
export function talkable(name: string): boolean {
  return name.trim().length >= 2;
}

/**
 * Where in the text a part is named (its whole name, else its longest word), or -1. Apostrophes, hyphens and
 * raised or lowered digits either way ("polar-bonds" is "polar bonds", "sp²" is "sp2"); a two-letter name keeps
 * its case ("pH" is not "ph" inside a word, "Na" is not "na").
 */
export function mentionAt(text: string, name: string): number {
  const short = name.trim().length <= 2;
  const plain = (t: string) => (short ? t : t.toLowerCase()).replace(/[’‘]/g, "'").replace(/[-_‐–]/g, " ").replace(/[⁰¹²³⁴-⁹₀-₉]/g, (d) => DIGITS[d] ?? d);
  const said = plain(text);
  const whole = plain(name).trim();
  const at = wordAt(said, whole);
  if (at >= 0) return at;
  // "the left ventricle" names "Left ventricle wall"; a one-word part needs the word itself.
  const words = whole.split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w));
  if (words.length < 2) return -1;
  const longest = [...words].sort((a, b) => b.length - a.length)[0];
  const other = words.find((w) => w !== longest);
  const a = wordAt(said, longest);
  return a >= 0 && other && wordAt(said, other) >= 0 ? a : -1;
}

function wordAt(text: string, word: string): number {
  if (!word) return -1;
  for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) {
    const before = text[i - 1] ?? " ";
    const after = text[i + word.length] ?? " ";
    // Whole words, and a plural or possessive ending is the same part ("capillaries", "kidney's").
    if (!/[a-z0-9]/.test(before) && (!/[a-z0-9]/.test(after) || /^(s|es|'s)\b/.test(text.slice(i + word.length)))) return i;
  }
  return -1;
}

const DIGITS: Record<string, string> = Object.fromEntries([..."⁰¹²³⁴⁵⁶⁷⁸⁹"].map((d, i) => [d, String(i)]).concat([..."₀₁₂₃₄₅₆₇₈₉"].map((d, i) => [d, String(i)])));

const STOP = new Set(["with", "from", "into", "that", "this", "their", "which", "where", "part", "side", "layer"]);
