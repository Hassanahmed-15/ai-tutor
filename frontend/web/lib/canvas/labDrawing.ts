import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import type OpenAI from "openai";
import { z } from "zod/v4";
import { costFor } from "../modelPricing";
import { expandSpec } from "../mathsEngine/expand.js";
import { lintSpec } from "../mathsEngine/lint.js";
import { withSentences } from "../mathsEngine/aria-spec.js";
import { coveredLabels, overlappingFills } from "../mathsEngine/overlap.js";
import { getTemplate } from "../visual3d/registry";
import { RecordingBoard } from "../visual3d/board3d/recording";
import type { MathsBoardContext } from "./mathsPicturePrompt";
import type { CanvasBoardSpec, CanvasPlanBeat, IllustrationStage, LabDrawing } from "./types";

/**
 * A BOARD'S DRAWING FROM THE LAB ENGINES (lib/canvas/labVisuals.ts; on only with CANVAS_LAB_VISUALS=on).
 *
 * - Pencil: the light model writes a maths scene in the engine's JSON format (lib/mathsEngine/SPEC.md),
 *   one step per sentence that draws something, from the whole board — the same context gpt-image-2 gets.
 *   The engine's own checker reads it; its errors go back for ONE repair; a scene that still fails is not
 *   used and the board keeps the drawing it would have had.
 * - 3-D: the planner chose the template (CanvasPlanBeat.view3d); the light model fills its data from the
 *   board's numbers, Zod checks it, and the template is run once here so a template that refuses the data
 *   ("not a valid matrix") is never shipped.
 * The model writes data only: nothing it writes is run as code.
 */
const MODEL = process.env.CANVAS_LAB_MODEL ?? "gpt-5.6-luna";
const ENGINE = path.join(process.cwd(), "lib", "mathsEngine");
let specDoc: string | null = null;
const read = (file: string) => readFileSync(path.join(ENGINE, file), "utf8");

async function json(openai: OpenAI, system: string, user: string): Promise<{ json: unknown; costUsd: number }> {
  const res = await openai.chat.completions.create({ model: MODEL, response_format: { type: "json_object" }, max_completion_tokens: 9000, reasoning_effort: "low", messages: [{ role: "system", content: system }, { role: "user", content: user }] } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(res.choices[0]?.message?.content ?? "null");
  } catch {
    parsed = null;
  }
  return { json: parsed, costUsd: costFor(MODEL, res.usage) };
}

function boardText(ctx: MathsBoardContext, spec: CanvasBoardSpec, pitch?: string): string {
  const working = spec.stage.kind === "equation"
    ? spec.stage.steps.map((st, i) => `Working line ${i + 1}: ${st.order.map((id) => (spec.stage.kind === "equation" ? spec.stage.tokens.find((t) => t.id === id)?.text ?? "" : "")).join(" ")}`)
    : [];
  return [
    `Lecture: ${ctx.topic} — this is ${ctx.lecture.position}`,
    `The whole lecture:\n${ctx.lecture.outline.join("\n")}`,
    ctx.lecture.earlier.length ? `What the boards before this one wrote and drew (keep the same letters, numbers and example):\n${ctx.lecture.earlier.join("\n")}` : "",
    `Board: ${ctx.board}`,
    `What it teaches: ${ctx.brief}`,
    `What Aria says, sentence by sentence (0-based):\n${ctx.sentences.map((s, i) => `${i}. ${s}`).join("\n")}`,
    ctx.written.length || working.length ? `Written on the board beside the drawing (Aria writes this herself; never repeat it in the drawing):\n${[...ctx.written, ...working].join("\n")}` : "",
    spec.stage.kind === "equation" && spec.stage.tokens.length ? `The working's terms (id: term), for "links":\n${spec.stage.tokens.filter((t) => !/^\s*[=+−×÷,()-]\s*$/.test(t.text)).slice(0, 60).map((t) => `${t.id}: ${t.text}`).join("\n")}` : "",
    ctx.mustShow.length ? `It must show: ${ctx.mustShow.join("; ")}` : "",
    ctx.source.length ? `What the student's document says for this board:\n${ctx.source.join("\n")}` : "",
    ctx.strict ? "STRICT SOURCE: the student's document is the only source. Draw ONLY what the document and this board say — every shape, value and label from them, nothing added from general knowledge." : "",
    pitch ? `How this board is pitched for the student (presentation only — never change what is drawn): ${pitch}` : "",
  ].filter(Boolean).join("\n\n");
}

