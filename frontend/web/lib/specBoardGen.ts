import OpenAI from "openai";
import type { Beat } from "./lessonContent";
import { PLOT_BOARD_SYSTEM_PROMPT, EQUATION_BOARD_SYSTEM_PROMPT, CODE_BOARD_SYSTEM_PROMPT } from "./drawPrompt";
import { validatePlotSpec, compilesAsVegaLite, plotFieldIssue } from "./plotSpec";
import { parseEquationSpec } from "./equationSpec";
import { parseCodeSpec, verifyFromSource, type CodeSpec } from "./codeSpec";
import type { DrawScript } from "@/components/sketch/LiveSketch";
import { costFor } from "./modelPricing";
import { withAudience } from "./learnerBrief";
import type { ContentPart } from "./fullDocumentContext";

type DrawOp = DrawScript["ops"][number];
type PlotBoardOp = Extract<DrawOp, { kind: "plotBoard" }>;
type EquationBoardOp = Extract<DrawOp, { kind: "equationBoard" }>;
type CodeBoardOp = Extract<DrawOp, { kind: "codeBoard" }>;
type SpecBoardOp = PlotBoardOp | EquationBoardOp | CodeBoardOp;

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
/** How much of a beat's document text a code board is shown when looking for the code to quote. */
const MAX_SOURCE_CHARS = 12_000;


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
  const op = draw?.ops?.find((o) => o.kind === "plotBoard" || o.kind === "equationBoard" || o.kind === "codeBoard");
  return (op as SpecBoardOp | undefined) ?? null;
}

function briefOf(op: SpecBoardOp): string {
  return (op.kind === "plotBoard" ? op.plotBrief : op.kind === "codeBoard" ? op.codeBrief : op.equationBrief) ?? "";
}

