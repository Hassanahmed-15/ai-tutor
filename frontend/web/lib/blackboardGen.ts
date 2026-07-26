import OpenAI from "openai";
import type { Beat } from "./lessonContent";
import { BLACKBOARD_SYSTEM_PROMPT } from "./drawPrompt";
import {
  getBlackboardDiagnostics,
  sanitizeChalkBoardOps,
  type BlackboardDiagnostics,
  type ChalkBoardOp,
} from "./drawSanitize";
import { splitNarrationSentences } from "./voice";
import { critiqueBoard, boardVisionCriticEnabled } from "./boardVisionCritic";
import type { DrawScript } from "@/components/sketch/LiveSketch";

type DrawOp = DrawScript["ops"][number];

/**
 * Second step of the two-step pipeline for BLACKBOARD beats, mirroring reactAnimationGen.ts.
 * Takes beats whose DrawScript has a `{ kind:"chalkBoard", boardBrief }` placeholder (written by
 * the text model in step 1, no `ops` yet) and calls the configured model once per beat, in
 * parallel, to author the real chalk board as JSON `{ ops: DrawOp[] }` — a heading, real content
 * rows, and a content-specific chalk diagram.
 *
 * NARRATION SYNC: the beat script is split into sentences with the SAME splitter the client uses
 * (splitNarrationSentences). The model tags each op with a `group` = the sentence it supports; we
 * then quantize `op.at = (group+1)/sentenceCount` server-side so each chunk is written exactly as
 * its sentence is spoken (the client sets drawProgress = (sentenceIndex+1)/total).
 *
 * On failure after all retries, `ops` is left unset with `status:"failed"` → the client shows a
 * clean preparing/unavailable card (no legacy template board in the normal flow).
 */

const MODEL = process.env.OPENAI_BLACKBOARD_MODEL ?? process.env.OPENAI_LECTURE_MODEL ?? "gpt-4o";
const MAX_TOKENS = Math.max(2_000, Math.min(8_000, Number(process.env.OPENAI_BLACKBOARD_MAX_TOKENS ?? 4_000)));
const MAX_ATTEMPTS = Math.max(1, Math.min(6, Number(process.env.OPENAI_BLACKBOARD_ATTEMPTS ?? 4)));

// Cost estimate uses the same gpt-4o-era rates as generate-lecture; override models may differ.
const INPUT_PRICE = 2.5 / 1_000_000;
const OUTPUT_PRICE = 10.0 / 1_000_000;

export type BlackboardFillStats = {
  costUsd: number;
  pending: number;
  filled: number;
  rejected: number;
  issues: string[];
};

export type BlackboardFillUpdate = {
  beat: Beat;
  beatIndex: number;
  costUsd: number;
  status: "ready" | "failed";
};

function costUsd(usage: OpenAI.Chat.Completions.ChatCompletion["usage"] | undefined): number {
  return usage ? usage.prompt_tokens * INPUT_PRICE + usage.completion_tokens * OUTPUT_PRICE : 0;
}

function buildUserPrompt(op: ChalkBoardOp, beat: Beat, sentences: string[], previousIssue?: string): string {
  const numbered = sentences.map((s, i) => `[${i}] ${s}`).join("\n");
  const parts = [
    `Beat title: ${beat.title}`,
    `Board brief (what this chalk board must teach): ${op.boardBrief ?? beat.title}`,
    `Spoken script, split into numbered sentences (tag each op's "group" with the sentence index it supports):`,
    numbered || "[0] " + beat.script,
    `There are ${Math.max(1, sentences.length)} sentences (groups 0..${Math.max(0, sentences.length - 1)}).`,
    previousIssue
      ? previousIssue.includes("overlap")
        ? `The previous attempt was rejected because: ${previousIssue}. Re-space the rows: stack them strictly top-to-bottom with at least 9 grid units of vertical gap between consecutive rows, and never put two pieces of text at the same y. Keep the content; only fix the spacing.`
        : `The previous attempt was rejected because: ${previousIssue}. Fix exactly that — keep it a clean, well-spaced, TEXT-ONLY chalk board with a heading and real content rows. No diagrams or shapes.`
      : `Author the board now: a heading plus 4-6 real content rows grounded in the script. The narration is intentionally deep and may be long; select only its pivotal claims instead of turning every sentence into a row. TEXT ONLY — no diagrams, shapes, or arrows. Stack rows top-to-bottom with clear vertical gaps, no overlap, everything inside the frame.`,
  ];
  return parts.join("\n\n");
}

