import OpenAI from "openai";
import type { Beat } from "./lessonContent";
import { MANIM_SCENE_SYSTEM_PROMPT } from "./drawPrompt";
import { validateManimSceneSpec, type ManimSceneSpec } from "./manimSceneSpec";
import type { DrawScript } from "@/components/sketch/LiveSketch";
import { costFor } from "./modelPricing";

type DrawOp = DrawScript["ops"][number];
type ManimSceneOp = Extract<DrawOp, { kind: "manimScene" }>;

/**
 * Second step for TYPE D (DIAGRAM) beats, mirroring blackboardGen.ts and reactAnimationGen.ts.
 *
 * The lecture call writes a `{ kind:"manimScene", sceneBrief }` placeholder; this turns each
 * brief into a typed spec that scripts/manim/scenes.py renders as a plotted graph, a shape
 * transformation, a flow, or a measured construction.
 *
 * WHAT THE MODEL CANNOT DO HERE. It cannot write code and it cannot write a formula. A curve
 * is a name from a fixed family plus coefficients, so nothing it returns is ever parsed or
 * evaluated — validateManimSceneSpec drops anything outside that shape. That is the whole
 * reason this is a spec call and not a "write me a Manim scene" call.
 *
 * On failure the op is marked `status:"failed"` with no spec. isManimWorthy then returns false
 * for the beat and it renders on the live SVG board instead — a degraded beat, never a broken
 * one.
 */

const MODEL = process.env.OPENAI_MANIM_SCENE_MODEL ?? process.env.OPENAI_LECTURE_MODEL ?? "gpt-4o";
const MAX_TOKENS = Math.max(600, Math.min(4_000, Number(process.env.OPENAI_MANIM_SCENE_MAX_TOKENS ?? 1_200)));
const MAX_ATTEMPTS = Math.max(1, Math.min(4, Number(process.env.OPENAI_MANIM_SCENE_ATTEMPTS ?? 2)));

// Same gpt-4o-era rates the other generators assume; override models may differ.

export type ManimSceneFillStats = {
  costUsd: number;
  pending: number;
  filled: number;
  rejected: number;
  issues: string[];
};

export type ManimSceneFillUpdate = {
  beat: Beat;
  beatIndex: number;
  costUsd: number;
  status: "ready" | "failed";
};

function costUsd(usage: OpenAI.Chat.Completions.ChatCompletion["usage"] | undefined): number {
  return costFor(MODEL, usage);
}

export function findManimSceneOp(draw: DrawScript | undefined): ManimSceneOp | null {
  const op = draw?.ops?.find((o) => o.kind === "manimScene");
  return (op as ManimSceneOp | undefined) ?? null;
}

function buildUserPrompt(op: ManimSceneOp, beat: Beat, previousIssue?: string): string {
  const retry = previousIssue
    ? `\n\nYour previous attempt was rejected: ${previousIssue}\nFix exactly that and return the corrected JSON.`
    : "";
  return [
    `Lecture beat title: ${beat.title}`,
    `Spoken script: ${beat.script}`,
    `Scene brief: ${op.sceneBrief ?? ""}`,
    "",
    "Return the JSON spec for this diagram.",
  ].join("\n") + retry;
}

/** Strips a ```json fence if the model adds one despite being told not to. */
function parseSpec(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(text);
  } catch {
    // Occasionally there is prose around the object; take the outermost braces.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

async function generateOne(
  client: OpenAI,
  op: ManimSceneOp,
  beat: Beat,
): Promise<{ filled: boolean; costUsd: number; issue?: string }> {
  let spent = 0;
  let issue: string | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: "system", content: MANIM_SCENE_SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(op, beat, issue) },
        ],
        response_format: { type: "json_object" },
      });
      spent += costUsd(completion.usage);

      const spec: ManimSceneSpec | null = validateManimSceneSpec(parseSpec(completion.choices[0]?.message?.content ?? ""));
      if (spec) {
        op.spec = spec;
        op.status = "ready";
        delete op.error;
        return { filled: true, costUsd: spent };
      }
      issue =
        "the spec did not validate — check that `kind` is one of graph/transform/flow/geometry, that `fn` is one of the eight allowed names (never a formula), and that the ranges are non-empty";
    } catch (error) {
      issue = error instanceof Error ? error.message : "generation call failed";
    }
  }

  op.status = "failed";
  op.error = issue?.slice(0, 200) ?? "diagram spec was not available";
  return { filled: false, costUsd: spent, issue };
}

export async function fillManimSceneOps(client: OpenAI, beats: Beat[]): Promise<ManimSceneFillStats> {
  return fillManimSceneOpsIncremental(client, beats);
}

export async function fillManimSceneOpsIncremental(
  client: OpenAI,
  beats: Beat[],
  onUpdate?: (update: ManimSceneFillUpdate) => void | Promise<void>,
  options: { limit?: number } = {},
): Promise<ManimSceneFillStats> {
  const pending: Array<{ op: ManimSceneOp; beat: Beat; beatIndex: number }> = [];
  for (let beatIndex = 0; beatIndex < beats.length; beatIndex++) {
    const op = findManimSceneOp(beats[beatIndex].draw);
    if (op && !op.spec && op.status !== "failed") {
      pending.push({ op, beat: beats[beatIndex], beatIndex });
    }
  }

  const selected = typeof options.limit === "number" ? pending.slice(0, Math.max(0, options.limit)) : pending;
  if (selected.length === 0) {
    return { costUsd: 0, pending: 0, filled: 0, rejected: 0, issues: [] };
  }

  const results = await Promise.all(
    selected.map(async ({ op, beat, beatIndex }) => {
      const result = await generateOne(client, op, beat);
      await onUpdate?.({ beat, beatIndex, costUsd: result.costUsd, status: result.filled ? "ready" : "failed" });
      return result;
    }),
  );

  const filled = results.filter((r) => r.filled).length;
  return {
    costUsd: results.reduce((sum, r) => sum + r.costUsd, 0),
    pending: selected.length,
    filled,
    rejected: selected.length - filled,
    issues: results.filter((r) => !r.filled && r.issue).map((r) => r.issue as string).slice(0, 5),
  };
}
