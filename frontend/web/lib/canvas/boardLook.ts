import type OpenAI from "openai";
import { costFor } from "../modelPricing";
import { loadCanvasImage } from "./store";
import { BOARD_LOOK_PROMPT, boardAlone, lookUserText, parseBoardLook, type LookProblem } from "./boardLookCheck";
import { PANEL_H, PANEL_W, type CanvasBoardSpec } from "./types";

/**
 * EYES ON EVERY BOARD BEFORE A STUDENT SEES IT (owner, 2026-10-23: a vision check on every board, in a real
 * browser — "100 percent accurate diagrams"). The finished board is drawn by the real board code in a
 * headless Chromium (the page app/board-render), photographed, and a vision model checks the photograph
 * against what Aria says (lib/canvas/boardLookCheck.ts). The worker's own pictures are put into the board
 * as data first, so the page needs no account.
 *
 * It never stops a lecture: a browser that will not start, a page that will not draw or a model that does
 * not answer returns null (not looked at), and the caller ships the board as checked by code alone.
 *
 * BOARD_RENDER_URL is the web app's /board-render page (the worker reaches it over the network);
 * CANVAS_BOARD_LOOK=off turns the eyes off; CANVAS_BOARD_LOOK_MODEL picks the vision model.
 */
export const LOOK_MODEL = process.env.CANVAS_BOARD_LOOK_MODEL ?? "gpt-5.6-luna";
/**
 * Drawings are judged by the stronger model (calibration on the manager's six lectures, 2026-10-23: the
 * light model passed a lone circle standing for isotopes and a label pointing at the wrong vessel; the
 * stronger one refused both and passed every good board). Working, code and comparison boards keep the
 * light one — it caught every fault on them — so a board costs about $0.006 on average. The owner moved
 * drawings to the light model too (2026-10-25); CANVAS_BOARD_LOOK_DRAWING_MODEL=gpt-5.6-sol puts it back.
 */
export const LOOK_DRAWING_MODEL = process.env.CANVAS_BOARD_LOOK_DRAWING_MODEL ?? "gpt-5.6-luna";
const DRAWN = new Set(["sketch", "illustration", "figure", "diagram", "atom-map", "molecule", "scene", "graph", "structure"]);
export function lookModelFor(stageKind: string): string {
  return process.env.CANVAS_BOARD_LOOK_MODEL ? LOOK_MODEL : DRAWN.has(stageKind) ? LOOK_DRAWING_MODEL : LOOK_MODEL;
}
const RENDER_URL = process.env.BOARD_RENDER_URL ?? "http://localhost:3000/board-render";

type Browser = import("playwright").Browser;
const globalForLook = globalThis as unknown as { ariaLookBrowser?: Promise<Browser | null> };

/** One browser for the whole process, started on first use; a crashed one is started again. */
async function browser(): Promise<Browser | null> {
  const existing = globalForLook.ariaLookBrowser ? await globalForLook.ariaLookBrowser : null;
  if (existing?.isConnected()) return existing;
  globalForLook.ariaLookBrowser = (async () => {
    try {
      const { chromium } = await import("playwright");
      return await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    } catch (error) {
      console.warn(`[board-look] no browser: ${(error as Error).message.split("\n")[0]}`);
      return null;
    }
  })();
  return globalForLook.ariaLookBrowser;
}

/** The board with its stored pictures as data, so the render page can draw them without an account. */
async function withInlinePictures(spec: CanvasBoardSpec, userId: string): Promise<CanvasBoardSpec> {
  const copy = structuredClone(spec);
  const names = new Set<string>();
  JSON.stringify(copy, (_k, v) => {
    if (typeof v === "string") for (const m of v.matchAll(/\/api\/canvas-lecture\/image\/([A-Za-z0-9_.-]+)/g)) names.add(m[1]);
    return v;
  });
  if (!names.size) return copy;
  const data = new Map<string, string>();
  for (const name of names) {
    let bytes = await loadCanvasImage(userId, name).catch(() => null);
    // Local checks of saved lectures: the pictures live with the deployment (BOARD_LOOK_PICTURES_FROM, dev only).
    if (!bytes && process.env.BOARD_LOOK_PICTURES_FROM && process.env.NODE_ENV !== "production") bytes = await fetch(`${process.env.BOARD_LOOK_PICTURES_FROM}/api/canvas-lecture/image/${name}`, { headers: { cookie: process.env.BOARD_LOOK_COOKIE ?? "" } }).then(async (r) => (r.ok ? Buffer.from(await r.arrayBuffer()) : null)).catch(() => null);
    if (bytes) data.set(name, `data:image/jpeg;base64,${bytes.toString("base64")}`);
  }
  const swap = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(/\/api\/canvas-lecture\/image\/([A-Za-z0-9_.-]+)/g, (whole, name) => data.get(name) ?? whole);
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
    return v;
  };
  return swap(copy) as CanvasBoardSpec;
}