/** Reads the model's `group` tag off each raw op and rewrites `at` to a sentence-aligned reveal
 *  fraction. An op in group g begins just after g/N, while sentence g is being spoken. Ops with
 *  no/invalid group fall back to their own `at`
 *  or the last group. Mutates a shallow copy of each raw op before sanitize. */
function quantizeAtToSentences(rawOps: unknown, sentenceCount: number): unknown[] {
  if (!Array.isArray(rawOps)) return [];
  const n = Math.max(1, sentenceCount);
  return rawOps.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const o = { ...(raw as Record<string, unknown>) };
    const g = typeof o.group === "number" ? o.group : Number(o.group);
    if (Number.isFinite(g)) {
      const group = Math.max(0, Math.min(n - 1, Math.floor(g)));
      o.at = Math.min(0.98, group / n + 0.004);
    }
    return o;
  });
}

// Grounding critic (the multi-agent verifier): a cheap check that the board's written claims are
// supported by the beat's own source (script + boardBrief). Rejected boards are regenerated via the
// existing retry loop with the critic's reason. On by default for quality; disable with GROUNDING_CHECK=0.
// Gated by `hasSourceDocument` at the call site — a plain topic-based lecture has nothing external
// to ground against, so this (and the vision critic) only ever run for uploaded-source lectures.
const GROUNDING_CHECK = process.env.GROUNDING_CHECK !== "0";
const VERIFIER_MODEL = process.env.OPENAI_VERIFIER_MODEL ?? "gpt-4o-mini";

async function checkGrounding(
  client: OpenAI,
  ops: DrawOp[],
  beat: Beat,
  op: ChalkBoardOp,
): Promise<{ costUsd: number; ok: boolean; issue?: string }> {
  const boardText = ops
    .map((o) => ("text" in o && typeof o.text === "string" ? o.text : ""))
    .filter(Boolean)
    .join(" | ");
  if (!boardText) return { costUsd: 0, ok: true };
  const source = `${op.boardBrief ?? ""}\n${beat.script}`.trim();
  try {
    const completion = await client.chat.completions.create({
      model: VERIFIER_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You verify that a teaching board is grounded in its source notes. Reply JSON only: " +
            '{ "grounded": boolean, "issue": string }. Set grounded=false ONLY if the board states a ' +
            "specific fact, number, term, or claim that is NOT supported by the source notes (a " +
            "hallucination), or is off-topic. General teaching phrasing is fine. If grounded=false, " +
            '"issue" names the exact unsupported item to remove/fix. Otherwise "issue" is "".',
        },
        { role: "user", content: `SOURCE NOTES:\n${source}\n\nBOARD LINES:\n${boardText}` },
      ],
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });
    const c = costUsd(completion.usage);
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
    const grounded = parsed.grounded !== false;
    const issue = typeof parsed.issue === "string" ? parsed.issue.trim() : "";
    return { costUsd: c, ok: grounded, issue: grounded ? undefined : issue || "a board claim is not supported by the notes" };
  } catch {
    return { costUsd: 0, ok: true }; // never block on the critic itself
  }
}

