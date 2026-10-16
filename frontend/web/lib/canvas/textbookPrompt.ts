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

/** What the image model is asked to draw: the subject, the parts it must show, the conventions, any corrections. */
export function textbookPrompt(subject: string, parts: string[], corrections: string[] = []): string {
  return [
    `${subject.replace(/[.\s]+$/, "")}.`,
    parts.length ? `It must clearly show, each as a distinct, separately identifiable structure: ${parts.join("; ")}.` : "",
    "Draw it the way a standard school science textbook (Cambridge O/A Level, IGCSE, AP) draws it: the conventional view (cross-section, cut-away or frontal as textbooks use), correct proportions and connections, and the subject's standard colour conventions (for example oxygenated blood red and deoxygenated blood blue).",
    corrections.length ? `An earlier drawing was rejected; correct these: ${corrections.join("; ")}.` : "",
  ].filter(Boolean).join(" ");
}