// ── Pencil ──────────────────────────────────────────────────────────────────────────────────────
function pencilSystem(): string {
  specDoc ??= read("SPEC.md");
  const examples = ["trig.json", "cuboid.json"].map((f) => read(path.join("examples", f)));
  return [
    "You write the ONE maths drawing for a lesson board as a scene in the JSON format below. A pencil draws it step by step while Aria speaks; every value is computed by the engine from your expressions, and every label is placed by the engine.",
    "ARIA'S BOARD, NOT THE LAB PAGE: Aria writes the notes and the working herself beside the drawing, so a step has NO \"say\" and NO \"write\". Instead every step has \"s\": the 0-based sentence it is drawn on, in order; several steps may share a sentence; a sentence that names nothing new has no step.",
    "Draw EXACTLY what this board's sentences say, with the board's own letters, numbers and units: the fewest objects that teach it, nothing decorative, no answer the board does not give yet. A length written as \"8 cm\" must be 8 units long on the board (or set \"notToScale\": true on the board). Fit the board's x and y ranges around the drawing with a small margin; the drawing area is about as wide as it is tall.",
    "Labels: a length or a side's letter labels its SEGMENT (a polygon's own label sits in its middle, so use it only for an area or a name such as \"c²\"). Pieces that fit together (triangles round a square, parts of a composite shape) share their corner points exactly and never overlap.",
    "LINKS: when the board's working has terms (listed with their ids), add a top-level \"links\" list joining each term that IS a part of the drawing to the objects it comes from: {\"token\": term id, \"objects\": [object or group ids], \"name\": the part's name in 1 to 3 words, e.g. \"4 triangles\", \"tilted square\", \"side a\"}. Only real links (a length to its side, an area to its shape); signs and plain numbers have none.",
    "Return the scene JSON only.",
    "",
    "# The format",
    specDoc,
    "",
    "# Two scenes in Aria's form",
    ...examples,
  ].join("\n");
}

/** Problems that stop a scene being used: the engine's checker, and Aria's own step rules. */
export function pencilProblems(scene: unknown, sentences: number): string[] {
  if (!scene || typeof scene !== "object") return ["the reply is not a JSON object"];
  const sc = scene as { steps?: Array<Record<string, unknown>> };
  const problems: string[] = [];
  if (!Array.isArray(sc.steps) || !sc.steps.length) problems.push("steps: give at least one step");
  let last = -1;
  for (const [i, st] of (sc.steps ?? []).entries()) {
    if (!Number.isInteger(st.s) || (st.s as number) < 0 || (st.s as number) >= sentences) problems.push(`steps[${i}].s must be a sentence number from 0 to ${sentences - 1}`);
    else if ((st.s as number) < last) problems.push(`steps[${i}].s goes back to sentence ${st.s} after ${last}: keep steps in sentence order`);
    else last = st.s as number;
    if ("say" in st || "write" in st) problems.push(`steps[${i}]: no "say" or "write" on Aria's board (she says and writes it herself)`);
  }
  try {
    const expanded = expandSpec(withSentences(scene));
    const verdict = lintSpec(expanded);
    problems.push(...verdict.errors);
    if (!verdict.errors.length) problems.push(...overlappingFills(expanded), ...coveredLabels(expanded));
  } catch (error) {
    problems.push((error as Error).message);
  }
  return problems.slice(0, 20);
}

