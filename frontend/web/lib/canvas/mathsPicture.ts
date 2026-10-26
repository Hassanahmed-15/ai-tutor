import "server-only";

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import type OpenAI from "openai";
import { costFor, priceFor } from "../modelPricing";
import { locateParts, pngPixelsOnly, prepareStoredIllustration } from "../illustratedBoard";
import { loadSharedCanvasImage, loadSharedDiagramRecord, saveSharedCanvasImage, saveSharedDiagramRecord } from "./store";
import { labelsInRecognisedText, mustFix, type Inspection, type PictureFields } from "./coursePicturePrompt";
import { mathsFieldsPrompt, mathsPictureKey, mathsPicturePrompt, parseMathsFields, type MathsBoardContext } from "./mathsPicturePrompt";
import type { CanvasBoardSpec } from "./types";

/**
 * A MATHS BOARD'S PICTURE, DRAWN BY gpt-image-2 IN THE BOARD'S OWN LOOK — white on black (owner,
 * 2026-10-25; the prompt and the rules for when it is used are lib/canvas/mathsPicturePrompt.ts). Only a
 * typed-prompt or PDF maths lecture's board whose drawing no code figure fits; course lessons keep
 * lib/canvas/coursePicture.ts.
 *
 * Planned by the light model from the whole board, drawn once, its labels read back by Tesseract (free)
 * and the figure checked by an examiner (the light model, owner 2026-10-25); a must-fix fault redraws it
 * ONCE and the redraw is shown as drawn, as a course picture is. Where each label points is found on the
 * picture turned black-on-white, which is what the part locator reads.
 */
const PLAN_MODEL = process.env.MATHS_PICTURE_PLAN_MODEL ?? "gpt-5.6-luna";
const CHECK_MODEL = process.env.MATHS_PICTURE_CHECK_MODEL ?? "gpt-5.6-luna";
export const MATHS_IMAGE_MODEL = process.env.MATHS_PICTURE_MODEL ?? "gpt-image-2";
const QUALITY = (process.env.MATHS_PICTURE_QUALITY ?? "medium") as "low" | "medium" | "high";

/** On unless CANVAS_MATHS_PICTURES=off (or every generated picture is off). */
export function mathsPicturesOn(): boolean {
  return process.env.CANVAS_MATHS_PICTURES !== "off" && process.env.CANVAS_AI_PICTURES !== "off";
}

export type MathsPicture = {
  key: string;
  display: Buffer;
  fields: PictureFields;
  /** Each drawn label: its text, the part it names, the sentence that names it, and where the part is. */
  labels: Array<{ text: string; part: string; sentence: number; x: number; y: number }>;
  description: string;
  cached: boolean;
  costUsd: number;
  log: string;
};

export class MathsPictureError extends Error {
  constructor(message: string, readonly costUsd: number) {
    super(message);
  }
}

type Record_ = { key: string; kind: "maths-picture"; fields: PictureFields; labels: MathsPicture["labels"]; description: string; model: string; createdAt: string };

const INSPECT_PROMPT = "You are a maths examiner checking ONE labelled maths diagram (white on black) for a lesson board before a student sees it. Judge only what is visible, and only what would mislead a student — not style. Return JSON {\"facts\": [{\"fact\": string, \"true\": boolean, \"why\": string}], \"pointers\": [{\"label\": string, \"result\": \"right part\" | \"edge of right part\" | \"different part\" | \"no line\", \"why\": string}], \"errors\": [{\"kind\": \"invented\" | \"missing\" | \"sensitive\" | \"minor\", \"what\": string}], \"description\": string}. facts: each listed fact, and whether every listed value, letter, angle and coordinate is written exactly and drawn where it belongs (a curve through its points, a right angle where stated, a count right). pointers: for each label, whether it sits beside (or its line ends on) the part it names. errors: \"invented\" — a part, value or any writing that is not listed; \"missing\" — a part the board needs that is not drawn; \"minor\" — anything else. description: 2 to 4 plain sentences saying what the figure shows and where each labelled part is (left, right, top, centre…), for a teacher who cannot see it.";

