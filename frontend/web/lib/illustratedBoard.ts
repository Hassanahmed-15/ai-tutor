import { randomBytes } from "node:crypto";
import OpenAI from "openai";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { Beat } from "./lessonContent";
import type { ReactAnimationOp } from "./drawSanitize";
import { costFor, priceFor } from "./modelPricing";
import { recordAnimationTrial } from "./animationTrials";
import type { AnimationTiming } from "./reactAnimationGen";
import { INK_COLS, INK_ROWS, composeIllustratedBoard, type BoardNote, type LocatedPart } from "./anim/illustratedLayout";
import { chooseFocus, lectureState, rememberPictures, withPlanLock, type BoardPictureMemory, type LecturePicture } from "./lecturePictures";

/**
 * ILLUSTRATED BOARDS, the server half: plan → picture → store → locate → compose.
 * Why, and the layout, in lib/anim/illustratedLayout.ts.
 *
 * Every step can decline or fail, and then the beat is drawn by the ordinary Motion board generator
 * exactly as before (fillReactAnimationOps calls this first and falls back) — an illustration is an
 * upgrade, never a new way for a beat to end up without a board. Measured on 2026-09-29: the
 * picture ~20 s and ~$0.06 (gpt-image-1, medium), locating ~5-18 s over a grid, planning ~3 s.
 *
 * Locating moved from terra to luna on 2026-09-29 (the owner's cost call: "luna, not terra"). On the
 * saved heart/chloroplast/volcano pictures luna's points were as good as terra's (each had one point
 * on an edge), and `snapToInk` now moves any point that lands on bare paper onto the nearest ink,
 * so a label or ring can never end in background whichever model points.
 */

const PLAN_MODEL = process.env.ILLUSTRATION_PLAN_MODEL ?? "gpt-5.6-luna";
const LOCATE_MODEL = process.env.ILLUSTRATION_LOCATE_MODEL ?? "gpt-5.6-luna";
const IMAGE_MODEL = process.env.ILLUSTRATION_IMAGE_MODEL ?? "gpt-image-1";
const STORE_W = 1200;
const STORE_H = 800;

/**
 * On by default; ILLUSTRATED_BOARDS=0 turns it off. It also needs blob storage to keep the picture.
 * (Storage is read from the environment here and lib/blobStorage is imported lazily: that module is
 * server-only, and this one is loaded by the board generator's tests.)
 */
function storageConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.AZURE_STORAGE_CONNECTION_STRING && env.AZURE_STORAGE_CONTAINER);
}
export function illustratedBoardsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.ILLUSTRATED_BOARDS !== "0" && storageConfigured(env);
}

export function illustrationBlobName(id: string): string {
  return `board-illustrations/${id}.jpg`;
}

type Plan = {
  suitable: boolean;
  subject: string;
  /** Parts clearly visible in the picture, to locate: what later boards may label, point at or zoom onto. */
  parts: Array<{ name: string; sentence: number }>;
  notes: BoardNote[];
  labels: string[];
};

/**
 * THE BOARD'S WRITING, shared by both planners. The owner's brief (2026-09-29): the board had "just
 * labelled everything and doesn't really write something on the board"; "labelling should be
 * important where it is"; "u have to write text on images as well".
 */
const WRITING_RULES = `- "notes": 2 to 4 KEY NOTES a teacher writes on the board while saying this slide — the facts to remember, in teaching order, each tied to the 0-based sentence that says it ({"text": string, "sentence": number}). At most 5 words and 28 characters each; a phrase, not a sentence; no full stop; symbols are welcome ("light → chemical energy", "CO₂ in, O₂ out", "site of the Calvin cycle"). Never just a part's name, never the title again, never a note an earlier board wrote.
- "labels": part names to write ON the picture, beside the part — ONLY when identifying parts is the point of this slide (its narration walks through what the parts are called). 0 labels for a slide about a process, a function, a cause or the context: the picture carries it and the teacher points. At most 3; each must be one of "parts", in the same words.`;