/** The finished board as the student sees it, as a PNG; null when it could not be drawn. */
export async function boardPhoto(spec: CanvasBoardSpec, opts: { userId: string; topic: string; /** Without Aria's pointer, rings and underlines (her cues) — the board alone. */ withoutCues?: boolean; /** QA: the board part-way through a sentence, not finished, after the pen has had `waitMs` to write it. */ at?: { sentence: number; progress: number; waitMs?: number } }): Promise<Buffer | null> {
  const b = await browser();
  if (!b) return null;
  // Tall enough that the whole board is in view whatever the canvas leaves room for beside it.
  const page = await b.newPage({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 1 }).catch(() => null);
  if (!page) return null;
  try {
    const board = { spec: await withInlinePictures(opts.withoutCues ? boardAlone(spec) : spec, opts.userId), topic: opts.topic, ...(opts.at ? { sentence: opts.at.sentence, progress: opts.at.progress } : {}) };
    await page.addInitScript((given) => {
      (window as unknown as { __board?: unknown }).__board = given;
      (window as unknown as { __name?: unknown }).__name = (f: unknown) => f;
    }, board);
    await page.goto(RENDER_URL, { waitUntil: "domcontentloaded", timeout: 40_000 });
    await page.waitForSelector("body[data-board-ready='1']", { timeout: 30_000 });
    if (opts.at?.waitMs) await page.waitForTimeout(opts.at.waitMs);
    // The board's own rectangle (PANEL_W × PANEL_H in its coordinates) on the screen — the group's outline
    // also holds things the student never sees (a shadow, a carried element waiting off the board).
    const clip = await page.evaluate(({ w, h }) => {
      const g = document.querySelector('[data-panel="board"]') as SVGGraphicsElement | null;
      const m = g?.getScreenCTM();
      if (!m) return null;
      const p0 = new DOMPoint(0, 0).matrixTransform(m), p1 = new DOMPoint(w, h).matrixTransform(m);
      return { x: Math.max(0, p0.x), y: Math.max(0, p0.y), width: p1.x - p0.x, height: p1.y - p0.y };
    }, { w: PANEL_W, h: PANEL_H });
    if (!clip || clip.width < 100) return null;
    return await page.screenshot({ clip, timeout: 15_000 });
  } catch (error) {
    console.warn(`[board-look] could not draw the board: ${(error as Error).message.split("\n")[0]}`);
    return null;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** The vision check of one photographed board; null when the model did not answer. */
export async function lookAtBoard(openai: OpenAI, png: Buffer, input: { topic: string; title: string; script: string; stageKind?: string }): Promise<{ ok: boolean; problems: LookProblem[]; costUsd: number } | null> {
  const model = lookModelFor(input.stageKind ?? "");
  try {
    const res = await openai.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      max_completion_tokens: 2500,
      reasoning_effort: process.env.CANVAS_BOARD_LOOK_EFFORT ?? "low",
      messages: [
        { role: "system", content: BOARD_LOOK_PROMPT },
        { role: "user", content: [{ type: "text", text: lookUserText(input) }, { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } }] },
      ],
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
    const verdict = parseBoardLook(JSON.parse(res.choices[0]?.message?.content ?? "{}"));
    return { ...verdict, costUsd: costFor(model, res.usage) };
  } catch (error) {
    console.warn(`[board-look] no verdict: ${(error as Error).message.split("\n")[0]}`);
    return null;
  }
}

/**
 * On, but loosened (owner, 2026-10-24: "vision check on now but please loosen its check, it always rejects
 * things"): only a serious fault refuses a board, it is redrawn once, and it never falls back to plain boxes
 * (lib/canvas/progressive.ts). CANVAS_BOARD_LOOK=off turns it off.
 */
export function boardLookOn(): boolean {
  return process.env.CANVAS_BOARD_LOOK !== "off";
}
