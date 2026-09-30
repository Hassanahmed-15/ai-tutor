import "server-only";

import { randomBytes } from "node:crypto";
import OpenAI from "openai";
import type { Beat } from "../lessonContent";
import { costFor } from "../modelPricing";
import { drawIllustration, locateParts, pictureSubject, verifyParts } from "../illustratedBoard";
import { layoutPanel } from "./layout";
import { recapTour, unifyConceptColours } from "./lessonPasses";
import { CANVAS_PLAN_PROMPT, CANVAS_SPEC_PROMPT } from "./prompts";
import { CANVAS_STAGES, type CanvasBoardOp, type CanvasBoardSpec, type CanvasStage } from "./types";
import { slug, validateCanvasSpec } from "./validate";
import { saveCanvasImage, saveCanvasLecture, type CanvasLecture } from "./store";

export type { CanvasLecture };

/**
 * A CANVAS LECTURE, end to end: topic → plan (scripts + stages) → one spec per board, in parallel →
 * pictures for illustration boards → Beat[] the ordinary LessonPlayer plays.
 *
 * Measured shape of the cost: the plan is one call; every board is one small JSON call (seconds, not
 * the minutes a generated React board takes); an illustration adds a picture (~20 s) and a locate
 * pass. Lectures and pictures are saved per student (lib/canvas/store.ts), so a replay costs nothing.
 *
 * THE TIME BUDGET. Azure Container Apps ends any request at ~240 s, and the whole lecture is made in
 * one streamed request. Measured runs took 64-154 s; the budget below keeps the slow tail inside the
 * limit by dropping OPTIONAL work as it runs short — a spec retry, a redrawn picture, the second
 * look at a picture's points — never a board.
 */

const PLAN_MODEL = process.env.CANVAS_PLAN_MODEL ?? "gpt-5.6-terra";
const SPEC_MODEL = process.env.CANVAS_SPEC_MODEL ?? "gpt-5.6-luna";
const BUDGET_MS = Number(process.env.CANVAS_BUDGET_MS) || 195_000;

/** Time left before the lecture must be finished, for this generation. */
type Clock = { left: () => number };

export type CanvasPlanBeat = {
  id: string;
  title: string;
  script: string;
  stage: CanvasStage;
  brief: string;
  objects: string[];
  inside: { beat: string; object: string } | null;
  carry: string[];
  interaction: "try" | "draw" | "quiz" | null;
  overview: boolean;
};

export type CanvasProgress = { step: string; detail?: string };

