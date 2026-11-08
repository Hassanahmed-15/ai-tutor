// Board ink and shared drawing defaults (black board, bright chalk colours).
// ARIA'S BOARD (owner, 2026-11-08: "I don't like the text being colourful … an aesthetic, clean board"):
// lines and words are one soft white chalk; ONE accent, gold, marks what is being talked about (Aria's
// copy of the engine; maths-lab keeps its bright chalk). Every named colour a scene asks for is that white,
// except the quiet greys; a chart's series keep muted, distinct tones so their bars and slices still read.
const CHALK = "#E9EBF0";
export const ACCENT = "#F5C451";
export const INK = {
  white: CHALK, yellow: CHALK, cyan: CHALK, pink: CHALK, green: CHALK,
  orange: CHALK, grey: "#9a9aa6", dim: "#7d7d86", shade: "#8a8a96", red: CHALK, violet: CHALK,
};
export const COLOURS = ["white", "yellow", "cyan", "pink", "green", "orange", "grey", "dim", "red", "violet"];
/** Colours given in turn to the series of a chart, the slices of a pie… (muted, told apart by tone). */
export const SERIES = ["#9FB4C9", "#C9B49F", "#A6C3A0", "#C4A3B6", "#B1A9C9", "#C9C29F", "#A0C2C4", "#B8B8BE"];
export const BOARD_BG = "#000000";
export const colour = (c, fallback = INK.white) => (c ? INK[c] ?? (String(c).startsWith("#") ? c : fallback) : fallback);
export const HIDDEN = { fixed: true, highlight: false, visible: false, showInfobox: false };
// A thin black halo keeps every number and label readable where a line runs behind it.
// Words and numbers in the board's own clean upright face (Nunito SemiBold, as Aria's notes) (never a cursive hand); a single maths letter (A, x, θ, a′)
// in KaTeX's maths italic, as a textbook prints it.
const HALO = "text-shadow:0 0 2px #000,0 0 3px #000,0 0 4px #000,0 0 1px #000;white-space:nowrap;";
export const FONT = `font-family:"Aria Board","Nunito",system-ui,sans-serif;font-weight:600;${HALO}`;
export const MATH_FONT = `font-family:KaTeX_Math,"Times New Roman",serif;font-style:italic;${HALO}`;
/** A label that is one maths letter, maybe primed or with a digit: written in maths italic. */
export const isMathLetter = (t) => /^\s*[A-Za-zα-ωΑ-Ωθφ](?:['′]|[0-9₀-₉])?\s*$/.test(String(t));