export const ILLUSTRATION_PLAN_SYSTEM_PROMPT = `You plan ONE teaching board built on a textbook illustration. Return JSON only:
{"suitable": boolean, "subject": string, "parts": [{"name": string, "sentence": number}], "notes": [{"text": string, "sentence": number}], "labels": [string]}

- "suitable": PICTURES ARE THE DEFAULT. true for anything a good textbook would ILLUSTRATE: an organ, cell, organelle, organism or plant part; anatomy; a landform, rock layers or a weather system; an apparatus, machine, instrument, device or structure; a planet or space object; a process that happens in or through such things (photosynthesis in a chloroplast, gas exchange in alveoli, digestion, an eruption, a circuit, an engine stroke); a cycle of STAGES or places (the water cycle, the cell cycle, the rock cycle); the place where a pathway happens when the narration is about that place (a mitochondrion for "where the Krebs cycle runs"); a historical or everyday scene; a concrete STRUCTURE in computing or AI that textbooks draw as a picture (a neural network as layers of connected neurons, a biological neuron as its inspiration, a computer's parts, devices joined in a network, a robot, a data centre). false where a generated picture would be wrong or useless: mathematics, statistics, charts and graphs, equations and derivations, code, algorithms and data structures traced step by step, abstract ideas in computing, AI or statistics that have no shape (states, learning rules, gradients, loss, probability), message sequences between systems (network protocols), a chemical or metabolic pathway whose content is the NAMED MOLECULES and their conversions (a step of the Krebs cycle, glycolysis) — an image model writes those names into the picture — business or economics abstractions, and pure definitions with nothing to picture.
- NEVER THE SAME PICTURE TWICE IN ONE LECTURE. You are told the subjects already pictured in this lecture. This slide teaches something new, so its picture must show something new: a different object, a closer part (one granum rather than the whole chloroplast), a different process stage or a different view. If the only possible picture is one already shown, return "suitable": false.
- "subject": ONE precise sentence describing the illustration in its canonical textbook view — never "labelled" or "with labels": the picture carries NO text, the board writes on it: the view (cross-section, cutaway, front view), each part to show and where it sits, conventional colours. Every part in "parts" must be clearly visible and separate in it.
- "parts": 3 to 8 parts clearly visible in the picture that a student could point to — the ones the narration names first, in the narration's own words (1-3 words, lowercase unless a proper name), each with the 0-based sentence that first names it (or -1 if the narration does not name it). Never a process, a quantity or an arrow.
${WRITING_RULES}`;

export const PICTURE_BOARD_PLAN_SYSTEM_PROMPT = `This slide continues a subtopic on a picture the student has ALREADY SEEN on an earlier slide. The board shows the same picture zoomed onto one part, and writes NEW things beside and on it. Plan that board. Return JSON only:
{"focus": string | null, "notes": [{"text": string, "sentence": number}], "labels": [string]}

- "focus": the ONE part of the picture this slide is about — the board zooms onto it. Choose from the picture's parts, preferring one no earlier slide zoomed onto. null only when the slide is truly about the whole picture.
${WRITING_RULES}
- NOTHING WRITTEN TWICE. You are told everything earlier slides already wrote on this picture. Never repeat or rephrase any of it: this slide's notes carry what THIS slide adds, and a part labelled before is not labelled again.`;

function numberedNarration(sentences: string[]): string {
  return sentences.map((s, i) => `[${i}] ${s}`).join("\n");
}

function parseNotes(raw: unknown): BoardNote[] {
  return (Array.isArray(raw) ? raw : [])
    .map((n) => (typeof n === "string" ? { text: n } : n as { text?: unknown; sentence?: unknown }))
    .filter((n): n is { text: string; sentence?: unknown } => Boolean(n) && typeof n.text === "string" && n.text.trim().length > 0)
    .map((n) => ({ text: n.text.trim().replace(/\.$/, "").slice(0, 40), sentence: Number.isFinite(Number(n.sentence)) ? Number(n.sentence) : undefined }))
    .slice(0, 4);
}

function parseLabels(raw: unknown, parts: string[]): string[] {
  const known = new Map(parts.map((p) => [p.toLowerCase(), p]));
  return (Array.isArray(raw) ? raw : [])
    .map((l) => (typeof l === "string" ? l : typeof (l as { name?: unknown })?.name === "string" ? (l as { name: string }).name : ""))
    .map((l) => known.get(l.trim().toLowerCase()))
    .filter((l): l is string => Boolean(l))
    .filter((l, i, all) => all.indexOf(l) === i)
    .slice(0, 3);
}