async function pencilScene(openai: OpenAI, ctx: MathsBoardContext, spec: CanvasBoardSpec, log: string[], id: string, pitch?: string): Promise<{ lab: LabDrawing | null; costUsd: number }> {
  const system = pencilSystem();
  let user = boardText(ctx, spec, pitch);
  let costUsd = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await json(openai, system, user);
    costUsd += r.costUsd;
    const problems = pencilProblems(r.json, ctx.sentences.length);
    if (!problems.length) {
      const { links: rawLinks, ...scene } = r.json as Record<string, unknown>;
      const links = checkedLinks(rawLinks, scene, spec);
      log.push(`${id}: pencil scene in ${attempt} attempt(s), ${(scene.objects as unknown[] | undefined)?.length ?? 0} objects, ${(scene.steps as unknown[]).length} steps, ${links.length} term link(s)`);
      return { lab: { kind: "pencil", scene, sentenceMs: sentenceMs(ctx.sentences), ...(links.length ? { links } : {}) }, costUsd };
    }
    log.push(`${id}: pencil scene attempt ${attempt} failed — ${problems.slice(0, 3).join("; ")}`);
    user = `${boardText(ctx, spec, pitch)}\n\nYour previous scene:\n${JSON.stringify(r.json).slice(0, 14000)}\n\nThe engine's checker found these problems. Fix every one and return the whole corrected scene:\n- ${problems.join("\n- ")}`;
  }
  return { lab: null, costUsd };
}

/** The links that join a real term of the working to real objects of the scene; the rest are dropped. */
function checkedLinks(raw: unknown, scene: Record<string, unknown>, spec: CanvasBoardSpec): Array<{ token: string; objects: string[]; name: string }> {
  if (!Array.isArray(raw) || spec.stage.kind !== "equation") return [];
  const tokens = new Set(spec.stage.tokens.map((t) => t.id));
  const objects = new Set([...((scene.objects as Array<{ id?: unknown }>) ?? []), ...((scene.groups as Array<{ id?: unknown }>) ?? [])].map((o) => String(o.id)));
  const seen = new Set<string>();
  return raw.flatMap((l) => {
    const token = String((l as { token?: unknown })?.token ?? "");
    const objs = Array.isArray((l as { objects?: unknown })?.objects) ? ((l as { objects: unknown[] }).objects.map(String).filter((o) => objects.has(o))) : [];
    const name = String((l as { name?: unknown })?.name ?? "").trim().slice(0, 28);
    if (!tokens.has(token) || !objs.length || seen.has(token)) return [];
    seen.add(token);
    return [{ token, objects: objs.slice(0, 8), name }];
  });
}

/** How long Aria speaks each sentence, about 2.4 words a second (the pencil fits its strokes into it). */
const sentenceMs = (sentences: string[]) => sentences.map((s) => Math.round((s.split(/\s+/).filter(Boolean).length / 2.4) * 1000));

