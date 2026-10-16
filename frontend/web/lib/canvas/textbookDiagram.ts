import "server-only";

import type OpenAI from "openai";
import { costFor } from "../modelPricing";
import { drawIllustration, illustrationImageModel, locateParts, prepareStoredIllustration, verifyParts } from "../illustratedBoard";
import { loadSharedCanvasImage, loadSharedDiagramRecord, saveSharedCanvasImage, saveSharedDiagramRecord } from "./store";
import { TEXTBOOK_STYLE_VERSION, textbookDiagramKey, textbookPrompt } from "./textbookPrompt";

export { TEXTBOOK_STYLE_VERSION, textbookDiagramKey, textbookPrompt };

/**
 * TEXTBOOK DIAGRAMS GENERATED IN REAL TIME, CHECKED, AND REMEMBERED.
 *
 * Hand-built diagrams reach only the topics someone thought of (about 12% of 163,399 lessons had an
 * exact one, scan 2026-10-17). Any board about a real thing — an organ, an apparatus, a landform —
 * gets its diagram here instead:
 *
 *   1. remembered: a diagram of the same subject and parts that passed its checks before is served
 *      at once, with its label points (no model call);
 *   2. drawn by the image model in strict textbook style, the parts it must show and the subject's
 *      conventions named, no text;
 *   3. checked by a vision model acting as a textbook editor — accurate, conventional, every part
 *      visible, no text — and redrawn once with that editor's corrections if it fails;
 *   4. its parts located on the picture and those points checked again (lib/illustratedBoard.ts);
 *   5. stored with a verified record, so the next student gets it instantly.
 *
 * A diagram that cannot pass is not shown: the caller falls back to a plain board that is correct.
 */

const CHECK_MODEL = process.env.ILLUSTRATION_LOCATE_MODEL ?? "gpt-5.6-luna";

export type DiagramPart = { name: string; x: number; y: number };
export type DiagramRecord = {
  key: string;
  subject: string;
  parts: DiagramPart[];
  check: { accurate: boolean; problems: string[] };
  model: string;
  style: string;
  createdAt: string;
};