async function planIllustration(client: OpenAI, beat: Beat, op: ReactAnimationOp, sentences: string[], pictured: string[]): Promise<{ plan: Plan | null; costUsd: number }> {
  const earlier = pictured.length
    ? `Already pictured in this lecture (never picture these again):\n${pictured.map((s) => `- ${s}`).join("\n")}`
    : "Nothing has been pictured in this lecture yet.";
  const res = await client.chat.completions.create({
    model: PLAN_MODEL,
    messages: [
      { role: "system", content: ILLUSTRATION_PLAN_SYSTEM_PROMPT },
      { role: "user", content: `Board: ${beat.title}\nWhat it must show: ${op.teachingPoint}\n${earlier}\nNarration, numbered:\n${numberedNarration(sentences)}` },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 3000,
    reasoning_effort: "low",
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  const costUsd = costFor(PLAN_MODEL, res.usage);
  try {
    const raw = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { suitable?: unknown; subject?: unknown; parts?: unknown; notes?: unknown; labels?: unknown };
    const parts = (Array.isArray(raw.parts) ? raw.parts : [])
      .map((p) => (typeof p === "string" ? { name: p } : p as { name?: unknown; sentence?: unknown }))
      .filter((p): p is { name: string; sentence?: unknown } => Boolean(p) && typeof p.name === "string" && p.name.trim().length > 0)
      .map((p) => ({ name: p.name.trim().slice(0, 32), sentence: Number(p.sentence) }))
      .slice(0, 8);
    const notes = parseNotes(raw.notes);
    const plan: Plan = {
      suitable: raw.suitable === true,
      subject: String(raw.subject ?? "").slice(0, 600),
      parts,
      notes,
      labels: parseLabels(raw.labels, parts.map((p) => p.name)),
    };
    return { plan: plan.suitable && plan.subject && notes.length >= 1 ? plan : null, costUsd };
  } catch {
    return { plan: null, costUsd };
  }
}

async function planBoardOnPicture(client: OpenAI, beat: Beat, sentences: string[], picture: LecturePicture): Promise<{ focus: string | null; notes: BoardNote[]; labels: string[]; costUsd: number }> {
  const res = await client.chat.completions.create({
    model: PLAN_MODEL,
    messages: [
      { role: "system", content: PICTURE_BOARD_PLAN_SYSTEM_PROMPT },
      {
        role: "user",
        content: `The picture: ${picture.subject}\nIts parts: ${picture.parts.map((p) => p.name).join(", ") || "(none located)"}\nAlready zoomed onto: ${picture.focused.join(", ") || "nothing"}\nAlready written on it by earlier slides:\n${picture.written.map((w) => `- ${w}`).join("\n") || "- nothing"}\n\nThis slide: ${beat.title}\nNarration, numbered:\n${numberedNarration(sentences)}`,
      },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 2000,
    reasoning_effort: "low",
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  const costUsd = costFor(PLAN_MODEL, res.usage);
  try {
    const raw = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { focus?: unknown; notes?: unknown; labels?: unknown };
    const written = new Set(picture.written.map((w) => w.toLowerCase()));
    return {
      focus: typeof raw.focus === "string" ? raw.focus : null,
      notes: parseNotes(raw.notes).filter((n) => !written.has(n.text.toLowerCase())),
      labels: parseLabels(raw.labels, picture.parts.map((p) => p.name)).filter((l) => !written.has(l.toLowerCase())),
      costUsd,
    };
  } catch {
    return { focus: null, notes: [], labels: [], costUsd };
  }
}

const STYLE = "Style: a clean, accurate modern textbook illustration — smooth vector-like shapes, soft realistic shading and gentle highlights, bright saturated colours, crisp outlines. The subject is centred and fills about 70% of the frame. Plain very light warm off-white background, no border, no scenery. ABSOLUTELY NO TEXT: no labels, letters, numbers, arrows, leader lines, captions or watermark anywhere.";

/**
 * The picture's pixels only. gpt-image-1 embeds C2PA content credentials in a `caBX` chunk, and
 * @napi-rs/canvas (Skia) cannot decode a PNG that carries it — it falls through to its SVG parser
 * and throws "Invalid SVG image", so every illustration failed until this. Only the chunks needed
 * to draw the image are kept; the stored JPEG is re-encoded from the pixels either way.
 */
export function pngPixelsOnly(png: Buffer): Buffer {
  if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) return png;
  const keep = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
  const chunks: Buffer[] = [png.subarray(0, 8)];
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (keep.has(type)) chunks.push(png.subarray(offset, offset + 12 + length));
    offset += 12 + length;
  }
  return Buffer.concat(chunks);
}

async function drawIllustration(client: OpenAI, subject: string): Promise<{ jpeg: Buffer; display: Buffer; paper: string; costUsd: number }> {
  const res = await client.images.generate({ model: IMAGE_MODEL, prompt: `Scientific illustration of ${subject} ${STYLE}`, size: "1536x1024", quality: "medium" });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("the image model returned no picture");
  const image = await loadImage(pngPixelsOnly(Buffer.from(b64, "base64")));
  const canvas = createCanvas(STORE_W, STORE_H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, STORE_W, STORE_H);
  // The paper colour: the picture's own background, from its top-left corner.
  const corner = ctx.getImageData(4, 4, 12, 12).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < corner.length; i += 4) { r += corner[i]; g += corner[i + 1]; b += corner[i + 2]; }
  const n = corner.length / 4;
  const paper = "#" + [r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("");
  const usage = res.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  const price = priceFor(IMAGE_MODEL);
  const costUsd = usage ? ((usage.input_tokens ?? 0) * price.input + (usage.output_tokens ?? 0) * price.output) / 1_000_000 : 0.06;
  /*
   * Two copies. The 1200x800 one is what the vision calls point at (their pixel grid is stated in
   * those units). The one the student SEES keeps the image model's full 1536x1024 at a high quality:
   * a zoomed board enlarges the picture 1.6x, and the 1200-pixel copy looked soft there (the owner,
   * 2026-09-29: "I like how it zoomed in… it should be more defined").
   */
  const full = createCanvas(image.width, image.height);
  full.getContext("2d").drawImage(image, 0, 0);
  return { jpeg: await canvas.encode("jpeg", 82), display: await full.encode("jpeg", 92), paper, costUsd };
}

/**
 * Where each part is. A faint pixel grid is drawn over the picture first: pointing by reading a grid
 * put every part (thin membranes included) on its own ink, where raw fractions from the same models
 * — and gpt-4o either way — put several in blank background.
 */
export async function locateParts(client: OpenAI, jpeg: Buffer, subject: string, names: string[]): Promise<{ parts: Array<{ name: string; x: number; y: number }>; textInImage: boolean; costUsd: number }> {
  const image = await loadImage(jpeg);
  const canvas = createCanvas(STORE_W, STORE_H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  // The picture's own pixels, before the grid goes on: what a point is snapped onto.
  const pixels = ctx.getImageData(0, 0, STORE_W, STORE_H).data;
  ctx.strokeStyle = "rgba(0,0,255,0.35)";
  ctx.lineWidth = 1;
  for (let x = 60; x < STORE_W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, STORE_H); ctx.stroke(); }
  for (let y = 62; y < STORE_H; y += 62) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(STORE_W, y); ctx.stroke(); }
  const gridded = (await canvas.encode("jpeg", 80)).toString("base64");
  const res = await client.chat.completions.create({
    model: LOCATE_MODEL,
    response_format: { type: "json_object" },
    max_completion_tokens: 4000,
    reasoning_effort: "low",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: `The image is ${STORE_W} x ${STORE_H} pixels with a faint blue grid: vertical lines every 60 px and horizontal lines every 62 px. It shows ${subject}\nFor each part below, give the pixel coordinate of ONE point that lies clearly INSIDE that part — on the part's own ink, never in the empty background. For a thin part (a membrane, a wall, a vessel) put the point exactly on its line. Use the grid to read coordinates precisely. If a part is not visible, omit it. Also report "textInImage": true if the picture itself contains ANY letters, words, numbers or chemical formulas (ignore the blue grid). Return JSON {"parts":[{"name":string,"x":number,"y":number}],"textInImage":boolean} with x, y in pixels.\nParts: ${names.join(", ")}.` },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${gridded}` } },
      ],
    }],
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  const costUsd = costFor(LOCATE_MODEL, res.usage);
  const raw = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { parts?: Array<{ name?: string; x?: number; y?: number }>; textInImage?: boolean };
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const parts = (raw.parts ?? [])
    .filter((p) => typeof p.name === "string" && wanted.has(p.name.toLowerCase()) && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => {
      const snapped = snapToInk(pixels, STORE_W, STORE_H, p.x!, p.y!);
      return { name: names.find((n) => n.toLowerCase() === p.name!.toLowerCase())!, x: snapped.x / STORE_W, y: snapped.y / STORE_H };
    })
    .filter((p) => p.x > 0.02 && p.x < 0.98 && p.y > 0.02 && p.y < 0.98);
  return { parts, textInImage: raw.textInImage === true, costUsd };
}

/**
 * A SECOND LOOK at the located points. Pointing blind, luna put a nested part (a chloroplast's inner
 * membrane) on the right line about two runs in three and on its neighbour otherwise; shown its own
 * points drawn on the picture, it judges and corrects them reliably — seeing a dot in the wrong
 * place is easier than placing one. So every point is drawn, numbered, and checked once.
 */
export async function verifyParts(
  client: OpenAI,
  jpeg: Buffer,
  subject: string,
  parts: Array<{ name: string; x: number; y: number }>,
): Promise<{ parts: Array<{ name: string; x: number; y: number }>; corrected: string[]; costUsd: number }> {
  if (!parts.length) return { parts, corrected: [], costUsd: 0 };
  const image = await loadImage(jpeg);
  const canvas = createCanvas(STORE_W, STORE_H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, STORE_W, STORE_H).data;
  ctx.strokeStyle = "rgba(0,0,255,0.3)";
  ctx.lineWidth = 1;
  for (let x = 60; x < STORE_W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, STORE_H); ctx.stroke(); }
  for (let y = 62; y < STORE_H; y += 62) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(STORE_W, y); ctx.stroke(); }
  ctx.font = "bold 22px sans-serif";
  parts.forEach((p, i) => {
    const x = p.x * STORE_W, y = p.y * STORE_H;
    ctx.fillStyle = "#ff0000"; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#000000"; ctx.fillText(String(i + 1), x + 10, y - 8);
  });
  const marked = (await canvas.encode("jpeg", 82)).toString("base64");
  const res = await client.chat.completions.create({
    model: LOCATE_MODEL,
    response_format: { type: "json_object" },
    max_completion_tokens: 6000,
    reasoning_effort: "low",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: `The image is ${STORE_W} x ${STORE_H} pixels with a faint blue grid (vertical lines every 60 px, horizontal every 62 px). It shows ${subject}
Each numbered red dot is meant to sit ON the named part — on the part's own ink; for a thin part (a membrane, a wall, a vessel), exactly on its line; for nested layers, on the right layer. Check each one. Return JSON {"checks":[{"n":number,"ok":boolean,"x":number,"y":number}]} — when a dot is wrong, x and y are the pixel point where it should be; when it is right, repeat its position.
${parts.map((p, i) => `${i + 1}. ${p.name} (now at ${Math.round(p.x * STORE_W)}, ${Math.round(p.y * STORE_H)})`).join("\n")}` },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${marked}` } },
      ],
    }],
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  const costUsd = costFor(LOCATE_MODEL, res.usage);
  try {
    const raw = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { checks?: Array<{ n?: number; ok?: boolean; x?: number; y?: number }> };
    const corrected: string[] = [];
    const out = parts.map((p, i) => {
      const check = (raw.checks ?? []).find((c) => Number(c.n) === i + 1);
      if (!check || check.ok !== false || !Number.isFinite(check.x) || !Number.isFinite(check.y)) return p;
      const snapped = snapToInk(pixels, STORE_W, STORE_H, check.x!, check.y!);
      corrected.push(p.name);
      return { name: p.name, x: snapped.x / STORE_W, y: snapped.y / STORE_H };
    });
    return { parts: out, corrected, costUsd };
  } catch {
    return { parts, corrected: [], costUsd };
  }
}

