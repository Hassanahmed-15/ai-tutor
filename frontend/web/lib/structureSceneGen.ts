import OpenAI from "openai";
import type { Beat } from "./lessonContent";
import { STRUCTURE_SCENE_SYSTEM_PROMPT } from "./drawPrompt";
import { validateStructureSpec, type StructureSpec } from "./structureSpec";
import type { DrawScript } from "@/components/sketch/LiveSketch";
import { costFor } from "./modelPricing";

type DrawOp = DrawScript["ops"][number];
type StructureSceneOp = Extract<DrawOp, { kind: "structureScene" }>;

/**
 * Second step for TYPE F (STRUCTURAL DIAGRAM) beats, mirroring manimSceneGen.ts exactly.
 *
 * The lecture call writes a `{ kind:"structureScene", structureBrief }` placeholder; this turns
 * each brief into a validated `{ nodes, edges }` spec.
 *
 * WHAT THE MODEL CANNOT DO HERE. It cannot supply a single coordinate. It names the stages and
 * the transitions between them — domain knowledge, which it is good at — and lib/structureLayout.ts
 * decides every position. That split is the entire reason this board type exists: overlapping
 * labels and off-canvas text are not outcomes the model is able to produce.
 *
 * On failure the op is marked `status:"failed"` with no spec, the router declines to select the
 * structural renderer, and the beat falls back to whatever other board it has — degraded, never
 * broken.
 */

const MODEL = process.env.OPENAI_STRUCTURE_MODEL ?? process.env.OPENAI_LECTURE_MODEL ?? "gpt-4o";
const MAX_TOKENS = Math.max(600, Math.min(4_000, Number(process.env.OPENAI_STRUCTURE_MAX_TOKENS ?? 1_200)));
const MAX_ATTEMPTS = Math.max(1, Math.min(4, Number(process.env.OPENAI_STRUCTURE_ATTEMPTS ?? 2)));


export type StructureFillStats = {
  costUsd: number;
  pending: number;
  filled: number;
  rejected: number;
  issues: string[];
};

function costUsd(usage: OpenAI.Chat.Completions.ChatCompletion["usage"] | undefined): number {
  return costFor(MODEL, usage);
}

export function findStructureSceneOp(draw: DrawScript | undefined): StructureSceneOp | null {
  const op = draw?.ops?.find((o) => o.kind === "structureScene");
  return (op as StructureSceneOp | undefined) ?? null;
}

function buildUserPrompt(op: StructureSceneOp, beat: Beat, previousIssue?: string): string {
  const retry = previousIssue
    ? `\n\nYour previous attempt was rejected: ${previousIssue}\nFix exactly that and return the corrected JSON.`
    : "";
  return (
    [
      `Lecture beat title: ${beat.title}`,
      `Spoken script: ${beat.script}`,
      `Structure brief: ${op.structureBrief ?? ""}`,
      "",
      "Return the JSON spec for this diagram.",
    ].join("\n") + retry
  );
}

/** Strips a ```json fence if the model adds one despite being told not to. */
function parseSpec(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(text);
  } catch {
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
  op: StructureSceneOp,
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
          { role: "system", content: STRUCTURE_SCENE_SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(op, beat, issue) },
        ],
        response_format: { type: "json_object" },
      });
      spent += costUsd(completion.usage);

      const spec: StructureSpec | null = validateStructureSpec(
        parseSpec(completion.choices[0]?.message?.content ?? ""),
      );
      if (spec) {
        op.spec = spec;
        op.status = "ready";
        delete op.error;
        return { filled: true, costUsd: spent };
      }
      issue =
        "the spec did not validate — `kind` must be one of cycle/flow/tree/state, there must be 3-8 nodes each with a unique `id` and a `label`, and at least one edge whose `from`/`to` both match node ids";
    } catch (error) {
      issue = error instanceof Error ? error.message : "generation call failed";
    }
  }

  op.status = "failed";
  op.error = issue?.slice(0, 200) ?? "structure spec was not available";
  return { filled: false, costUsd: spent, issue };
}

export async function fillStructureSceneOps(client: OpenAI, beats: Beat[]): Promise<StructureFillStats> {
  const pending: Array<{ op: StructureSceneOp; beat: Beat }> = [];
  for (const beat of beats) {
    const op = findStructureSceneOp(beat.draw);
    if (op && !op.spec && op.status !== "failed") pending.push({ op, beat });
  }
  if (pending.length === 0) {
    return { costUsd: 0, pending: 0, filled: 0, rejected: 0, issues: [] };
  }

  const results = await Promise.all(pending.map(({ op, beat }) => generateOne(client, op, beat)));
  const filled = results.filter((r) => r.filled).length;
  return {
    costUsd: results.reduce((sum, r) => sum + r.costUsd, 0),
    pending: pending.length,
    filled,
    rejected: pending.length - filled,
    issues: results.filter((r) => !r.filled && r.issue).map((r) => r.issue as string).slice(0, 5),
  };
}