async function json(openai: OpenAI, model: string, system: string, content: OpenAI.Chat.ChatCompletionContentPart[] | string): Promise<{ json: any; costUsd: number }> {
  const res = await openai.chat.completions.create({ model, response_format: { type: "json_object" }, max_completion_tokens: 6000, reasoning_effort: "low", messages: [{ role: "system", content: system }, { role: "user", content }] } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  return { json: JSON.parse(res.choices[0]?.message?.content ?? "{}"), costUsd: costFor(model, res.usage) };
}

/** The picture's black made the board's black exactly (no grey box round the figure), as a PNG. */
async function onBoardBlack(bytes: Buffer): Promise<Buffer> {
  // gpt-image PNGs carry a C2PA chunk @napi-rs/canvas cannot decode ("Invalid SVG image"): pixels only.
  const img = await loadImage(pngPixelsOnly(bytes));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (Math.max(px[i], px[i + 1], px[i + 2]) < 48) px[i] = px[i + 1] = px[i + 2] = 0;
  }
  ctx.putImageData(data, 0, 0);
  return canvas.encode("png");
}

/** The picture turned black-on-white: what Tesseract and the part locator read. */
async function inverted(bytes: Buffer, as: "png" | "jpeg"): Promise<Buffer> {
  const img = await loadImage(bytes);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = 255 - px[i];
    px[i + 1] = 255 - px[i + 1];
    px[i + 2] = 255 - px[i + 2];
  }
  ctx.putImageData(data, 0, 0);
  return as === "png" ? canvas.encode("png") : canvas.encode("jpeg", 90);
}