/**
 * Where the picture has ink, cell by cell (see INK_COLS/INK_ROWS in illustratedLayout.ts): a digit
 * 0-9 for the share of a cell's pixels that differ clearly from the paper, its corner colour.
 */
export function inkMapOf(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number): string {
  const paper = [0, 1, 2].map((c) => pixels[(6 * width + 6) * 4 + c]);
  let out = "";
  for (let row = 0; row < INK_ROWS; row++) {
    for (let col = 0; col < INK_COLS; col++) {
      const x0 = Math.floor((col * width) / INK_COLS), x1 = Math.floor(((col + 1) * width) / INK_COLS);
      const y0 = Math.floor((row * height) / INK_ROWS), y1 = Math.floor(((row + 1) * height) / INK_ROWS);
      let ink = 0, n = 0;
      for (let y = y0; y < y1; y += 3) {
        for (let x = x0; x < x1; x += 3) {
          const i = (y * width + x) * 4;
          n += 1;
          if (Math.abs(pixels[i] - paper[0]) + Math.abs(pixels[i + 1] - paper[1]) + Math.abs(pixels[i + 2] - paper[2]) > 60) ink += 1;
        }
      }
      out += String(Math.round((n ? ink / n : 0) * 9));
    }
  }
  return out;
}

async function inkMapOfJpeg(jpeg: Buffer): Promise<string | undefined> {
  try {
    const image = await loadImage(jpeg);
    const canvas = createCanvas(STORE_W, STORE_H);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, STORE_W, STORE_H);
    return inkMapOf(ctx.getImageData(0, 0, STORE_W, STORE_H).data, STORE_W, STORE_H);
  } catch {
    return undefined;
  }
}

