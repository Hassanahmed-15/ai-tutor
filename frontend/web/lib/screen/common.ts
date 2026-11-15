import "server-only";

import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { lessonCaller } from "@/lib/auth";
import { blobStorageConfigured, uploadRawBlob } from "@/lib/blobStorage";
import { createOpenAI } from "@/lib/openaiClient";
import { spendForTagSince } from "@/lib/spend/record";
import { withSpendScope } from "@/lib/spend/scope";
import type { SpendKind } from "@/lib/spend/usage";

/**
 * MARK ANYTHING ON YOUR SCREEN (the desktop app's ⌃⌥A, first built as screen-lab/). The student
 * circles something in any app; the desktop overlay (public/screen/) sends a close-up and the whole
 * screen here, and Aria explains it on a tiny blackboard, then draws one Manim slide for it and, when
 * asked, a full narrated video. This file is what every /api/screen/* route shares: who is asking,
 * the daily cap, the spend tag, the model, the work folders and where the videos are kept.
 */

export const SCREEN_TAG = "screen";
export const MODEL = process.env.SCREEN_MODEL ?? "gpt-5.6-luna";

/** Dollars one account may spend on screen marks in 24 hours (a mark is ~1¢, a full video ~3¢). */
function dailyLimitUsd(): number {
  const n = Number(process.env.SCREEN_DAILY_LIMIT_USD ?? 0.5);
  return Number.isFinite(n) ? n : 0.5;
}

export type Caller = { userId: string };

/** The signed-in student, or the response that says why not. Mock calls spend nothing and skip the cap. */
export async function screenCaller(mock: boolean): Promise<Caller | Response> {
  const caller = await lessonCaller();
  if (!caller) return Response.json({ error: "Sign in to Aria to mark your screen." }, { status: 401 });
  if (!mock) {
    const limit = dailyLimitUsd();
    if (limit > 0) {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const spent = await spendForTagSince(SCREEN_TAG, caller.userId, since).catch(() => null);
      if (spent && spent.totalUsd >= limit) {
        return Response.json({ error: "That's today's screen marks used up. They come back tomorrow." }, { status: 429 });
      }
    }
  }
  return { userId: caller.userId };
}

/** Runs `fn` with every OpenAI call it makes logged to this student under the screen tag. */
export function spendAs<T>(caller: Caller, kind: SpendKind, fn: () => Promise<T>): Promise<T> {
  return withSpendScope({ tag: SCREEN_TAG, kind, userId: caller.userId }, fn);
}

let client: ReturnType<typeof createOpenAI> | null = null;
export function openai() {
  client ??= createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export type ChatContent = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" | "high" } }>;

/** One non-streamed chat call; the text of the reply. */
export async function chat(system: string, content: ChatContent, opts: { maxTokens: number; json?: boolean; signal?: AbortSignal }): Promise<string> {
  const reply = await openai().chat.completions.create(
    {
      model: MODEL,
      reasoning_effort: "low",
      max_completion_tokens: opts.maxTokens,
      ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
    },
    { signal: opts.signal },
  );
  return reply.choices[0]?.message?.content ?? "";
}

/** A picture the page sent: a JPEG or PNG data URL, or null. */
export function dataImage(value: unknown, maxBytes = 6_000_000): string | null {
  return typeof value === "string" && value.length < maxBytes && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : null;
}

export function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** A run id the server made (explain), safe in a path and a blob name. */
export function runId(): string {
  return `${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function validRun(value: unknown): value is string {
  return typeof value === "string" && /^\d{8}-\d{6}-[a-z0-9]{4,8}$/.test(value);
}

/** A newline-delimited JSON stream back to the page; `signal` aborts when the page hangs up. */
export function ndjson(req: Request, work: (send: (event: Record<string, unknown>) => void, signal: AbortSignal) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (event: Record<string, unknown>) => {
        if (open) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await work(send, req.signal);
      } catch (error) {
        if (!req.signal.aborted) {
          console.warn(`[screen] ${error instanceof Error ? error.message : error}`);
          send({ t: "error", error: error instanceof Error && error.message.length < 200 ? error.message : "Something went wrong." });
        }
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // The page already hung up.
        }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

/**
 * A folder for one slide or video. Open to every user: in production the renderer runs as its own
 * system user (scripts/screen/runner.py), which writes here and must not be able to write anywhere else.
 */
export async function workDir(run: string, what: string): Promise<{ dir: string; done: () => Promise<void> }> {
  const root = path.join(tmpdir(), "aria-screen");
  await mkdir(root, { recursive: true, mode: 0o777 });
  const dir = path.join(root, `${run}-${what}-${Math.random().toString(36).slice(2, 6)}`);
  await mkdir(dir);
  // mkdir's mode is cut by the server's umask; chmod is not.
  await chmod(dir, 0o777);
  return { dir, done: () => rm(dir, { recursive: true, force: true }).catch(() => {}) };
}

export function mediaBlobName(userId: string, run: string, file: string): string {
  return `screen/${userId}/${run}/${file}`;
}

/** Keeps a finished file for the student; returns the URL the page plays it from. */
export async function keep(caller: Caller, run: string, file: string, from: string, contentType: string): Promise<string> {
  if (!blobStorageConfigured()) throw new Error("Video storage is not set up on this server.");
  await uploadRawBlob(mediaBlobName(caller.userId, run, file), await readFile(from), contentType);
  return `/api/screen/media/${run}/${file}`;
}

/**
 * RENDER SLOTS. A Manim render takes a CPU core for a few seconds and a full video starts several at
 * once; past this many on one server the rest wait their turn, so marks never slow the lessons.
 */
const SLOTS = Math.max(1, Number(process.env.SCREEN_RENDER_SLOTS ?? 2));
let busy = 0;
const waiting: Array<() => void> = [];

export async function inSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (busy >= SLOTS) await new Promise<void>((resolve) => waiting.push(resolve));
  busy++;
  try {
    return await fn();
  } finally {
    busy--;
    waiting.shift()?.();
  }
}