// ── 3-D ─────────────────────────────────────────────────────────────────────────────────────────
async function view3d(openai: OpenAI, ctx: MathsBoardContext, templateId: string, log: string[], id: string, pitch?: string): Promise<{ lab: LabDrawing | null; costUsd: number }> {
  const t = getTemplate(templateId);
  if (!t) return { lab: null, costUsd: 0 };
  const system = [
    `You fill the data of a 3-D teaching model, "${t.title}", for one lesson board. Use the board's own numbers and names exactly as Aria says them; where she gives none, keep the default. Return the data JSON only, matching this JSON Schema:`,
    JSON.stringify(z.toJSONSchema(t.schema as never)),
    `Default data: ${JSON.stringify(t.defaults)}`,
    "NEVER change a number the board says to make it fit. If the model cannot hold the board's numbers, reply {\"cannot\": \"why\"} instead.",
  ].join("\n");
  let user = boardText(ctx, { heading: ctx.board, notes: [], stage: { kind: "illustration" } } as unknown as CanvasBoardSpec, pitch);
  const said = numbersIn([ctx.board, ...ctx.sentences, ...ctx.written].join(" "));
  let costUsd = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await json(openai, system, user);
    costUsd += r.costUsd;
    if (r.json && typeof r.json === "object" && "cannot" in r.json) {
      log.push(`${id}: 3-D ${templateId} cannot hold this board — ${String((r.json as { cannot: unknown }).cannot).slice(0, 160)}`);
      return { lab: null, costUsd };
    }
    const parsed = t.schema.safeParse(r.json);
    let problem = parsed.success ? "" : parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "data"}: ${i.message}`).join("; ");
    // THE MODEL SHOWS THE BOARD'S NUMBERS (a 3 × 4 × 12 cuboid was once drawn 3 × 4 × 10 to fit a limit).
    if (parsed.success) {
      const unsaid = numbersIn(parsed.data).filter((n) => !said.some((m) => Math.abs(m - n) < 1e-9));
      if (unsaid.length) problem = `the data has ${unsaid.join(", ")}, which the board never says: use only the board's own numbers`;
    }
    if (parsed.success) {
      try {
        const result = await t.run(new RecordingBoard(), parsed.data as never);
        const n = ctx.sentences.length, k = result.steps.length;
        // The model's steps spread over the board's sentences, the first on the first sentence.
        const stepSentence = result.steps.map((_, i) => Math.min(n - 1, Math.floor((i * n) / Math.max(k, 1))));
        log.push(`${id}: 3-D ${templateId} in ${attempt} attempt(s), ${k} steps — ${result.summary}`);
        return { lab: { kind: "view3d", template: templateId, args: parsed.data as Record<string, unknown>, stepSentence, alt: result.summary }, costUsd };
      } catch (error) {
        problem = (error as Error).message;
      }
    }
    log.push(`${id}: 3-D ${templateId} attempt ${attempt} failed — ${problem.slice(0, 200)}`);
    user = `${user}\n\nYour previous data: ${JSON.stringify(r.json).slice(0, 4000)}\nIt was refused: ${problem}\nReturn corrected data.`;
  }
  return { lab: null, costUsd };
}

/** Every number in a value: in data, its numbers; in text, the numbers written in it. */
function numbersIn(v: unknown): number[] {
  if (typeof v === "number") return [v];
  if (typeof v === "string") return [...v.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (Array.isArray(v)) return v.flatMap(numbersIn);
  if (v && typeof v === "object") return Object.values(v).flatMap((x) => (typeof x === "string" ? [] : numbersIn(x)));
  return [];
}

/** A placeholder picture: the board keeps its drawing area (beside the notes or the working) for the lab drawing. */
const AREA: IllustrationStage = { kind: "illustration", subject: "drawing", parts: [], labels: [] } as unknown as IllustrationStage;

/**
 * The board with its lab drawing in its drawing area, or null when none could be made (the caller keeps
 * the board's own drawing). Only a board with a drawing area: an illustration, a figure, or working with
 * a figure or picture beside it.
 */
export async function withLabDrawing(openai: OpenAI, ctx: MathsBoardContext, beat: CanvasPlanBeat, spec: CanvasBoardSpec, log: string[]): Promise<{ spec: CanvasBoardSpec; costUsd: number } | null> {
  const stage = spec.stage;
  const area = stage.kind === "illustration" || stage.kind === "figure" || (stage.kind === "equation" && (beat.mathsPicture || beat.pictureBeside || beat.view3d || stage.figure || stage.picture));
  if (!area) return null;
  const made = beat.view3d ? await view3d(openai, ctx, beat.view3d, log, beat.id, beat.audience) : { lab: null, costUsd: 0 };
  const drawn = made.lab ? made : await pencilScene(openai, ctx, spec, log, beat.id, beat.audience);
  const costUsd = made.costUsd + (drawn === made ? 0 : drawn.costUsd);
  if (!drawn.lab) return null;
  const next: CanvasBoardSpec = stage.kind === "equation"
    ? { ...spec, stage: { ...stage, figure: undefined, picture: AREA }, lab: drawn.lab }
    : { ...spec, stage: AREA, lab: drawn.lab };
  return { spec: next, costUsd };
}