/**
 * A point on bare paper moves onto the nearest ink. The paper is the picture's background (its
 * corner colour); a pixel is ink when it differs from the paper clearly. Searched in rings out to
 * 70 px, and the point lands a few pixels INSIDE the ink rather than on its very edge, so a dot
 * reads as sitting on the part. A point already on ink, or with no ink near it, is left alone.
 */
export function snapToInk(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number, x: number, y: number): { x: number; y: number } {
  const at = (px: number, py: number) => ((Math.round(py) * width + Math.round(px)) * 4);
  const paper = [0, 1, 2].map((c) => pixels[at(6, 6) + c]);
  const inkAt = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return false;
    const i = at(px, py);
    return Math.abs(pixels[i] - paper[0]) + Math.abs(pixels[i + 1] - paper[1]) + Math.abs(pixels[i + 2] - paper[2]) > 60;
  };
  const cx = Math.max(0, Math.min(width - 1, x));
  const cy = Math.max(0, Math.min(height - 1, y));
  if (inkAt(cx, cy)) return { x: cx, y: cy };
  for (let r = 3; r <= 70; r += 3) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (!inkAt(px, py)) continue;
      const inside = { x: px + Math.cos(a) * 6, y: py + Math.sin(a) * 6 };
      return inkAt(inside.x, inside.y) ? inside : { x: px, y: py };
    }
  }
  return { x: cx, y: cy };
}

