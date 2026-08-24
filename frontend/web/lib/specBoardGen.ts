import OpenAI from "openai";
import type { Beat } from "./lessonContent";
import { PLOT_BOARD_SYSTEM_PROMPT, EQUATION_BOARD_SYSTEM_PROMPT } from "./drawPrompt";
import { validatePlotSpec, compilesAsVegaLite } from "./plotSpec";
import { parseEquationSpec } from "./equationSpec";
import type { DrawScript } from "@/components/sketch/LiveSketch";
import { costFor } from "./modelPricing";

type DrawOp = DrawScript["ops"][number];
type PlotBoardOp = Extract<DrawOp, { kind: "plotBoard" }>;
type EquationBoardOp = Extract<DrawOp, { kind: "equationBoard" }>;
type SpecBoardOp = PlotBoardOp | EquationBoardOp;

/**
 * Second step for the two spec-driven boards, mirroring structureSceneGen.ts exactly.
 *
 * The lecture call (or the board director) writes a `{ kind, …Brief }` placeholder; this turns
 * each brief into a validated spec. One module for both because everything except the prompt and
 * the validator is identical, and two near-copies drift.
 *
 * WHAT THE MODEL CANNOT DO HERE, in either case, is decide geometry. For a plot it supplies data
 * values and encodings and Vega-Lite derives every axis, tick and legend; for a derivation it
 * supplies TeX and KaTeX does the typesetting. That split is the whole reason these board types
 * exist — the failure mode of a model placing its own coordinates is a board with overlapping
 * labels and text off the edge, and it is unreachable here.
 *
 * VALIDATION MEANS RENDERABLE, and it is checked by the renderer itself rather than asserted:
 * `compilesAsVegaLite` compiles the chart, and every TeX line is compiled by KaTeX inside
 * `parseEquationSpec`. A spec that survives is one the board can actually draw.
 *
 * On failure the op is marked `status:"failed"` with no spec and the beat falls back to whatever
 * other board it has — degraded, never broken.
 */

const MODEL = process.env.OPENAI_SPEC_BOARD_MODEL ?? process.env.OPENAI_LECTURE_MODEL ?? "gpt-4o";
const MAX_TOKENS = Math.max(600, Math.min(4_000, Number(process.env.OPENAI_SPEC_BOARD_MAX_TOKENS ?? 2_500)));
const MAX_ATTEMPTS = Math.max(1, Math.min(4, Number(process.env.OPENAI_SPEC_BOARD_ATTEMPTS ?? 2)));


export type SpecBoardFillStats = {
  costUsd: number;
  pending: number;
  filled: number;
  rejected: number;
  issues: string[];
};

function costUsd(usage: OpenAI.Chat.Completions.ChatCompletion["usage"] | undefined): number {
  return costFor(MODEL, usage);
}

export function findSpecBoardOp(draw: DrawScript | undefined): SpecBoardOp | null {
  const op = draw?.ops?.find((o) => o.kind === "plotBoard" || o.kind === "equationBoard");
  return (op as SpecBoardOp | undefined) ?? null;
}

function briefOf(op: SpecBoardOp): string {
  return (op.kind === "plotBoard" ? op.plotBrief : op.equationBrief) ?? "";
}

function buildUserPrompt(op: SpecBoardOp, beat: Beat, previousIssue?: string): string {
  const retry = previousIssue
    ? `\n\nYour previous attempt was rejected: ${previousIssue}\nFix exactly that and return the corrected JSON.`
    : "";
  return (
    [
      `Lecture beat title: ${beat.title}`,
      `Spoken script: ${beat.script}`,
      `Brief: ${briefOf(op)}`,
      "",
      "Return the JSON spec for this board.",
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

/** Validates against the renderer that will draw it. Returns the spec, or why it was rejected. */
async function validateFor(op: SpecBoardOp, raw: unknown): Promise<{ spec: unknown } | { issue: string }> {
  if (op.kind === "plotBoard") {
    const spec = validatePlotSpec(raw);
    if (!spec) {
      return {
        issue:
          "not a usable Vega-Lite spec — it needs a drawable `mark` (bar/line/point/area/circle/square/tick/rule), INLINE data under `data.values`, and at least one positional encoding (x, y or theta)",
      };
    }
    // The structural pass has no opinion about semantics: `type: "sideways"` is shaped correctly
    // and is still nonsense. Only the compiler knows, so the compiler is asked.
    if (!(await compilesAsVegaLite(spec))) {
      return { issue: "the spec is shaped correctly but Vega-Lite could not compile it — check every encoding's `type` is one of quantitative/nominal/ordinal/temporal" };
    }
    return { spec };
  }

  const { spec, rejected } = parseEquationSpec(raw);
  if (spec) return { spec };
  return {
    issue: rejected[0]
      ? `KaTeX rejected the steps — ${rejected[0].reason}. Remember that a backslash inside a JSON string must be written twice: "\\\\frac{a}{b}", not "\\frac{a}{b}".`
      : "the derivation needs at least two steps, each with `tex` that compiles in KaTeX",
  };
}

async function generateOne(
  client: OpenAI,
  op: SpecBoardOp,
  beat: Beat,
): Promise<{ filled: boolean; costUsd: number; issue?: string }> {
  const systemPrompt = op.kind === "plotBoard" ? PLOT_BOARD_SYSTEM_PROMPT : EQUATION_BOARD_SYSTEM_PROMPT;
  let spent = 0;
  let issue: string | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: buildUserPrompt(op, beat, issue) },
        ],
        response_format: { type: "json_object" },
      });
      spent += costUsd(completion.usage);

      const result = await validateFor(op, parseSpec(completion.choices[0]?.message?.content ?? ""));
      if ("spec" in result) {
        op.spec = result.spec;
        op.status = "ready";
        delete op.error;
        console.error(`[spec-board] beat=${beat.id} ${op.kind} ready`);
        return { filled: true, costUsd: spent };
      }
      issue = result.issue;
    } catch (error) {
      issue = error instanceof Error ? error.message : "generation call failed";
    }
  }

  op.status = "failed";
  op.error = issue?.slice(0, 200) ?? "spec was not available";
  console.error(`[spec-board] beat=${beat.id} ${op.kind} FAILED: ${op.error}`);
  return { filled: false, costUsd: spent, issue };
}

export async function fillSpecBoardOps(client: OpenAI, beats: Beat[]): Promise<SpecBoardFillStats> {
  const pending: Array<{ op: SpecBoardOp; beat: Beat }> = [];
  for (const beat of beats) {
    const op = findSpecBoardOp(beat.draw);
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
