import "server-only";

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type OpenAI from "openai";
import { costFor, priceFor } from "../modelPricing";
import { locateParts, prepareStoredIllustration } from "../illustratedBoard";
import { loadSharedCanvasImage, loadSharedDiagramRecord, saveSharedCanvasImage, saveSharedDiagramRecord } from "./store";
import { printedLabelBoxes } from "./labelLeaders";
import { coursePictureKey, coursePicturePrompt, fieldsPrompt, labelsInPicture, labelsInRecognisedText, labelsMatch, lettersToText, mustFix, parsePictureFields, type CourseBoardContext, type Inspection, type PictureFields } from "./coursePicturePrompt";

/**
 * A COURSE LESSON'S PICTURE, DRAWN WITH ITS LABELS BY gpt-image-2 (owner, 2026-10-24: course lessons
 * switch to gpt-image-2 at medium quality — 33/33 labels exact and 0 of 6 boards wrong in the test, where
 * gpt-image-1-mini had 5 of 6 wrong). The board's own context goes in (lib/canvas/coursePicturePrompt.ts);
 * what comes out is the picture AND what Aria needs to teach from it: where each label points, so the
 * pen and the camera go to the part she names, and a description of what the picture shows, for the
 * voice tutor.
 *
 * The first picture is checked: every label read back letter by letter and compared in code, and a strict
 * teacher checks the facts, where each label's line ends and any invented, missing or not-allowed part.
 * Only a must-fix fault (lib/canvas/coursePicturePrompt.ts mustFix) redraws it — ONCE; the redraw is shown
 * exactly as it is, with no more checks and no fallback (owner, 2026-10-24: "redraw it one time only then
 * just show it exactly how it is"). A picture that passed its check is remembered for every student; an
 * unchecked redraw is not, so the next student's lesson gets its own first try.
 *
 * THE BOARD IS LOOKED AT TOO (owner, 2026-10-24: "the board itself should have a visual check of what it
 * contains"): the finished board, picture and writing together, goes to the board's vision check
 * (lib/canvas/progressive.ts). A picture is remembered for other students only once that check passes
 * too (`remember`), and the board's check may ask for the ONE redraw when the picture's own check did not
 * use it (`redraw`): still one redraw at most, shown as drawn.
 */
/**
 * COST (owner, 2026-10-24: a picture cost ≈ $0.21–0.29, most of it the checks): the picture is planned by
 * the cheap model, its labels are read back by Tesseract (free; the cheap model when Tesseract is not
 * installed), and only the examiner's look is the strong model, at low effort — ≈ $0.08 a checked picture.
 */
const PLAN_MODEL = process.env.COURSE_PICTURE_PLAN_MODEL ?? "gpt-5.6-luna";
const READ_MODEL = process.env.COURSE_PICTURE_READ_MODEL ?? "gpt-5.6-luna";
// The examiner's look moved to the light model (owner, 2026-10-25); COURSE_PICTURE_CHECK_MODEL=gpt-5.6-sol puts it back.
const CHECK_MODEL = process.env.COURSE_PICTURE_CHECK_MODEL ?? "gpt-5.6-luna";
export const COURSE_IMAGE_MODEL = process.env.COURSE_PICTURE_MODEL ?? "gpt-image-2";
const QUALITY = (process.env.COURSE_PICTURE_QUALITY ?? "medium") as "low" | "medium" | "high";

export function coursePicturesOn(): boolean {
  return process.env.CANVAS_COURSE_PICTURES !== "off";
}

export type CoursePicture = {
  key: string;
  display: Buffer;
  paper: string;
  fields: PictureFields;
  /** Each drawn label: its text, the part it names, the sentence that names it, and where its line ends. */
  labels: Array<{ text: string; part: string; sentence: number; x: number; y: number; /** Where its printed words are (lib/canvas/labelLeaders.ts). */ box?: { x: number; y: number; w: number; h: number } }>;
  description: string;
  cached: boolean;
  /** This picture is the one redraw: nothing may ask for another. */
  redrawn: boolean;
  /** Shares a checked picture with every student — called once the board's own vision check has passed. */
  remember?: () => Promise<void>;
  costUsd: number;
  log: string;
};

/** A picture that could not be made — what was spent finding that out goes back to the board's total. */
export class CoursePictureError extends Error {
  constructor(message: string, readonly costUsd: number) {
    super(message);
  }
}

type Record_ = { key: string; kind: "course-picture"; fields: PictureFields; labels: CoursePicture["labels"]; description: string; model: string; createdAt: string };

