/**
 * WHAT THE STUDENT POINTED AT, TURNED INTO A QUESTION THE TUTOR CAN ANSWER.
 *
 * The old "explain my drawing" sent the ENTIRE board as one image with the prompt "the student drew
 * the attached image". That is a weak question in two ways: the model has to guess which part of a
 * dense diagram the student meant, and it receives none of the words on the board — so a circle
 * around the denominator of an equation arrives as pixels, and the answer is about the picture
 * rather than about the denominator.
 *
 * A selection carries three things instead:
 *
 *   THE REGION — the bounding box of what was actually marked, in board space, so the image sent is
 *   a crop rather than the whole surface.
 *   THE WORDS UNDER IT — the board's own text, read from the DOM at the moment of marking. This is
 *   the strongest signal available and it costs nothing: if the student underlined "ΣΔG", the tutor
 *   is told that literally instead of inferring it from a rasterised squiggle.
 *   WHERE THE LESSON IS — the concept being taught and the sentence being spoken, so "what is this"
 *   is answered in the context of the current explanation rather than in the abstract.
 *
 * Pure: takes strokes and lesson state, returns a request. No canvas, no fetch — so what gets asked
 * is testable without a browser.
 */

import type { AnnotationStroke } from "./annotations";

export interface SelectionRegion {
  /** Bounding box in board space, 0..1. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExplainRequest {
  /** The crop the tutor should look at, padded so the mark is not flush against the edge. */
  region: SelectionRegion;
  /** Board text the marks passed over, deduplicated and ordered as drawn. */
  selectedText: string;
  /** What kind of gesture this was, which changes what the student is likely asking. */
  gesture: "circle" | "underline" | "highlight" | "scribble";
  /** The question to ask, already phrased for the gesture and context. */
  question: string;
}

/** Marks beyond this far apart are separate thoughts, not one selection. */
const CLUSTER_GAP = 0.18;

/** Breathing room around the crop, in board space — a mark flush to the edge loses its context. */
const PADDING = 0.04;

export function boundsOf(strokes: AnnotationStroke[]): SelectionRegion | null {
  const points = strokes.flatMap((stroke) => stroke.points);
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.max(0, Math.min(...xs) - PADDING);
  const minY = Math.max(0, Math.min(...ys) - PADDING);
  const maxX = Math.min(1, Math.max(...xs) + PADDING);
  const maxY = Math.min(1, Math.max(...ys) + PADDING);
  return { x: minX, y: minY, width: Math.max(0.02, maxX - minX), height: Math.max(0.02, maxY - minY) };
}

/**
 * Which strokes belong to the gesture the student just made.
 *
 * A student who underlined a term three minutes ago and now circles a graph means the graph. Taking
 * every mark on the board would send both and produce an answer about neither, so a selection is
 * the most recent stroke plus anything drawn near it.
 */
export function recentSelection(strokes: AnnotationStroke[]): AnnotationStroke[] {
  if (strokes.length === 0) return [];
  const last = strokes[strokes.length - 1];
  const anchor = boundsOf([last]);
  if (!anchor) return [last];
  const centre = { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 };
  return strokes.filter((stroke) => {
    const b = boundsOf([stroke]);
    if (!b) return false;
    const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    return Math.hypot(c.x - centre.x, c.y - centre.y) <= CLUSTER_GAP;
  });
}

/**
 * What shape did the student draw?
 *
 * The gesture changes the question: a circle around something asks "what is this", an underline
 * asks "why does this matter", a highlight over a phrase asks about the phrase. Inferred from the
 * geometry rather than from a tool mode, because a student circling with the highlighter still
 * means "this thing here".
 */
export function classifyGesture(strokes: AnnotationStroke[]): ExplainRequest["gesture"] {
  const last = strokes[strokes.length - 1];
  if (!last || last.points.length < 2) return "scribble";
  if (last.kind === "highlight") return "highlight";
  /*
   * The RAW extent, not `boundsOf` — that pads by 0.04 a side for the crop, which inflates a flat
   * underline (0.005 tall) to 0.085 and makes it look like a loop. The crop wants breathing room;
   * the shape test wants the stroke itself.
   */
  const xs = last.points.map((p) => p.x);
  const ys = last.points.map((p) => p.y);
  const b = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
  const start = last.points[0];
  const end = last.points[last.points.length - 1];
  const closed = Math.hypot(end.x - start.x, end.y - start.y) < Math.max(b.width, b.height) * 0.4;
  // A wide, flat, open stroke is a line under something; a closed loop encircles it.
  if (!closed && b.height < 0.05 && b.width > 0.08) return "underline";
  if (closed && b.width > 0.04 && b.height > 0.03) return "circle";
  return "scribble";
}

export function buildExplainRequest(
  strokes: AnnotationStroke[],
  lesson: { conceptTitle?: string; currentSentence?: string },
): ExplainRequest | null {
  const selection = recentSelection(strokes);
  const region = boundsOf(selection);
  if (!region) return null;

  const selectedText = [...new Set(selection.map((s) => s.coveredText ?? "").filter(Boolean))].join(" · ");
  const gesture = classifyGesture(selection);

  /*
   * The question names the gesture, the words and the lesson position, in that order of confidence.
   * When the board's own text was captured it leads, because it is the only part of this that is
   * certain — everything else is an inference from pixels.
   */
  const parts: string[] = [];
  if (selectedText) {
    parts.push(
      gesture === "underline"
        ? `The student underlined "${selectedText}" on the board.`
        : gesture === "highlight"
          ? `The student highlighted "${selectedText}" on the board.`
          : `The student circled "${selectedText}" on the board.`,
    );
  } else {
    parts.push(
      gesture === "circle"
        ? "The student circled a region of the board, shown in the attached crop."
        : gesture === "underline"
          ? "The student underlined something on the board, shown in the attached crop."
          : "The student marked the region of the board shown in the attached crop.",
    );
  }
  if (lesson.conceptTitle) parts.push(`You are currently teaching "${lesson.conceptTitle}".`);
  if (lesson.currentSentence) parts.push(`You had just said: "${lesson.currentSentence}"`);
  parts.push(
    "Explain exactly what they marked, in two or three spoken sentences. Answer about THAT, not about the whole board, and connect it to what you were just explaining.",
  );

  return { region, selectedText, gesture, question: parts.join(" ") };
}
