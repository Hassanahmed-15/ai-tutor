import { createHash } from "node:crypto";

/**
 * The pure parts of the textbook-diagram pipeline (lib/canvas/textbookDiagram.ts): the cache key a
 * verified diagram is remembered under, and what the image model is asked to draw.
 */

const IMAGE_MODEL = process.env.ILLUSTRATION_IMAGE_MODEL ?? "gpt-image-1-mini";

export const TEXTBOOK_STYLE_VERSION = "textbook-v3";

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9α-ω⁺⁻₀-₉ ]+/g, " ").replace(/\b(a|an|the|of|and|with|showing|diagram|labelled|labeled|textbook|clear|simple)\b/g, " ").replace(/\s+/g, " ").trim();

/** One key per subject and set of parts, whatever the wording's case or filler words. */
export function textbookDiagramKey(subject: string, parts: string[]): string {
  const signature = JSON.stringify({ model: IMAGE_MODEL, style: TEXTBOOK_STYLE_VERSION, subject: norm(subject), parts: [...new Set(parts.map(norm))].sort() });
  return `asset-${createHash("sha256").update(signature).digest("hex").slice(0, 32)}`;
}

/**
 * What the image model is asked to draw: the subject, the parts it must show, the conventions, any
 * corrections. Every part must be drawn apart from its neighbours: a part hidden behind another, or
 * merged into it, is a part no label can point at correctly.
 */
export function textbookPrompt(subject: string, parts: string[], corrections: string[] = []): string {
  return [
    `${subject.replace(/[.\s]+$/, "")}.`,
    parts.length ? `It must clearly show each of these as its own distinct, fully visible structure, not hidden behind or merged into another: ${parts.join("; ")}.` : "",
    // A swimmer and a man jumping off a boat, on a Newton's-laws board, came back with a heart and red and
    // blue blood vessels drawn on their bodies (prompt bench, 2026-10-18): the style line asked every
    // picture for a cut-away and gave blood colours as its example. Inside views and colour codes are for
    // subjects about the inside.
    "Draw it the way a standard school textbook (Cambridge O/A Level, IGCSE, AP) draws it: the conventional view for this subject — a cross-section or cut-away only when the subject is about what is inside something; otherwise the outside, as it is seen — physically correct, with correct proportions, positions and connections, and the subject's own standard colour conventions (oxygenated blood red and deoxygenated blood blue only for circulation). Draw nothing the subject does not ask for: a person, animal or object in a physics, chemistry, geography or everyday scene is drawn from the outside, with no organs, bones or blood vessels.",
    corrections.length ? `An earlier drawing was rejected; correct these: ${corrections.join("; ")}.` : "",
  ].filter(Boolean).join(" ");
}