/**
 * Every step is bounded. Without this a stalled request (this dev machine's Azure calls hang
 * intermittently) held the beat until the lecture's own limit gave up and dropped it to a written
 * fallback board — a picture must never cost a beat its board. A timeout is a decline: the Motion
 * board is drawn instead.
 */
const STEP_TIMEOUT_MS = { plan: 30_000, draw: 90_000, locate: 60_000, store: 25_000 } as const;
function bounded<T>(work: Promise<T>, step: keyof typeof STEP_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${step} timed out after ${STEP_TIMEOUT_MS[step] / 1000}s`)), STEP_TIMEOUT_MS[step]);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** A description that asks for labels gets text drawn into the picture; our labels go on top. */
export function pictureSubject(subject: string): string {
  return subject
    .replace(/\b(?:fully\s+)?(?:labell?ed|annotated|captioned)\s+/gi, "")
    .replace(/\bwith\s+(?:labels?|annotations?|captions?|text)\b[^,.;]*/gi, "")
    .replace(/\blabels?\b/gi, "parts")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .trim();
}

function narrationSentences(script: string): string[] {
  return script.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

/** The lecture this board belongs to, for its picture memory (lib/lecturePictures.ts). */
export type LectureMemoryOption = {
  /** One key per lecture: the progressive session id, or one per fillReactAnimationOps call. */
  key: string;
  /** Pictures the lecture's saved boards were built on (picturesFromBoardCodes). */
  earlier?: LecturePicture[];
};

type BoardOutcome = { costUsd: number; filled: true; issue?: string; timing: AnimationTiming };

/**
 * Try to draw this beat as a picture board. Returns null when it declines (not a picturable
 * subject, a source-grounded beat, storage off) or fails — the caller then generates a Motion board.
 *
 * A later pass of a subtopic that already has a picture BUILDS ON IT (same picture, zoomed onto a
 * new part, new writing) instead of drawing again; a new subtopic draws a new picture, planned
 * knowing every subject the lecture has already pictured. See lib/lecturePictures.ts.
 */
export async function generateIllustratedBoard(
  client: OpenAI,
  op: ReactAnimationOp,
  beat: Beat,
  opts: { abstract: boolean; hasSource: boolean; lecture?: LectureMemoryOption },
): Promise<BoardOutcome | null> {
  // The abstract/physical classifier is NOT a gate here: it called the Krebs cycle abstract, and a
  // whole lecture on it got no picture. The planner decides what can be pictured; only a
  // source-grounded beat is left to the Motion board, which must stay inside its source.
  if (!illustratedBoardsEnabled() || opts.hasSource) return null;
  const startedAt = Date.now();
  const sentences = narrationSentences(beat.script);
  const conceptId = beat.conceptId ?? beat.id;
  const lecture = lectureState(opts.lecture?.key ?? `beat:${beat.id}`);
  if (opts.lecture?.earlier?.length) rememberPictures(lecture, opts.lecture.earlier);

  const known = lecture.pictures.find((p) => p.conceptId === conceptId);
  const pending = known ? undefined : lecture.byConcept.get(conceptId);
  if (known || pending) {
    const picture = known ?? await pending!;
    // The subtopic's first pass declined a picture: this pass is not a picture either.
    if (!picture) return null;
    return buildOnPicture(client, op, beat, sentences, lecture, picture, startedAt);
  }

  let settle: (picture: LecturePicture | null) => void = () => {};
  lecture.byConcept.set(conceptId, new Promise((resolve) => (settle = resolve)));
  let costUsd = 0;
  let plannedSubject: string | null = null;
  try {
    // Plans are made one at a time per lecture, so each sees every subject planned before it.
    const planned = await withPlanLock(lecture, async () => {
      const pictured = [...lecture.pictures.map((p) => p.subject), ...lecture.planned];
      const result = await bounded(planIllustration(client, beat, op, sentences, pictured), "plan");
      if (result.plan) lecture.planned.push((plannedSubject = result.plan.subject));
      return result;
    });
    costUsd += planned.costUsd;
    if (!planned.plan) {
      console.error(`[illustrated] beat=${beat.id} declined: nothing new to picture`);
      settle(null);
      return null;
    }
    const plan = planned.plan;
    const t1 = Date.now();
    const names = plan.parts.map((p) => p.name);
    /*
     * The image model sometimes writes text into the picture despite being told not to ("CO2",
     * "H2O" beside molecules) — words that then sit beside our own writing. The locating call also
     * reports text, and a picture with text is drawn once more.
     */
    const subject = pictureSubject(plan.subject);
    let picture = await bounded(drawIllustration(client, subject), "draw");
    costUsd += picture.costUsd;
    let located = await bounded(locateParts(client, picture.jpeg, subject, names), "locate");
    costUsd += located.costUsd;
    if (located.textInImage) {
      console.error(`[illustrated] beat=${beat.id} the picture contains text; drawing it again`);
      picture = await bounded(drawIllustration(client, subject), "draw");
      costUsd += picture.costUsd;
      located = await bounded(locateParts(client, picture.jpeg, subject, names), "locate");
      costUsd += located.costUsd;
      // A stray word in a picture beats no picture: the second drawing ships either way.
    }
    const checked = await bounded(verifyParts(client, picture.jpeg, subject, located.parts), "locate").catch(() => null);
    if (checked) {
      costUsd += checked.costUsd;
      located = { ...located, parts: checked.parts };
      if (checked.corrected.length) console.error(`[illustrated] beat=${beat.id} second look moved: ${checked.corrected.join(", ")}`);
    }
    const t2 = Date.now();
    const id = randomBytes(16).toString("hex");
    await bounded(import("./blobStorage").then(({ uploadRawBlob }) => uploadRawBlob(illustrationBlobName(id), picture.display, "image/jpeg")), "store");
    const ink = await inkMapOfJpeg(picture.jpeg);
    const record: LecturePicture = {
      id,
      subject: plan.subject,
      paper: picture.paper,
      conceptId,
      title: beat.title,
      parts: located.parts.map((p) => ({ name: p.name, x: round3(p.x), y: round3(p.y) })),
      written: [...plan.notes.map((n) => n.text), ...plan.labels],
      focused: [],
      ...(ink ? { ink } : {}),
    };
    lecture.pictures.push(record);
    settle(record);
    const parts: LocatedPart[] = record.parts.map((p) => {
      const hint = plan.parts.find((q) => q.name === p.name)?.sentence;
      return { ...p, sentence: typeof hint === "number" && hint >= 0 ? hint : undefined };
    });
    return finishBoard(op, beat, {
      code: composeIllustratedBoard({ title: beat.title, sentences, parts, notes: plan.notes, labels: plan.labels, paper: picture.paper, illustrationId: id, ink, memory: memoryOf(record, plan.notes, plan.labels, null) }),
      costUsd,
      startedAt,
      modelMs: t2 - t1,
      trail: "illustrated",
      note: `parts=${record.parts.map((p) => p.name).join("|")} labels=${plan.labels.join("|") || "none"}`,
    });
  } catch (err) {
    // A failed picture frees the subtopic: a later pass may try its own.
    settle(null);
    lecture.byConcept.delete(conceptId);
    console.error(`[illustrated] beat=${beat.id} failed, falling back to a Motion board: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    if (plannedSubject) lecture.planned = lecture.planned.filter((s) => s !== plannedSubject);
  }
}