/** Every piece of text in the picture, read by Tesseract (free); null when Tesseract is missing. */
async function tesseract(png: Buffer): Promise<string | null> {
  const dir = await mkdtemp(path.join(tmpdir(), "aria-maths-ocr-"));
  try {
    const file = path.join(dir, "picture.png");
    await writeFile(file, png);
    return await new Promise<string | null>((resolve) => execFile("tesseract", [file, "stdout", "--psm", "11"], { timeout: 20_000 }, (error, stdout) => resolve(error ? null : String(stdout))));
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Plan, draw, check, locate — or a reason it could not be done (thrown, with what was spent). */
export async function mathsPicture(openai: OpenAI, ctx: MathsBoardContext, options: Parameters<typeof drawMathsPicture>[2]): Promise<MathsPicture> {
  const spent = { usd: 0 };
  try {
    return await drawMathsPicture(openai, ctx, options, spent);
  } catch (error) {
    // A picture paid for and then lost (an image that would not open) still counts what it cost.
    throw error instanceof MathsPictureError ? error : new MathsPictureError((error as Error).message, spent.usd);
  }
}

async function drawMathsPicture(openai: OpenAI, ctx: MathsBoardContext, options: { share: boolean; budget: { left: () => number }; save: (key: string, display: Buffer) => Promise<void>; /** The second drawing of a rejected code figure: shown as drawn, never refused (owner, 2026-10-26). */ asDrawn?: boolean }, spent: { usd: number } = { usd: 0 }): Promise<MathsPicture> {
  let costUsd = 0;
  const planned = mathsFieldsPrompt(ctx);
  const plan = await json(openai, PLAN_MODEL, planned.system, planned.user);
  costUsd += plan.costUsd;
  spent.usd = costUsd;
  const fields = parseMathsFields(plan.json, ctx);
  if (!fields) throw new MathsPictureError("the figure could not be planned from the board", costUsd);
  const expectedText = fields.labels.map((l) => l.text);
  const targets = fields.labels.length ? fields.labels : fields.parts.map((p, i) => ({ text: p.name, pointsTo: p.name, position: "", sentence: Math.min(i, Math.max(0, ctx.sentences.length - 1)) }));
  const key = mathsPictureKey(fields);

  if (options.share) {
    const [record, image] = await Promise.all([loadSharedDiagramRecord<Record_>(key), loadSharedCanvasImage(key)]);
    if (record?.kind === "maths-picture" && image) {
      const stored = await prepareStoredIllustration(image);
      await options.save(key, stored.display);
      return { key, display: stored.display, fields: record.fields, labels: record.labels, description: record.description, cached: true, costUsd, log: "checked maths picture reused" };
    }
  }

  let corrections: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const img = await openai.images.generate({ model: MATHS_IMAGE_MODEL, prompt: JSON.stringify(mathsPicturePrompt(ctx, fields, corrections), null, 2), size: "1536x1024", quality: QUALITY } as never) as OpenAI.Images.ImagesResponse;
    const usage = img.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    const price = priceFor(MATHS_IMAGE_MODEL);
    costUsd += ((usage?.input_tokens ?? 0) * price.input + (usage?.output_tokens ?? 0) * price.output) / 1_000_000;
    spent.usd = costUsd;
    const b64 = img.data?.[0]?.b64_json;
    if (!b64) throw new MathsPictureError("the image model returned no picture", costUsd);
    const picture = await prepareStoredIllustration(await onBoardBlack(Buffer.from(b64, "base64")));
    const url = { type: "image_url" as const, image_url: { url: `data:image/jpeg;base64,${picture.jpeg.toString("base64")}` } };
    // The redraw, or a first picture with no time left for one, is shown as it is.
    const final = options.asDrawn === true || attempt === 2 || options.budget.left() < 110_000;
    const facts = `The figure should be: ${fields.diagramType} (${fields.scope}), ${fields.view}\nFacts that must be true:\n${fields.mustBeTrue.map((x) => `- ${x}`).join("\n")}\nLabels and the part each names:\n${fields.labels.map((l) => `- "${l.text}" → ${l.pointsTo}`).join("\n")}${fields.exactText.length ? `\nOther text that must appear exactly as written: ${fields.exactText.map((t) => `"${t}"`).join(", ")}` : ""}${fields.arrows ? `\nArrows: ${fields.arrows}` : ""}`;
    const [ocr, inspect, located] = await Promise.all([
      final ? Promise.resolve(null) : inverted(picture.display, "png").then(tesseract),
      json(openai, CHECK_MODEL, INSPECT_PROMPT, [{ type: "text", text: `Board: ${ctx.board}\nWhat the teacher says: ${ctx.sentences.join(" ")}\n${facts}` }, url]),
      inverted(picture.jpeg, "jpeg").then((dark) => locateParts(openai, dark, `${fields.diagramType}, ${fields.view}`, targets.map((l) => l.pointsTo))),
    ]);
    costUsd += inspect.costUsd + located.costUsd;
    spent.usd = costUsd;
    const byPart = new Map(located.parts.map((p) => [p.name.toLowerCase(), p]));
    const labels = targets.map((l) => ({ l, at: byPart.get(l.pointsTo.toLowerCase()) })).filter((x) => x.at).map(({ l, at }) => ({ text: l.text, part: l.pointsTo, sentence: l.sentence, x: Math.round(at!.x * 1000) / 1000, y: Math.round(at!.y * 1000) / 1000 }));
    const description = String(inspect.json.description ?? "").replace(/\s+/g, " ").trim().slice(0, 900);
    // No Tesseract: the spelling is left to the examiner's look rather than a second paid read.
    const spelling = ocr !== null ? labelsInRecognisedText(expectedText, ocr) : { ok: true, missing: [], extra: [] };
    const problems = final ? [] : mustFix(spelling, inspect.json as Inspection);
    if (problems.length) {
      corrections = problems.slice(0, 8);
      continue;
    }
    await options.save(key, picture.display);
    if (options.share) {
      await saveSharedCanvasImage(key, picture.display);
      // Only a figure that passed its own check is reused for the next student.
      if (!final) await saveSharedDiagramRecord(key, { key, kind: "maths-picture", fields, labels, description, model: MATHS_IMAGE_MODEL, createdAt: new Date().toISOString() } satisfies Record_).catch(() => undefined);
    }
    const how = attempt === 1 ? (final ? "shown as drawn (no time for a check)" : "drawn and checked") : `redrawn once for: ${corrections.join("; ").slice(0, 200)} — shown as drawn`;
    return { key, display: picture.display, fields, labels, description, cached: false, costUsd, log: `${MATHS_IMAGE_MODEL} ${QUALITY}: ${how}; ${labels.length}/${targets.length} labels located` };
  }
  throw new MathsPictureError("no picture was drawn", costUsd);
}

/** The board with its maths picture: labels are in the picture; the picture sits on the board, white on black. */
export function withMathsPicture(spec: CanvasBoardSpec, pic: Pick<MathsPicture, "labels" | "fields" | "description">, src: string): CanvasBoardSpec {
  if (spec.stage.kind !== "illustration") return spec;
  const stage = spec.stage;
  const used = new Set<string>();
  const parts = pic.labels.map((l, i) => {
    const mine = stage.parts.find((p) => !used.has(p.id) && (p.name.toLowerCase() === l.part.toLowerCase() || p.name.toLowerCase() === l.text.toLowerCase()));
    const id = mine ? mine.id : `label-${i + 1}`;
    used.add(id);
    return { id, name: l.text, s: l.sentence, x: l.x, y: l.y };
  });
  const kept = new Set(parts.map((p) => p.id));
  return {
    ...spec,
    stage: { ...stage, subject: pic.fields.diagramType || stage.subject, parts, src, paper: "#000000", description: pic.description, labels: [], labelsInPicture: pic.fields.labels.map((l) => l.text), onBoard: true },
    // Pointing stays on parts the picture has; nothing else is drawn over it.
    cues: spec.cues.filter((c) => !c.target || !stage.parts.some((p) => p.id === c.target) || kept.has(c.target)),
  };
}
