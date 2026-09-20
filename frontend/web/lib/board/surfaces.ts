/**
 * WHICH BOARD THIS CONCEPT BELONGS ON.
 *
 * The surface was a single value for the whole board, set by the document-import path — its own
 * comment says it exists "for imported note-style lessons". Nothing ever chose it for teaching
 * reasons, so every generated lecture used the same black chalkboard whatever it was explaining,
 * and there was no way to put a derivation on chalk beside a data table on white.
 *
 * Real teachers pick. Chalk for working something out in front of you — derivations, proofs, a
 * diagram built stroke by stroke — because the medium suits marks that accumulate and get rubbed
 * out. Whiteboard for anything that must be read precisely: data, code, colour-coded comparisons,
 * anything where a faint chalk line is a liability. And a SPLIT board when the lesson is doing two
 * things at once, which is the case this codebase could not express at all: the worked example on
 * the left, the rule it demonstrates held on the right.
 *
 * The choice is made from the concept's own words, deterministically, so it costs nothing and
 * cannot fail. A model may override it by setting `surface` explicitly; this is the default when
 * it does not, which is almost always.
 */

export type BoardSurface = "chalk" | "white" | "split";

export interface SurfaceChoice {
  surface: BoardSurface;
  /** For a split board, what each half is for. */
  panes?: { left: BoardSurface; right: BoardSurface };
  /** Why, for the decision log and for anyone wondering why a board looks the way it does. */
  reason: string;
}

/**
 * Subjects that are WORKED, not displayed: the board is a place to think, marks accumulate, and
 * the student is meant to follow a hand moving rather than read a finished artefact.
 */
const WORKED = /\b(deriv|proof|prove|solve|step[- ]by[- ]step|work(ing|ed)? (it )?out|substitut|rearrang|factor|integrat|differentiat|expand|simplify|equation|formula|theorem|calculat)/i;

/**
 * Subjects that must be READ EXACTLY. A faint chalk stroke is fine for an arrow and wrong for a
 * column of numbers or a line of code, where a misread character is a misunderstanding.
 */
const PRECISE = /\b(table|data|dataset|code|syntax|function|array|matrix|spreadsheet|column|row|chart|graph|plot|axis|axes|statistic|percentage|figure|number|value|measurement|result)/i;

/** Lessons that hold two things side by side — the case a single surface could not express. */
const COMPARATIVE = /\b(versus|vs\.?|compare|comparison|contrast|difference between|before and after|left and right|two (kinds|types|ways|approaches)|either|whereas|on one hand)/i;

export function chooseSurface(input: { title: string; objective?: string; script?: string }): SurfaceChoice {
  const text = `${input.title} ${input.objective ?? ""} ${input.script ?? ""}`;

  if (COMPARATIVE.test(text)) {
    /*
     * A comparison wants both halves visible at once, and the halves are rarely the same KIND of
     * thing: "the naive approach versus the vectorised one" is worked reasoning against precise
     * code. Chalk on the left for the argument, white on the right for what must be read exactly.
     */
    return {
      surface: "split",
      panes: { left: "chalk", right: PRECISE.test(text) ? "white" : "chalk" },
      reason: "a comparison — both sides stay on the board together",
    };
  }

  if (PRECISE.test(text) && !WORKED.test(text)) {
    return { surface: "white", reason: "data, code or figures that have to be read exactly" };
  }

  if (WORKED.test(text)) {
    return { surface: "chalk", reason: "something worked out in front of the student" };
  }

  // The default is chalk: a lecture board is somewhere a teacher thinks out loud, not a slide.
  return { surface: "chalk", reason: "explanation, built as it is spoken" };
}

/**
 * The CSS surface a pane renders as.
 *
 * `LiveSketch` speaks "dark" | "paper" and every existing board carries one of those, so this maps
 * rather than replaces — a board authored before surfaces existed keeps rendering exactly as it
 * did, and nothing has to be regenerated.
 */
export function toLiveSketchSurface(surface: BoardSurface): "dark" | "paper" {
  return surface === "white" ? "paper" : "dark";
}

/** Ink that reads on a given surface. Chalk is not white paint and paper is not a dark board. */
export function inkFor(surface: BoardSurface): { primary: string; accent: string; muted: string } {
  return surface === "white"
    ? { primary: "#1e293b", accent: "#b45309", muted: "#64748b" }
    : { primary: "#f8fafc", accent: "#fcd34d", muted: "#94a3b8" };
}