/** A later pass of a subtopic: the subtopic's picture, zoomed onto a new part, with new writing. */
async function buildOnPicture(
  client: OpenAI,
  op: ReactAnimationOp,
  beat: Beat,
  sentences: string[],
  lecture: ReturnType<typeof lectureState>,
  picture: LecturePicture,
  startedAt: number,
): Promise<BoardOutcome | null> {
  try {
    const planned = await withPlanLock(lecture, async () => {
      const result = await bounded(planBoardOnPicture(client, beat, sentences, picture), "plan");
      const focus = chooseFocus(picture, result.focus, sentences);
      // Recorded inside the lock, so the next pass on this picture sees what this one wrote.
      for (const w of [...result.notes.map((n) => n.text), ...result.labels]) if (!picture.written.includes(w)) picture.written.push(w);
      if (focus && !picture.focused.includes(focus)) picture.focused.push(focus);
      return { ...result, focus };
    });
    if (!planned.notes.length) {
      console.error(`[illustrated] beat=${beat.id} declined: nothing new to write on "${picture.subject.slice(0, 60)}"`);
      return null;
    }
    const parts: LocatedPart[] = picture.parts.map((p) => ({ ...p }));
    return finishBoard(op, beat, {
      code: composeIllustratedBoard({
        title: beat.title,
        sentences,
        parts,
        notes: planned.notes,
        labels: planned.labels,
        focus: planned.focus,
        paper: picture.paper,
        illustrationId: picture.id,
        ink: picture.ink,
        memory: memoryOf(picture, planned.notes, planned.labels, planned.focus),
      }),
      costUsd: planned.costUsd,
      startedAt,
      modelMs: Date.now() - startedAt,
      trail: "illustrated-reuse",
      note: `builds on ${picture.id.slice(0, 8)} focus=${planned.focus ?? "whole"} labels=${planned.labels.join("|") || "none"}`,
    });
  } catch (err) {
    console.error(`[illustrated] beat=${beat.id} could not build on its picture, falling back to a Motion board: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function memoryOf(picture: LecturePicture, notes: BoardNote[], labels: string[], focus: string | null): BoardPictureMemory {
  return {
    v: 1,
    id: picture.id,
    subject: picture.subject,
    paper: picture.paper,
    conceptId: picture.conceptId,
    title: picture.title,
    parts: picture.parts,
    notes: notes.map((n) => n.text),
    labels,
    focus,
    ...(picture.ink ? { ink: picture.ink } : {}),
  };
}

async function finishBoard(
  op: ReactAnimationOp,
  beat: Beat,
  board: { code: string; costUsd: number; startedAt: number; modelMs: number; trail: string; note: string },
): Promise<BoardOutcome> {
  op.code = board.code;
  op.assetIds = [];
  op.status = "ready";
  op.model = IMAGE_MODEL;
  const ms = Date.now() - board.startedAt;
  op.trial = { score: null, attempts: 1, refineTrail: board.trail, costUsd: Number(board.costUsd.toFixed(5)), ms };
  const timing: AnimationTiming = {
    totalMs: ms,
    modelMs: board.modelMs,
    checkMs: 0,
    criticMs: Math.max(0, ms - board.modelMs),
    refineMs: 0,
    assetsMs: 0,
    attempts: [],
    outcome: "shipped",
  };
  console.error(`[illustrated] beat=${beat.id} ${board.note} ms=${ms} cost=$${board.costUsd.toFixed(3)}`);
  await recordAnimationTrial({
    model: IMAGE_MODEL,
    beatId: beat.id,
    title: beat.title,
    outcome: "shipped",
    providerError: null,
    score: null,
    attempts: 1,
    costUsd: op.trial.costUsd,
    ms,
    abstract: false,
    strict: false,
    layout: "clean",
    grounded: null,
    refineTrail: board.trail,
  });
  return { costUsd: board.costUsd, filled: true, timing };
}

/** The stored picture's bytes, for /api/board-illustrations/[id]. */
export async function illustrationBytes(id: string): Promise<Buffer | null> {
  if (!/^[a-f0-9]{32}$/.test(id) || !storageConfigured()) return null;
  try {
    const { lectureBlobContainer } = await import("./blobStorage");
    const container = await lectureBlobContainer();
    return await container.getBlobClient(illustrationBlobName(id)).downloadToBuffer();
  } catch {
    return null;
  }
}