function buildUserPrompt(op: SpecBoardOp, beat: Beat, previousIssue?: string, source?: string, request?: string, priorCode: string[] = []): string {
  const retry = previousIssue
    ? `\n\nYour previous attempt was rejected: ${previousIssue}\nFix exactly that and return the corrected JSON.`
    : "";
  // Only the code board is given the document: it must QUOTE the student's code, not invent a
  // plausible version of it. The other spec boards are drawn from the script, as before.
  const excerpt = op.kind === "codeBoard" && source?.trim()
    ? ["", "Source excerpt (the student's own document; its line breaks were lost in extraction):", source.slice(0, MAX_SOURCE_CHARS)]
    : [];
  // What the student asked for — it carries the language ("in C++") the listing must be written in.
  const asked = op.kind === "codeBoard" && request?.trim() ? [`Student's request: ${request.trim().slice(0, 300)}`] : [];
  /*
   * CODE ALREADY ON EARLIER BOARDS. Each code board was written alone, so every board of a
   * "while loop" lesson reached for the same count-to-five loop — the same listing three and four
   * times. The earlier listings are shown so this board writes a DIFFERENT example that shows only
   * what this board teaches.
   */
  const shown = op.kind === "codeBoard" && priorCode.length
    ? [
        "",
        "CODE ALREADY SHOWN on earlier boards of this lesson — do NOT show it again, not even with renamed variables or changed numbers:",
        ...priorCode.slice(-4).map((code, i) => `--- earlier board ${i + 1} ---\n${code.slice(0, 700)}`),
        "Write a DIFFERENT example that demonstrates exactly what THIS board teaches: a NEW scenario with new variable names and a new purpose (e.g. reading input, searching a list, a game loop), never the earlier listing again with a line added or a number changed.",
      ]
    : [];
  return (
    [
      `Lecture beat title: ${beat.title}`,
      `Spoken script: ${beat.script}`,
      `Brief: ${briefOf(op)}`,
      ...asked,
      ...excerpt,
      ...shown,
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
    // A chart whose encodings name columns the data does not have compiles fine and draws only its
    // axes and legend — the empty "overfitting" board. Named precisely, so the retry can fix it.
    const fieldIssue = plotFieldIssue(spec);
    if (fieldIssue) return { issue: fieldIssue };
    // The structural pass has no opinion about semantics: `type: "sideways"` is shaped correctly
    // and is still nonsense. Only the compiler knows, so the compiler is asked.
    if (!(await compilesAsVegaLite(spec))) {
      return { issue: "the spec is shaped correctly but Vega-Lite could not compile it — check every encoding's `type` is one of quantitative/nominal/ordinal/temporal" };
    }
    return { spec };
  }

  if (op.kind === "codeBoard") {
    const { spec, rejected } = parseCodeSpec(raw);
    if (spec) return { spec };
    return { issue: rejected[0]?.reason ?? "not a usable code spec — it needs `language`, `code` and at least two `steps`" };
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
  source?: string,
  images: ContentPart[] = [],
  request?: string,
  priorCode: string[] = [],
): Promise<{ filled: boolean; costUsd: number; issue?: string }> {
  const systemPrompt = op.kind === "plotBoard"
    ? PLOT_BOARD_SYSTEM_PROMPT
    : op.kind === "codeBoard"
      ? CODE_BOARD_SYSTEM_PROMPT
      : EQUATION_BOARD_SYSTEM_PROMPT;
  let spent = 0;
  let issue: string | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            // A code board may be handed the document's pages: on a scanned PDF they are the only
            // place the code exists, so it is read off the image rather than invented.
            content: op.kind === "codeBoard" && images.length > 0
              ? ([
                  { type: "text", text: withAudience(beat, buildUserPrompt(op, beat, issue, source, request, priorCode)) + "\n\nThe document's pages are attached as images. If the code is on them, copy it from there verbatim and set fromSource: true." },
                  ...images,
                ] as OpenAI.Chat.Completions.ChatCompletionContentPart[])
              : withAudience(beat, buildUserPrompt(op, beat, issue, source, request, priorCode)),
          },
        ],
        response_format: { type: "json_object" },
      });
      spent += costUsd(completion.usage);

      const parsed = await validateFor(op, parseSpec(completion.choices[0]?.message?.content ?? ""));
      // A listing that is the same as an earlier board's (after normalising names and numbers) is
      // rejected with that reason, so the retry writes a genuinely new example.
      const repeat = "spec" in parsed && op.kind === "codeBoard" && priorCode.some((code) => codeSimilarity((parsed.spec as CodeSpec).code, code) >= CODE_REPEAT_THRESHOLD);
      const result = repeat ? { issue: "this listing repeats code an earlier board already showed — write a different example for this board's point" } : parsed;
      if ("spec" in result) {
        // "From your document" is shown only for code that IS in the document — the model's own
        // claim was measured wrong on a scan with no listing and on a topic with no document at all.
        if (op.kind === "codeBoard") {
          const code = result.spec as CodeSpec;
          if (code.fromSource && !verifyFromSource(code.code, source)) delete code.fromSource;
        }
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

export type SpecBoardFillOptions = {
  /** Document text per beat id. Read only by code boards, which quote the source verbatim. */
  sourceByBeatId?: Map<string, string>;
  /** Page images per beat id, likewise read only by code boards. */
  imagesByBeatId?: Map<string, ContentPart[]>;
  /** What the student asked for, per beat id — read only by code boards. */
  requestByBeatId?: Map<string, string>;
  /** Listings earlier boards of this lesson already showed, per beat id — never shown again. */
  priorCodeByBeatId?: Map<string, string[]>;
};

export async function fillSpecBoardOps(client: OpenAI, beats: Beat[], options: SpecBoardFillOptions = {}): Promise<SpecBoardFillStats> {
  const pending: Array<{ op: SpecBoardOp; beat: Beat }> = [];
  for (const beat of beats) {
    const op = findSpecBoardOp(beat.draw);
    if (op && !op.spec && op.status !== "failed") pending.push({ op, beat });
  }
  if (pending.length === 0) {
    return { costUsd: 0, pending: 0, filled: 0, rejected: 0, issues: [] };
  }

  const results = await Promise.all(
    pending.map(({ op, beat }) => generateOne(client, op, beat, options.sourceByBeatId?.get(beat.id), options.imagesByBeatId?.get(beat.id), options.requestByBeatId?.get(beat.id), options.priorCodeByBeatId?.get(beat.id))),
  );
  const filled = results.filter((r) => r.filled).length;
  return {
    costUsd: results.reduce((sum, r) => sum + r.costUsd, 0),
    pending: pending.length,
    filled,
    rejected: pending.length - filled,
    issues: results.filter((r) => !r.filled && r.issue).map((r) => r.issue as string).slice(0, 5),
  };
}

/** At or above this similarity a listing counts as a repeat of another board's code. */
export const CODE_REPEAT_THRESHOLD = 0.7;

/** True when `code` repeats any of `others` (see codeSimilarity). */
export function repeatsCode(code: string, others: string[]): boolean {
  return others.some((other) => codeSimilarity(code, other) >= CODE_REPEAT_THRESHOLD);
}

/**
 * How alike two listings are, 0..1 — Jaccard overlap of token trigrams, ignoring only what a
 * re-run changes cosmetically (numbers, string contents, whitespace). Names are kept: two genuinely
 * different while loops share their keywords but not their variables and logic, and must not be
 * mistaken for a copy.
 */
export function codeSimilarity(a: string, b: string): number {
  const tokens = (code: string) =>
    (code.match(/[A-Za-z_]\w*|\d+(?:\.\d+)?|"[^"]*"|'[^']*'|[^\s\w]/g) ?? []).map((token) =>
      /^\d/.test(token) ? "N" : /^["']/.test(token) ? "S" : token.toLowerCase(),
    );
  const grams = (list: string[]) => {
    const out = new Set<string>();
    for (let i = 0; i + 2 < list.length; i++) out.add(`${list[i]} ${list[i + 1]} ${list[i + 2]}`);
    return out;
  };
  const ga = grams(tokens(a));
  const gb = grams(tokens(b));
  if (ga.size === 0 || gb.size === 0) return 0;
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared += 1;
  return shared / (ga.size + gb.size - shared);
}