async function generateOne(
  client: OpenAI,
  op: ChalkBoardOp,
  beat: Beat,
  hasSourceDocument: boolean
): Promise<{ costUsd: number; filled: boolean; issue?: string }> {
  const sentences = splitNarrationSentences(beat.script);
  let totalCostUsd = 0;
  let previousIssue: string | undefined;
  let groundingChecks = 0;
  let visionChecks = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const tokenParam = /^(gpt-5|o[0-9])/.test(MODEL)
        ? { max_completion_tokens: MAX_TOKENS }
        : { max_tokens: MAX_TOKENS };
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: BLACKBOARD_SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(op, beat, sentences, previousIssue) },
        ],
        temperature: attempt === 0 ? 0.5 : Math.min(0.9, 0.5 + attempt * 0.2),
        response_format: { type: "json_object" },
        ...tokenParam,
      });
      totalCostUsd += costUsd(completion.usage);

      const raw = completion.choices[0]?.message?.content ?? "{}";
      let parsedOps: unknown = [];
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        parsedOps = Array.isArray(parsed.ops) ? parsed.ops : [];
      } catch {
        previousIssue = "output was not valid JSON — return exactly { \"ops\": [...] }";
        continue;
      }

      const quantized = quantizeAtToSentences(parsedOps, sentences.length);
      const ops = sanitizeChalkBoardOps(quantized);
      const diagnostics: BlackboardDiagnostics = getBlackboardDiagnostics(ops);
      console.error(
        `[board] beat=${beat.id} attempt=${attempt} ops=${ops.length} labels=${diagnostics.labelCount} notes=${diagnostics.noteCount} diagram=${diagnostics.diagramCount} issue=${diagnostics.issue ?? "OK"}`
      );
      if (diagnostics.issue) {
        previousIssue = diagnostics.issue;
        continue;
      }

      // Grounding critic: verify the board's claims trace to the source before accepting it. Run at
      // most twice per beat (cost guard); on a hallucination, retry with the critic's reason. Only
      // for uploaded-source lectures — a topic-based lecture has no external source to ground on.
      if (hasSourceDocument && GROUNDING_CHECK && groundingChecks < 2) {
        groundingChecks++;
        const verdict = await checkGrounding(client, ops, beat, op);
        totalCostUsd += verdict.costUsd;
        if (!verdict.ok && verdict.issue) {
          console.error(`[board] beat=${beat.id} grounding rejected: ${verdict.issue}`);
          previousIssue = `Not grounded in the notes: ${verdict.issue}. Only write claims supported by the source; remove or correct that item.`;
          continue;
        }
      }

      // Vision critic (Clarix idea): render the finished board and let a vision model reject
      // overlaps/clipping/illegibility. Set op.ops so the serializer sees the real board; on
      // reject, clear + retry with the critic's concrete issue. Capped at 1 vision call/beat.
      // Only for uploaded-source lectures, same reasoning as the grounding critic above.
      if (hasSourceDocument && boardVisionCriticEnabled() && visionChecks < 1) {
        visionChecks++;
        op.ops = ops;
        const v = await critiqueBoard(client, beat);
        totalCostUsd += v.costUsd;
        if (!v.ok && v.issue) {
          op.ops = undefined;
          previousIssue = `The rendered board has a layout problem: ${v.issue}. Fix ONLY the spacing/layout — keep every op on its own line, stacked top-to-bottom with clear gaps, nothing overlapping or off the frame.`;
          continue;
        }
      }

      op.ops = ops;
      op.status = "ready";
      op.error = undefined;
      return { costUsd: totalCostUsd, filled: true };
    } catch (err) {
      previousIssue = err instanceof Error ? err.message : "generation failed";
    }
  }

  op.ops = undefined;
  op.status = "failed";
  op.error = previousIssue ?? "blackboard was not generated";
  console.error(`[board] beat=${beat.id} GAVE UP after ${MAX_ATTEMPTS} attempts. final issue: ${op.error}`);
  return { costUsd: totalCostUsd, filled: false, issue: op.error };
}

function findChalkBoardOp(draw: DrawScript | undefined): ChalkBoardOp | undefined {
  return draw?.ops.find((o): o is ChalkBoardOp => o.kind === "chalkBoard");
}

export async function fillBlackboardOps(client: OpenAI, beats: Beat[], hasSourceDocument = false): Promise<BlackboardFillStats> {
  return fillBlackboardOpsIncremental(client, beats, undefined, {}, hasSourceDocument);
}

export async function fillBlackboardOpsIncremental(
  client: OpenAI,
  beats: Beat[],
  onUpdate?: (update: BlackboardFillUpdate) => void | Promise<void>,
  options: { limit?: number } = {},
  // Gates the grounding + vision critics (see checkGrounding/critiqueBoard above) — only lectures
  // built from an uploaded source document (PPTX/Suprnotes-JSON/task-folder) get critiqued; plain
  // topic-based lectures are unaffected even when blackboard generation is enabled.
  hasSourceDocument = false
): Promise<BlackboardFillStats> {
  const pending: Array<{ op: ChalkBoardOp; beat: Beat; beatIndex: number }> = [];
  for (let beatIndex = 0; beatIndex < beats.length; beatIndex++) {
    const beat = beats[beatIndex];
    const op = findChalkBoardOp(beat.draw);
    if (op && !op.ops && op.status !== "failed") {
      pending.push({ op, beat, beatIndex });
    }
  }
  const selected = typeof options.limit === "number" ? pending.slice(0, Math.max(0, options.limit)) : pending;
  if (selected.length === 0) {
    return { costUsd: 0, pending: 0, filled: 0, rejected: 0, issues: [] };
  }

  const results = await Promise.all(
    selected.map(async ({ op, beat, beatIndex }) => {
      const result = await generateOne(client, op, beat, hasSourceDocument);
      await onUpdate?.({ beat, beatIndex, costUsd: result.costUsd, status: result.filled ? "ready" : "failed" });
      return result;
    })
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