async function json(openai: OpenAI, model: string, system: string, content: OpenAI.Chat.ChatCompletionContentPart[] | string, effort = "low"): Promise<{ json: any; costUsd: number }> {
  const res = await openai.chat.completions.create({ model, response_format: { type: "json_object" }, max_completion_tokens: 6000, reasoning_effort: effort, messages: [{ role: "system", content: system }, { role: "user", content }] } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  return { json: JSON.parse(res.choices[0]?.message?.content ?? "{}"), costUsd: costFor(model, res.usage) };
}

const READ_PROMPT = "Read EVERY piece of text visible in this image. For each, first spell it out letter by letter exactly as the pixels show, separated by hyphens (spaces as /), THEN write it. Do NOT correct spelling, do NOT complete words, do NOT guess hidden letters — a misspelt word must stay misspelt. Return JSON {\"texts\": [{\"letters\": string, \"text\": string}]} with one entry per separate piece of text.";

const INSPECT_PROMPT = "You are a subject examiner checking ONE labelled diagram for a lesson board before a student sees it. Judge only what is visible, and only what would mislead a student — not style. Return JSON {\"facts\": [{\"fact\": string, \"true\": boolean, \"why\": string}], \"pointers\": [{\"label\": string, \"result\": \"right part\" | \"edge of right part\" | \"different part\" | \"no line\", \"why\": string}], \"errors\": [{\"kind\": \"invented\" | \"missing\" | \"sensitive\" | \"minor\", \"what\": string}], \"description\": string}. facts: each listed fact, and for an exact diagram also whether every listed value, symbol and formula is written exactly and drawn where it belongs (a curve through its points, a count right, an arrow the right way). errors: \"invented\" — a structure or part the real thing does not have, or any writing that is not one of the listed labels or the listed exact text; \"missing\" — a structure the board needs that is not drawn; \"sensitive\" — a prophet, sacred figure or deity, sacred or scriptural text, a real person's portrait, a real brand logo or a map of a real place; \"minor\" — anything else (cosmetic, a detail the board does not need). description: 2 to 4 plain sentences saying what the picture shows and where each labelled part is in it (left, right, top, centre…), for a teacher who cannot see it.";

/** Every piece of text in the picture, read by Tesseract (free); the cheap reading model when it is missing. */
async function readLabels(openai: OpenAI, png: Buffer, url: OpenAI.Chat.ChatCompletionContentPart): Promise<{ json: { texts: Array<{ letters?: string; text?: string }> }; costUsd: number; ocr?: string }> {
  const text = await tesseract(png);
  if (text !== null) return { json: { texts: [] }, costUsd: 0, ocr: text };
  return json(openai, READ_MODEL, READ_PROMPT, [url]);
}

function tesseract(png: Buffer): Promise<string | null> {
  return (async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aria-ocr-"));
    try {
      const file = path.join(dir, "picture.png");
      await writeFile(file, png);
      // Sparse text (labels scattered around a drawing).
      return await new Promise<string | null>((resolve) => execFile("tesseract", [file, "stdout", "--psm", "11"], { timeout: 20_000 }, (error, stdout) => resolve(error ? null : String(stdout))));
    } catch {
      return null;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  })();
}

/** Plan, draw, check, locate — or a reason it could not be done (thrown). */
export async function coursePicture(openai: OpenAI, ctx: CourseBoardContext, options: { share: boolean; budget: { left: () => number }; save: (key: string, display: Buffer) => Promise<void>; redraw?: string[] }): Promise<CoursePicture> {
  let costUsd = 0;
  const planned = fieldsPrompt(ctx);
  const plan = await json(openai, PLAN_MODEL, planned.system, planned.user);
  costUsd += plan.costUsd;
  const fields = parsePictureFields(plan.json, ctx.sentences.length, ctx.family, ctx.written);
  if (!fields) throw new CoursePictureError("the picture could not be planned from the board", costUsd);
  if (fields.family === "other") throw new CoursePictureError("drawn by code, not a picture (kept on the earlier path)", costUsd);
  // Labels the model writes are checked letter by letter; a no-writing family's picture must have no text at all.
  const inPicture = labelsInPicture(fields.family);
  const expectedText = inPicture ? fields.labels.map((l) => l.text) : [];
  const targets = fields.labels.length ? fields.labels : fields.parts.map((p, i) => ({ text: p.name, pointsTo: p.name, position: "", sentence: Math.min(i, Math.max(0, ctx.sentences.length - 1)) }));
  const key = coursePictureKey(ctx, fields);

  // Remembered: drawn and checked for another student already (not when the board's check refused it).
  if (options.share && !options.redraw) {
    const [record, image] = await Promise.all([loadSharedDiagramRecord<Record_>(key), loadSharedCanvasImage(key)]);
    if (record?.kind === "course-picture" && image) {
      const stored = await prepareStoredIllustration(image);
      await options.save(key, stored.display);
      return { key, display: stored.display, paper: stored.paper, fields: record.fields, labels: record.labels, description: record.description, cached: true, redrawn: false, costUsd, log: "checked picture reused" };
    }
  }

  // Asked for by the board's vision check: this is the one redraw, drawn with its corrections and shown as drawn.
  let corrections: string[] = options.redraw ?? [];
  for (let attempt = options.redraw ? 2 : 1; attempt <= 2; attempt++) {
    const img = await openai.images.generate({ model: COURSE_IMAGE_MODEL, prompt: JSON.stringify(coursePicturePrompt(ctx, fields, corrections), null, 2), size: "1536x1024", quality: QUALITY } as never) as OpenAI.Images.ImagesResponse;
    const usage = img.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    const price = priceFor(COURSE_IMAGE_MODEL);
    costUsd += ((usage?.input_tokens ?? 0) * price.input + (usage?.output_tokens ?? 0) * price.output) / 1_000_000;
    const b64 = img.data?.[0]?.b64_json;
    if (!b64) throw new CoursePictureError("the image model returned no picture", costUsd);
    const picture = await prepareStoredIllustration(Buffer.from(b64, "base64"));
    const url = { type: "image_url" as const, image_url: { url: `data:image/jpeg;base64,${picture.jpeg.toString("base64")}` } };
    // The redraw, or a first picture with no time left for one, is shown as it is: only what Aria needs
    // to teach from it is read (where each label points, what it shows) — nothing can refuse it.
    const final = attempt === 2 || options.budget.left() < 110_000;

    const facts = `The picture should be: ${fields.diagramType} (${fields.scope}), ${fields.view}${fields.exact ? " — an exact diagram" : ""}\nFacts that must be true:\n${fields.mustBeTrue.map((x) => `- ${x}`).join("\n")}\n${inPicture ? `Labels and the part each must point to:\n${fields.labels.map((l) => `- "${l.text}" → ${l.pointsTo}`).join("\n")}${fields.exactText.length ? `\nOther text that must appear exactly as written: ${fields.exactText.map((t) => `"${t}"`).join(", ")}` : ""}${fields.arrows ? `\nArrows: ${fields.arrows}` : ""}` : "This picture must contain NO writing at all; report any visible text as an invented error."}`;
    const [read, inspect, located] = await Promise.all([
      final ? Promise.resolve({ json: { texts: [] }, costUsd: 0 } as Awaited<ReturnType<typeof readLabels>>) : readLabels(openai, picture.display, url),
      json(openai, CHECK_MODEL, INSPECT_PROMPT, [{ type: "text", text: `Board: ${ctx.board}\nWhat the teacher says: ${ctx.sentences.join(" ")}\n${facts}` }, url], "low"),
      locateParts(openai, picture.jpeg, `${fields.diagramType}, ${fields.view}`, targets.map((l) => l.pointsTo)),
    ]);
    costUsd += read.costUsd + inspect.costUsd + located.costUsd;
    const byPart = new Map(located.parts.map((p) => [p.name.toLowerCase(), p]));
    const labels: CoursePicture["labels"] = targets.map((l) => ({ l, at: byPart.get(l.pointsTo.toLowerCase()) })).filter((x) => x.at).map(({ l, at }) => ({ text: l.text, part: l.pointsTo, sentence: l.sentence, x: Math.round(at!.x * 1000) / 1000, y: Math.round(at!.y * 1000) / 1000 }));
    const description = String(inspect.json.description ?? "").replace(/\s+/g, " ").trim().slice(0, 900);

    const inspection = inspect.json as Inspection;
    // In a no-writing picture there are no labels whose line could point anywhere.
    if (!inPicture) inspection.pointers = [];
    const spelling = read.ocr !== undefined
      ? (inPicture ? labelsInRecognisedText(expectedText, read.ocr) : { ok: true, missing: [], extra: [] })
      : labelsMatch(expectedText, ((read.json.texts ?? []) as Array<{ letters?: string; text?: string }>).map((t) => (t.letters ? lettersToText(t.letters) : String(t.text ?? ""))));
    const problems = final ? [] : mustFix(spelling, inspection);
    if (problems.length) {
      corrections = problems.slice(0, 8);
      continue;
    }
    // Where each printed label is: the notes' yellow lines and Aria's pointer go there, never to a guessed point.
    if (inPicture) {
      const boxes = await printedLabelBoxes(picture.display, labels.map((l) => l.text)).catch(() => new Map<string, NonNullable<CoursePicture["labels"][number]["box"]>>());
      for (const l of labels) { const b = boxes.get(l.text); if (b) l.box = b; }
    }
    await options.save(key, picture.display);
    // The picture is always stored where the board's link points — a redraw shown as drawn was never
    // saved, and the board showed a broken picture (course benchmark, 2026-10-24). Only a picture that
    // passed its own check AND the board's vision check gets the record that lets the next student reuse it.
    if (options.share) await saveSharedCanvasImage(key, picture.display);
    const record: Record_ = { key, kind: "course-picture", fields, labels, description, model: COURSE_IMAGE_MODEL, createdAt: new Date().toISOString() };
    const remember = options.share && !final ? async () => { await saveSharedDiagramRecord(key, record).catch(() => undefined); } : undefined;
    const how = attempt === 1 ? (final ? "shown as drawn (no time for a check)" : "drawn and checked") : `redrawn once for: ${corrections.join("; ").slice(0, 200)} — shown as drawn`;
    return { key, display: picture.display, paper: picture.paper, fields, labels, description, cached: false, redrawn: attempt === 2, remember, costUsd, log: `${COURSE_IMAGE_MODEL} ${QUALITY}: ${how}; ${labels.length}/${fields.labels.length} labels located${fields.exactText.length ? `, ${fields.exactText.length} exact text` : ""}` };
  }
  throw new CoursePictureError("no picture was drawn", costUsd);
}
