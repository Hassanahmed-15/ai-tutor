import crypto from "node:crypto";

import { NextResponse } from "next/server";
import OpenAI from "openai";

import { SLIDE_BENCH_CASES, slidePrompt, type SlideBenchCase } from "@/lib/slidebench/cases";
import { SLIDE_BENCH_MODELS, slideBenchModel } from "@/lib/slidebench/models";
import { generateSlide } from "@/lib/slidebench/providers";
import { compositeScore, scoreSlideSource, stripCodeFences } from "@/lib/slidebench/scoring";
import { readSlideBenchRuns, recordSlideBenchRun, type SlideBenchRun } from "@/lib/slidebench/store";
import { critiqueShapeRecognizability } from "@/lib/reactAnimationVisionCritic";
import type { Beat } from "@/lib/lessonContent";

/**
 * The bench runner.
 *
 * DEV ONLY, exactly like /api/sandbox-board. This route spends real money on several providers at
 * once with no auth in front of it; exposing that in production would be an open wallet. Same gate,
 * same reason.
 *
 * GET  → every recorded run, for the grid.
 * POST → run one (case, model) pair, or a whole sweep, and record each result.
 */

export const maxDuration = 300;

function devOnly(): NextResponse | null {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production." }, { status: 404 });
  }
  return null;
}

export async function GET() {
  const blocked = devOnly();
  if (blocked) return blocked;
  return NextResponse.json({
    runs: readSlideBenchRuns(),
    models: SLIDE_BENCH_MODELS,
    cases: SLIDE_BENCH_CASES,
  });
}

export async function POST(request: Request) {
  const blocked = devOnly();
  if (blocked) return blocked;

  const body = await request.json().catch(() => ({}));
  /*
   * 16k by default, not 8k.
   *
   * Measured while building this: Gemini 3.5 Flash spent 7,677 of an 8,000-token budget on hidden
   * thinking and had roughly 300 left to write the component, which arrived truncated mid-brace.
   * An 8k ceiling therefore measures the CEILING for reasoning models, not the model. Every
   * contestant gets the same larger budget, so the comparison stays fair and a model that chooses
   * to spend it on thinking pays for those tokens in the cost column.
   */
  const maxTokens = Math.max(1_000, Math.min(32_000, Number(body.maxTokens ?? 16_000)));

  /*
   * A custom case is accepted inline rather than requiring a code change, which is what "add new
   * test cases" means in practice. It is validated and clamped like any other request body — this
   * text becomes a prompt sent to six paid providers.
   */
  const customCase: SlideBenchCase | null = body.customCase
    ? {
        id: String(body.customCase.id ?? `custom-${Date.now()}`).slice(0, 60),
        title: String(body.customCase.title ?? "Untitled").slice(0, 200),
        teachingPoint: String(body.customCase.teachingPoint ?? "").slice(0, 600),
        script: String(body.customCase.script ?? "").slice(0, 2_000),
        physical: body.customCase.physical !== false,
        rationale: String(body.customCase.rationale ?? "Added from the bench UI.").slice(0, 300),
      }
    : null;

  if (customCase && !customCase.teachingPoint.trim()) {
    return NextResponse.json({ error: "A custom case needs a teachingPoint." }, { status: 400 });
  }

  const testCase = customCase ?? SLIDE_BENCH_CASES.find((entry) => entry.id === body.caseId);
  if (!testCase) return NextResponse.json({ error: "Unknown caseId." }, { status: 400 });

  const modelIds: string[] = Array.isArray(body.modelIds) && body.modelIds.length
    ? body.modelIds.map(String)
    : SLIDE_BENCH_MODELS.map((model) => model.id);

  const models = modelIds.map(slideBenchModel).filter((model): model is NonNullable<typeof model> => model !== null);
  if (!models.length) return NextResponse.json({ error: "No known models requested." }, { status: 400 });

  const prompt = slidePrompt(testCase);
  const promptSha = crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 12);
  const runId = `run-${Date.now().toString(36)}`;

  /*
   * All contestants in parallel. They are independent network calls to (mostly) different
   * providers, so running them serially would multiply wall-clock for no benefit — and the latency
   * column stays honest because each result carries its own measured duration, not a share of the
   * total.
   */
  const runs = await Promise.all(
    models.map(async (model): Promise<SlideBenchRun> => {
      const generated = await generateSlide(model, prompt, maxTokens);
      const { hadFences } = stripCodeFences(generated.code);
      const scores = scoreSlideSource(generated.code, hadFences, {
        outputTokens: generated.outputTokens,
        maxTokens,
      });

      /*
       * THE SAME JUDGE FOR EVERY CONTESTANT — the production shape critic, pinned to its own fixed
       * vision model and never rotated. A bench that let each model grade itself would measure
       * self-confidence. Abstract cases are deliberately not shown to it (it condemns a timeline
       * for not looking like an object), and `null` there means "not judged", not "failed".
       */
      let visionScore: number | null = null;
      let visionNote: string | null = null;
      if (testCase.physical && scores.compiles && process.env.OPENAI_API_KEY) {
        try {
          const beat: Beat = {
            id: `bench-${testCase.id}`,
            title: testCase.title,
            teacherMove: testCase.teachingPoint,
            points: [testCase.teachingPoint],
            script: testCase.script,
          } as Beat;
          const critique = await critiqueShapeRecognizability(
            new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
            beat,
            generated.code,
            testCase.title,
          );
          visionScore = critique.score;
          visionNote = critique.issue ?? null;
        } catch (cause) {
          visionNote = `Judge unavailable: ${cause instanceof Error ? cause.message : String(cause)}`;
        }
      } else if (!testCase.physical) {
        visionNote = "Abstract subject — not shown to the shape critic by design.";
      }

      const run: SlideBenchRun = {
        runId,
        at: new Date().toISOString(),
        caseId: testCase.id,
        caseTitle: testCase.title,
        modelId: model.id,
        modelLabel: model.label,
        provider: model.provider,
        apiKeyId: generated.apiKeyId,
        settings: { maxTokens, promptChars: prompt.length, promptSha },
        latencyMs: generated.latencyMs,
        promptTokens: generated.promptTokens,
        outputTokens: generated.outputTokens,
        thinkingTokens: generated.thinkingTokens,
        costUsd: generated.costUsd,
        providerError: generated.providerError,
        scores,
        visionScore,
        visionNote,
        composite: generated.providerError ? 0 : compositeScore(scores, visionScore),
        code: generated.code,
      };
      recordSlideBenchRun(run);
      return run;
    }),
  );

  return NextResponse.json({ runId, promptSha, prompt, runs });
}