/** Mirrors splitNarrationSentences in lib/voice.ts, which numbers the sentences the player speaks. */
export function canvasSentences(script: string): string[] {
  return script.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

function client(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function bounded<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

async function jsonCall(openai: OpenAI, model: string, system: string, user: string, maxTokens: number): Promise<{ json: unknown; costUsd: number }> {
  const res = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: maxTokens,
    reasoning_effort: "low",
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  const costUsd = costFor(model, res.usage);
  const text = res.choices[0]?.message?.content ?? "";
  try {
    return { json: JSON.parse(text), costUsd };
  } catch {
    throw Object.assign(new Error(`model returned invalid JSON (${text.length} chars, finish=${res.choices[0]?.finish_reason})`), { costUsd });
  }
}

/* ── plan ─────────────────────────────────────────────────────────────────────────────────── */

export function validatePlan(raw: unknown): { title: string; beats: CanvasPlanBeat[] } | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(r.beats) ? r.beats : [];
  const beats: CanvasPlanBeat[] = [];
  list.slice(0, 9).forEach((item, i) => {
    const b = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const script = typeof b.script === "string" ? b.script.replace(/\s+/g, " ").trim() : "";
    const title = typeof b.title === "string" ? b.title.trim().slice(0, 60) : "";
    const stage = (CANVAS_STAGES as readonly string[]).includes(String(b.stage)) ? (b.stage as CanvasStage) : "scene";
    if (!script || !title || canvasSentences(script).length < 2) return;
    const id = `b${beats.length + 1}`;
    const objects = (Array.isArray(b.objects) ? b.objects : []).map((o) => slug(o, "")).filter(Boolean).slice(0, 4);
    const inside = b.inside && typeof b.inside === "object" ? (b.inside as Record<string, unknown>) : null;
    const earlier = inside ? beats.find((p) => p.id === String(inside.beat)) : undefined;
    const insideObject = inside ? slug(inside.object, "") : "";
    beats.push({
      id,
      title,
      script,
      stage,
      brief: typeof b.brief === "string" ? b.brief.slice(0, 300) : "",
      objects,
      inside: earlier && earlier.objects.includes(insideObject) ? { beat: earlier.id, object: insideObject } : null,
      carry: (Array.isArray(b.carry) ? b.carry : []).map((c) => slug(c, "")).filter((c) => objects.includes(c) && (beats[beats.length - 1]?.objects ?? []).includes(c)).slice(0, 2),
      interaction: b.interaction === "try" || b.interaction === "draw" || b.interaction === "quiz" ? b.interaction : null,
      overview: b.overview === true,
    });
    void i;
  });
  if (beats.length < 3) return null;
  // One of each interaction at most — the first the model marked wins.
  const used = new Set<string>();
  for (const beat of beats) {
    if (!beat.interaction) continue;
    if (used.has(beat.interaction)) beat.interaction = null;
    else used.add(beat.interaction);
  }
  beats.forEach((beat, i) => (beat.overview = i === beats.length - 1));
  return { title: typeof r.title === "string" && r.title.trim() ? r.title.trim().slice(0, 80) : beats[0].title, beats };
}

/* ── one board ────────────────────────────────────────────────────────────────────────────── */

function specUserPrompt(topic: string, plan: CanvasPlanBeat[], beat: CanvasPlanBeat, lastError?: string): string {
  const index = plan.indexOf(beat);
  const sentences = canvasSentences(beat.script);
  const outline = plan.map((b) => `${b.id}. ${b.title} (${b.stage})${b.id === beat.id ? "   ← THIS BOARD" : ""}`).join("\n");
  const previous = plan[index - 1];
  const parent = beat.inside ? plan.find((b) => b.id === beat.inside!.beat) : undefined;
  const lines = [
    `Lesson: ${topic}`,
    `Outline:\n${outline}`,
    "",
    `THIS BOARD: ${beat.id} — ${beat.title}`,
    `Stage: ${beat.stage}`,
    `What it shows: ${beat.brief}`,
    `Its objects (use these as element ids): ${beat.objects.join(", ") || "(none named)"}`,
    `Narration, numbered (${sentences.length} sentences, s = 0 to ${sentences.length - 1}):`,
    ...sentences.map((s, i) => `[${i}] ${s}`),
    "",
    previous ? `The previous board (${previous.id}, "${previous.title}") drew: ${previous.objects.join(", ") || "nothing named"}.` : "This is the first board.",
    beat.carry.length ? `"carry": ${JSON.stringify(beat.carry)} — these fly across from the previous board; draw them on this board with exactly these ids.` : `"carry": [].`,
    parent ? `"inside": {"beat": "${parent.id}", "id": "${beat.inside!.object}"} — this board is a close-up inside the ${beat.inside!.object} on board ${parent.id}.` : `"inside": null.`,
    beat.interaction === "try"
      ? `"interaction": a "try" interaction is REQUIRED on this board, and the stage must react to its variables.`
      : beat.interaction
        ? `"interaction": a "${beat.interaction}" interaction is REQUIRED on this board.`
        : `"interaction": null.`,
    `"overview": ${beat.overview}.`,
    ...(beat.overview ? [`This is the recap. Earlier boards you can "visit": ${plan.slice(0, index).map((b) => `${b.id} "${b.title}"`).join(", ")}.`] : []),
  ];
  if (lastError) lines.push("", `Your previous answer could not be used: ${lastError}. Return a complete, valid board.`);
  return lines.join("\n");
}

async function generateSpec(openai: OpenAI, topic: string, plan: CanvasPlanBeat[], beat: CanvasPlanBeat, clock: Clock): Promise<{ spec: CanvasBoardSpec; costUsd: number; attempts: number }> {
  const sentences = canvasSentences(beat.script);
  let costUsd = 0;
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    // A retry is optional work: with too little time left the board falls back instead.
    if (attempt > 1 && clock.left() < 75_000) break;
    try {
      const { json, costUsd: c } = await bounded(jsonCall(openai, SPEC_MODEL, CANVAS_SPEC_PROMPT, specUserPrompt(topic, plan, beat, lastError), 6000), Math.min(45_000, Math.max(10_000, clock.left() - 60_000)), `board ${beat.id}`);
      costUsd += c;
      const raw = json as Record<string, unknown>;
      // The plan decides the stage; a model that drifted to another one is corrected, not trusted.
      if (raw.stage && typeof raw.stage === "object" && (raw.stage as Record<string, unknown>).kind !== beat.stage) {
        lastError = `the stage must be "${beat.stage}", not "${String((raw.stage as Record<string, unknown>).kind)}"`;
        continue;
      }
      const spec = validateCanvasSpec(raw, sentences.length);
      if (!spec) {
        lastError = `the ${beat.stage} stage was missing what it needs to draw (check the schema)`;
        continue;
      }
      if (beat.interaction && spec.interaction?.kind !== beat.interaction) {
        lastError = `the board must carry a "${beat.interaction}" interaction`;
        continue;
      }
      if (spec.interaction?.kind === "try" && spec.interaction.reactions.length < 2) {
        lastError = `the "try" interaction needs 3 to 5 reactions whose "when" conditions use only the slider variables (${spec.interaction.controls.map((c) => c.var).join(", ")})`;
        continue;
      }
      return { spec, costUsd, attempts: attempt };
    } catch (error) {
      costUsd += (error as { costUsd?: number }).costUsd ?? 0;
      lastError = (error as Error).message;
    }
  }
  return { spec: fallbackSpec(beat), costUsd, attempts: -1 };
}