/** The textbook editor's verdict on a drawn picture. */
export async function checkTextbookPicture(openai: OpenAI, jpeg: Buffer, subject: string, parts: string[]): Promise<{ accurate: boolean; missing: string[]; problems: string[]; textInImage: boolean; costUsd: number }> {
  const res = await openai.chat.completions.create({
    model: CHECK_MODEL,
    response_format: { type: "json_object" },
    max_completion_tokens: 2500,
    reasoning_effort: "low",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: `You are a strict school-textbook editor checking ONE generated diagram before a student sees it. It should show: ${subject}. It must show these parts: ${parts.join("; ") || "(none listed)"}.
Reject it ("accurate": false) for anything a teacher would correct: wrong anatomy or structure, parts missing or merged, wrong connections, reversed colour conventions, impossible proportions, a decorative or cartoon style instead of a textbook diagram, or any letters, numbers or labels in the picture. Do not reject it for being simple, for style details, or for parts that were not listed.
Return JSON {"accurate": boolean, "missing": [listed parts that are not clearly visible], "problems": [each problem in a few words, saying what to change], "textInImage": boolean}.` },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` } },
      ],
    }],
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  const raw = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { accurate?: boolean; missing?: unknown[]; problems?: unknown[]; textInImage?: boolean };
  const list = (v: unknown[] | undefined) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 160)).filter(Boolean).slice(0, 8) : []);
  return { accurate: raw.accurate !== false, missing: list(raw.missing), problems: list(raw.problems), textInImage: raw.textInImage === true, costUsd: costFor(CHECK_MODEL, res.usage) };
}

/**
 * Textbook-editor check for a VECTOR diagram. Text and numbers ARE allowed and must be spelled
 * as the narration spells them. Off unless DIAGRAM_VISION=on — a failed check is a repair hint,
 * never a hard rejection of the board.
 */
export async function checkVectorDiagram(openai: OpenAI, png: Buffer, subject: string, parts: string[], narration: string): Promise<{ accurate: boolean; missing: string[]; problems: string[]; misspellings: string[]; costUsd: number }> {
  const res = await openai.chat.completions.create({
    model: CHECK_MODEL,
    response_format: { type: "json_object" },
    max_completion_tokens: 2500,
    reasoning_effort: "low",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: `You are a school-textbook editor checking ONE labelled VECTOR diagram. Text and numbers ARE allowed and must be spelled correctly. It should show: ${subject}.
Parts it claims to label: ${parts.join("; ") || "(none listed)"}.
Narration (the only source of numbers and names): ${narration.slice(0, 1200)}
Judge accuracy against the subject's usual textbook conventions (e.g. warm ocean currents red, cold blue; oxygenated blood red).
Reject only for wrong facts, wrong geography, wrong counts, reversed colour conventions, or misspelled labels. Do not reject it for being simple, sparse, or schematic.
Return JSON {"accurate": boolean, "missing": [listed parts not clearly visible], "problems": [what to change, in a few words], "misspellings": [wrongly spelled labels]}.` },
        { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } },
      ],
    }],
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  const raw = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { accurate?: boolean; missing?: unknown[]; problems?: unknown[]; misspellings?: unknown[] };
  const list = (v: unknown[] | undefined) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 160)).filter(Boolean).slice(0, 8) : []);
  return { accurate: raw.accurate !== false, missing: list(raw.missing), problems: list(raw.problems), misspellings: list(raw.misspellings), costUsd: costFor(CHECK_MODEL, res.usage) };
}

export type TextbookDiagram = {
  key: string;
  display: Buffer;
  paper: string;
  parts: DiagramPart[];
  cached: boolean;
  costUsd: number;
  log: string;
};

type Budget = { left: () => number };

/**
 * The pipeline. `share` stores and reuses the verified diagram across students (only for subjects
 * that hold no student data — never a student's own document). Throws when no diagram passes.
 */
export async function textbookDiagram(openai: OpenAI, subject: string, parts: string[], options: { share: boolean; budget: Budget; save: (name: string, display: Buffer) => Promise<void> }): Promise<TextbookDiagram> {
  const key = textbookDiagramKey(subject, parts);
  let costUsd = 0;

  // 1. Remembered and verified: served at once.
  if (options.share) {
    const [record, image] = await Promise.all([loadSharedDiagramRecord<DiagramRecord>(key), loadSharedCanvasImage(key)]);
    if (record?.check.accurate && image && record.parts.length) {
      const stored = await prepareStoredIllustration(image);
      return { key, display: stored.display, paper: stored.paper, parts: record.parts, cached: true, costUsd: stored.costUsd, log: "verified diagram reused" };
    }
  }

  // 2–3. Drawn, checked, and drawn again with the editor's corrections when it fails.
  let corrections: string[] = [];
  let best: { picture: Awaited<ReturnType<typeof drawIllustration>>; verdict: Awaited<ReturnType<typeof checkTextbookPicture>> } | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1 && options.budget.left() < 100_000) break;
    const picture = await drawIllustration(openai, textbookPrompt(subject, parts, corrections));
    costUsd += picture.costUsd;
    const verdict = await checkTextbookPicture(openai, picture.jpeg, subject, parts);
    costUsd += verdict.costUsd;
    const faults = (verdict.accurate ? 0 : 3) + verdict.missing.length + (verdict.textInImage ? 2 : 0);
    const bestFaults = best ? (best.verdict.accurate ? 0 : 3) + best.verdict.missing.length + (best.verdict.textInImage ? 2 : 0) : Infinity;
    if (faults < bestFaults) best = { picture, verdict };
    if (verdict.accurate && !verdict.textInImage && verdict.missing.length <= Math.floor(parts.length / 4)) break;
    corrections = [...verdict.problems, ...verdict.missing.map((m) => `show the ${m} clearly`), ...(verdict.textInImage ? ["remove every letter, number and label"] : [])];
  }
  if (!best || !best.verdict.accurate || best.verdict.textInImage) {
    throw new Error(`no diagram passed the textbook check: ${best ? [...best.verdict.problems, ...(best.verdict.textInImage ? ["text in image"] : [])].join("; ") || "inaccurate" : "not drawn"}`);
  }

  // 4. Every part located, and the points checked once more.
  const located = await locateParts(openai, best.picture.jpeg, subject, parts);
  costUsd += located.costUsd;
  const checked = options.budget.left() > 40_000 ? await verifyParts(openai, best.picture.jpeg, subject, located.parts).catch(() => ({ parts: located.parts, corrected: [] as string[], costUsd: 0 })) : { parts: located.parts, corrected: [] as string[], costUsd: 0 };
  costUsd += checked.costUsd;
  if (checked.parts.length < Math.max(2, Math.ceil(parts.length * 0.6))) throw new Error(`only ${checked.parts.length} of ${parts.length} parts could be found on the diagram`);

  // 5. Stored, with its verified record when it may be shared.
  await options.save(key, best.picture.display);
  if (options.share) {
    await saveSharedCanvasImage(key, best.picture.display).catch(() => undefined);
    const record: DiagramRecord = { key, subject, parts: checked.parts, check: { accurate: true, problems: best.verdict.problems }, model: illustrationImageModel(), style: TEXTBOOK_STYLE_VERSION, createdAt: new Date().toISOString() };
    await saveSharedDiagramRecord(key, record).catch(() => undefined);
  }
  return { key, display: best.picture.display, paper: best.picture.paper, parts: checked.parts, cached: false, costUsd, log: `generated, checked${corrections.length ? " after one correction" : ""}, ${checked.parts.length}/${parts.length} parts located${checked.corrected.length ? `, corrected ${checked.corrected.join(", ")}` : ""}` };
}
