/**
 * TEXT A DIAGRAM CAN ACTUALLY DRAW. Diagrams are drawn in the board font (lib/anim/boardFont.ts:
 * Nunito SemiBold, full TTF) — in the browser through the board's font stack, on the server through
 * resvg with the same file plus system fonts. Nunito has no geometry symbols, and some have no
 * fallback in any common font either: "OM ⟂ AB" rendered as "□□□□□□□" (QA 2026-10-17; resvg on
 * macOS with system fonts draws ⟂ ⊾ ∡ ⦜ ⫽ as boxes and the whole run with them). Such symbols are
 * written as words before a diagram is drawn.
 *
 * Measured with the font's cmap: Nunito also lacks
 * Greek, arrows and ∠ ≅ ≡ ∴ ∵ ∥ ∈ ∝ ⇒ ⇔, which browsers and resvg take from a system font; those are
 * left alone when a common fallback exists, and mapped when it does not or when it is a rare relation
 * sign a student may not read as intended.
 */

const WORDS: Array<[RegExp, string]> = [
  // Relations of lines and shapes.
  [/\s*[⟂⊥]\s*/gu, " perpendicular to "],
  [/\s*[∥⫽]\s*/gu, " parallel to "],
  [/\s*∦\s*/gu, " not parallel to "],
  [/\s*≅\s*/gu, " congruent to "],
  [/\s*∼\s*/gu, " similar to "],
  // Angle signs before a name ("∠ABC" → "angle ABC").
  [/[∠∡⦜]\s*/gu, "angle "],
  [/[∟⊾]\s*/gu, "right angle "],
  // Reasoning signs.
  [/\s*∴\s*/gu, " so "],
  [/\s*∵\s*/gu, " because "],
  [/\s*⇒\s*/gu, " so "],
  [/\s*⇔\s*/gu, " if and only if "],
  [/\s*∝\s*/gu, " proportional to "],
  // A fraction slash the face lacks.
  [/⁄/gu, "/"],
];

/** Units written with a superscript minus ("m s⁻¹", "J kg⁻¹"): the face has ¹ but not ⁻. */
function units(text: string): string {
  return text
    .replace(/\s?([A-Za-z]{1,3})⁻¹/g, "/$1")
    .replace(/⁻([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_, d: string) => `^-${[...d].map((c) => "⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(c)).join("")}`)
    .replace(/⁺/g, "+");
}

const SUB = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₔₕₖₗₘₙₚₛₜ";
const SUB_ASCII = "0123456789+-=()aeoxəhklmnpst";
/**
 * Subscripts: the face has the digits ₀–₉ but no subscript letters or signs, and one missing glyph
 * turns the whole label into boxes in resvg ("uₙ = …" from a sequences figure, QA 2026-10-17). A run
 * with any letter or sign is written "u_n", "a_(n+1)"; digit-only runs ("H₂O", "v₁") stay.
 */
function subscripts(text: string): string {
  return text.replace(/[₀-₉₊₋₌₍₎ₐ-ₜ]+/gu, (run) => {
    if (/^[₀-₉]+$/u.test(run)) return run;
    const plain = [...run].map((c) => SUB_ASCII[SUB.indexOf(c)] ?? "").join("");
    return plain.length === 1 ? `_${plain}` : `_(${plain})`;
  });
}

/** The text with every symbol the board font cannot draw written as words or ASCII. */
export function drawableText(text: string): string {
  let out = subscripts(units(text)).replace(/⩽/gu, "≤").replace(/⩾/gu, "≥");
  for (const [re, word] of WORDS) out = out.replace(re, word);
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Symbols that draw as boxes even with system fallback fonts (resvg, macOS, 2026-10-17). */
export const NO_FALLBACK = /[⟂⊾∡⦜⫽⩽⩾ₐ-ₜ₊₋₌]/u;