/** A board that always draws: the heading, and the lesson's objects as a simple scene. */
function fallbackSpec(beat: CanvasPlanBeat): CanvasBoardSpec {
  const sentences = canvasSentences(beat.script);
  const items = (beat.objects.length ? beat.objects : [beat.title]).slice(0, 4).map((name, i) => ({
    id: slug(name, `item-${i + 1}`),
    kind: "box" as const,
    label: name,
    cell: `${"ABCD"[i % 4]}${i < 4 ? 2 : 3}`,
    span: "1x2",
    s: Math.min(sentences.length - 1, i),
  }));
  return { v: 1, heading: beat.title.slice(0, 40), notes: [], stage: { kind: "scene", items, arrows: [] }, cues: [], ...(beat.overview ? { overview: true } : {}) };
}

/* ── pictures ─────────────────────────────────────────────────────────────────────────────── */

async function illustrate(openai: OpenAI, userId: string, lectureId: string, beat: CanvasPlanBeat, spec: CanvasBoardSpec, log: string[], clock: Clock): Promise<{ spec: CanvasBoardSpec; costUsd: number }> {
  if (spec.stage.kind !== "illustration") return { spec, costUsd: 0 };
  const stage = spec.stage;
  const started = Date.now();
  let costUsd = 0;
  try {
    if (clock.left() < 50_000) throw new Error("no time left for a picture");
    const subject = pictureSubject(stage.subject);
    const names = stage.parts.map((p) => p.name);
    // An image model sometimes letters its own picture despite being told not to; our labels would
    // then sit beside its misspelt ones. That picture is drawn once more.
    let picture = await bounded(drawIllustration(openai, subject), Math.min(80_000, clock.left() - 30_000), "picture");
    costUsd += picture.costUsd;
    let located = await bounded(locateParts(openai, picture.jpeg, subject, names), Math.min(40_000, Math.max(8_000, clock.left() - 12_000)), "locate");
    costUsd += located.costUsd;
    if (located.textInImage && clock.left() > 110_000) {
      log.push(`${beat.id}: picture had text in it — drawn again`);
      picture = await bounded(drawIllustration(openai, `${subject} Absolutely no letters, words or numbers anywhere in the image.`), 80_000, "picture");
      costUsd += picture.costUsd;
      located = await bounded(locateParts(openai, picture.jpeg, subject, names), 40_000, "locate");
      costUsd += located.costUsd;
    }
    const name = `${lectureId}-${beat.id}`;
    await saveCanvasImage(userId, name, picture.display);
    // The second look at the points is optional work too.
    const unchecked = { parts: located.parts, corrected: [] as string[], costUsd: 0 };
    const checked = clock.left() > 45_000
      ? await bounded(verifyParts(openai, picture.jpeg, subject, located.parts), Math.min(35_000, clock.left() - 12_000), "verify").catch(() => unchecked)
      : unchecked;
    costUsd += checked.costUsd;
    const byName = new Map(checked.parts.map((p) => [p.name.toLowerCase(), p]));
    const parts = stage.parts
      .map((p) => {
        const at = byName.get(p.name.toLowerCase());
        return at ? { ...p, x: Math.round(at.x * 1000) / 1000, y: Math.round(at.y * 1000) / 1000 } : null;
      })
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    const kept = new Set(parts.map((p) => p.id));
    log.push(`${beat.id}: picture ${Math.round((Date.now() - started) / 1000)}s, located ${parts.length}/${stage.parts.length}${checked.corrected.length ? `, corrected ${checked.corrected.join(", ")}` : ""}${located.textInImage ? ", TEXT IN IMAGE" : ""}`);
    return {
      spec: {
        ...spec,
        stage: { ...stage, parts, labels: stage.labels.filter((l) => kept.has(l)), src: `/api/canvas-lecture/image/${name}`, paper: picture.paper },
        cues: spec.cues.filter((c) => !c.target || !stage.parts.some((p) => p.id === c.target) || kept.has(c.target)),
      },
      costUsd,
    };
  } catch (error) {
    log.push(`${beat.id}: picture failed — ${(error as Error).message}`);
    // No picture: keep the board, drawn as a scene of its parts, so the lesson never loses a board.
    return { spec: { ...spec, stage: { kind: "scene", items: stage.parts.slice(0, 6).map((p, i) => ({ id: p.id, kind: "box" as const, label: p.name, cell: `${"ABC"[i % 3]}${i < 3 ? 1 : 3}`, span: "2x2", s: p.s })), arrows: [] } }, costUsd };
  }
}

/* ── the lecture ──────────────────────────────────────────────────────────────────────────── */

async function inBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  }));
  return out;
}

export async function generateCanvasLecture(topic: string, userId: string, onProgress: (p: CanvasProgress) => void = () => {}): Promise<CanvasLecture> {
  const started = Date.now();
  const clock: Clock = { left: () => BUDGET_MS - (Date.now() - started) };
  const openai = client();
  const lectureId = `${slug(topic, "lesson").slice(0, 24)}-${randomBytes(3).toString("hex")}`;
  const log: string[] = [];
  let costUsd = 0;

  onProgress({ step: "plan", detail: "Planning the lesson" });
  let plan: { title: string; beats: CanvasPlanBeat[] } | null = null;
  for (let attempt = 1; attempt <= 2 && !plan && clock.left() > 110_000; attempt++) {
    const { json, costUsd: c } = await bounded(jsonCall(openai, PLAN_MODEL, CANVAS_PLAN_PROMPT, `Topic: ${topic}`, 9000), Math.min(85_000, clock.left() - 100_000), "plan");
    costUsd += c;
    plan = validatePlan(json);
  }
  if (!plan) throw new Error("the lesson plan could not be made");
  log.push(`plan: ${plan.beats.map((b) => `${b.id}=${b.stage}${b.inside ? `(inside ${b.inside.beat}.${b.inside.object})` : ""}${b.interaction ? `[${b.interaction}]` : ""}`).join(" ")} in ${Math.round((Date.now() - started) / 1000)}s`);
  onProgress({ step: "boards", detail: `${plan.beats.length} boards: ${plan.beats.map((b) => b.title).join(" · ")}` });

  const boardsStarted = Date.now();
  const planBeats = plan.beats;
  let done = 0;
  const specs = await inBatches(planBeats, 8, async (beat) => {
    const t0 = Date.now();
    const made = await generateSpec(openai, topic, planBeats, beat, clock);
    costUsd += made.costUsd;
    log.push(`${beat.id}: ${made.spec.stage.kind} spec in ${Math.round((Date.now() - t0) / 1000)}s, ${made.attempts < 0 ? "FALLBACK board" : `${made.attempts} attempt(s)`}`);
    onProgress({ step: "board", detail: `Board ${++done}/${planBeats.length}: ${beat.title}` });
    const pictured = await illustrate(openai, userId, lectureId, beat, made.spec, log, clock);
    costUsd += pictured.costUsd;
    if (made.spec.stage.kind === "illustration") onProgress({ step: "picture", detail: `Illustrated: ${beat.title}` });
    return pictured.spec;
  });
  log.push(`boards: ${Math.round((Date.now() - boardsStarted) / 1000)}s`);

  unifyConceptColours(specs);

  // Cross-board references are checked against what the boards actually drew.
  const beatIdOf = (planId: string) => `cv-${lectureId}-${planId}`;
  const targetsOf = specs.map((spec) => new Set(Object.keys(layoutPanel(spec).targets)));
  const markTypes = specs.map((spec) => new Map(layoutPanel(spec).marks.map((m) => [m.id, m.type])));
  const beats: Beat[] = planBeats.map((beat, i) => {
    let spec = specs[i];
    const parentIndex = beat.inside ? planBeats.findIndex((b) => b.id === beat.inside!.beat) : -1;
    const insideOk = parentIndex >= 0 && parentIndex < i && targetsOf[parentIndex].has(beat.inside!.object);
    spec = { ...spec };
    if (insideOk) spec.inside = { beat: beatIdOf(beat.inside!.beat), id: beat.inside!.object };
    else delete spec.inside;
    // Only a whole element of the same kind flies across (a node to a node) — never a token into a dot.
    const carry = (spec.carry ?? beat.carry).filter((id) => i > 0 && Boolean(markTypes[i - 1].get(id)) && markTypes[i - 1].get(id) === markTypes[i].get(id));
    if (carry.length) spec.carry = carry;
    else delete spec.carry;
    if (beat.overview) spec.overview = true;
    // A visit may only go back, to a board the student has already seen. The model sometimes names
    // boards by title rather than id; those visits are dropped here, BEFORE deciding whether the
    // recap needs the fallback tour — deciding first left recaps with no tour at all.
    const earlierIds = new Set(planBeats.slice(0, i).map((b) => b.id));
    spec.cues = spec.cues.filter((c) => c.action !== "visit" || earlierIds.has(c.beat ?? ""));
    if (beat.overview && !spec.cues.some((c) => c.action === "visit")) spec.cues = [...spec.cues, ...recapTour(beat, planBeats.slice(0, i))];
    spec.cues = spec.cues.map((c) => (c.action === "visit" ? { ...c, beat: beatIdOf(c.beat!) } : c));
    const op: CanvasBoardOp = { kind: "canvasBoard", spec, at: 0, endAt: 1 };
    return {
      id: beatIdOf(beat.id),
      title: beat.title,
      conceptId: slug(beat.title, beat.id),
      teacherMove: beat.brief,
      stepLabel: `${i + 1} · ${beat.title}`,
      slideKind: "intro",
      points: spec.notes.map((n) => n.text),
      keyClaims: spec.notes.map((n) => n.text),
      script: beat.script,
      draw: { caption: spec.heading, ops: [op as never] },
    };
  });

  const lecture: CanvasLecture = { id: lectureId, topic, title: plan.title, beats, costUsd: Math.round(costUsd * 1000) / 1000, createdAt: new Date().toISOString(), ms: Date.now() - started, log };
  await saveCanvasLecture(userId, lecture);
  onProgress({ step: "done", detail: `Ready in ${Math.round(lecture.ms / 1000)}s · $${lecture.costUsd.toFixed(2)}` });
  return lecture;
}
