import "server-only";

import fs from "node:fs";
import path from "node:path";

import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

import { SLIDE_BENCH_CASES, slidePrompt, type SlideBenchCase } from "./cases";
import { SLIDE_BENCH_MODELS } from "./models";
import { consistencyFor, latestRuns, type SlideBenchRun } from "./store";

/**
 * THE REPORT.
 *
 * Written for someone who was not in the room while the bench ran and has to decide which model to
 * ship — so it leads with methodology and the limits of the measurement, not with a winner. A table
 * of scores with no statement of how they were produced invites exactly the wrong kind of
 * confidence, and several numbers here deserve caveats: the vision judge abstains on abstract
 * subjects, a provider outage is not a bad drawing, and a single run per cell cannot separate a
 * model's median from its luck.
 */

const HEAD = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) =>
  new Paragraph({ text, heading: level, spacing: { before: 280, after: 140 } });

const P = (text: string, opts: { italic?: boolean; bold?: boolean } = {}) =>
  new Paragraph({
    children: [new TextRun({ text, italics: opts.italic, bold: opts.bold, size: 20 })],
    spacing: { after: 120 },
  });

const cell = (text: string, opts: { bold?: boolean } = {}) =>
  new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: opts.bold, size: 18 })] })],
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
  });

function table(header: string[], rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: header.map((text) => cell(text, { bold: true })), tableHeader: true }),
      ...rows.map((row) => new TableRow({ children: row.map((text) => cell(text)) })),
    ],
  });
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const money = (usd: number) => `$${usd.toFixed(usd < 0.01 ? 5 : 4)}`;

/**
 * THE BOARDS, AS PICTURES.
 *
 * A table of scores is not evidence that a board is good — this repo's own history is that the
 * numbers have been wrong and the pictures have not (see scripts/compare-animation-models.mjs).
 * The screenshots are what let a reader disagree with the scoring, which is the whole reason to
 * include them: the heart case shows GPT-4o mini scoring 34 beside a board that visibly is not a
 * heart, and that agreement between number and picture is the claim being made.
 *
 * Silently skipped when absent, because a missing screenshot must not cost anyone their report.
 * Regenerate them with `node scripts/shoot-slide-bench.mjs bench-screenshots`.
 */
const SHOT_DIR = path.resolve(process.cwd(), "bench-screenshots");

function screenshotsForReport(): Array<{ caption: string; data: Buffer }> {
  try {
    if (!fs.existsSync(SHOT_DIR)) return [];
    return fs
      .readdirSync(SHOT_DIR)
      .filter((name) => name.startsWith("case-") && name.endsWith(".png"))
      .sort()
      .map((name) => {
        const caption = name
          .replace(/^case-\d+-/, "")
          .replace(/\.png$/, "")
          .replace(/-/g, " ")
          .replace(/abst$/, "(abstract)");
        return { caption, data: fs.readFileSync(path.join(SHOT_DIR, name)) };
      });
  } catch {
    return [];
  }
}

/**
 * Per-model aggregates across the whole bench, not just one case.
 *
 * Provider failures are excluded from every quality average and counted in their own column — a
 * model that could not be reached has not drawn a bad board, and averaging a zero in for it would
 * quietly slander it. The same separation `scripts/compare-animation-models.mjs` makes.
 */
function aggregate(runs: SlideBenchRun[]) {
  return SLIDE_BENCH_MODELS.map((model) => {
    const mine = runs.filter((run) => run.modelId === model.id);
    const reached = mine.filter((run) => !run.providerError);
    const compiled = reached.filter((run) => run.scores.compiles);
    const mean = (values: number[]) =>
      values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const visionScores = reached
      .map((run) => run.visionScore)
      .filter((score): score is number => typeof score === "number");
    const stat = consistencyFor(runs, model.id);
    return {
      model,
      attempts: mine.length,
      providerFailures: mine.length - reached.length,
      compiled: compiled.length,
      meanComposite: mean(reached.map((run) => run.composite)),
      meanVision: mean(visionScores),
      meanLatencyMs: mean(reached.map((run) => run.latencyMs)),
      meanCost: mean(reached.map((run) => run.costUsd)),
      totalCost: mine.reduce((sum, run) => sum + run.costUsd, 0),
      meanAnimatedValues: mean(compiled.map((run) => run.scores.progressDrivenValues)),
      meanLabels: mean(compiled.map((run) => run.scores.labelCount)),
      thinkingShare: mean(
        reached.map((run) => (run.outputTokens > 0 ? run.thinkingTokens / run.outputTokens : 0)),
      ),
      stdDev: stat.stdDev,
      truncations: mine.filter((run) => run.scores.likelyTruncated).length,
      fenced: mine.filter((run) => run.scores.hadCodeFences).length,
    };
  });
}

/** Per-model prose, derived from that model's own rows rather than written by hand. */
function observationsFor(row: ReturnType<typeof aggregate>[number], runs: SlideBenchRun[]): string[] {
  const notes: string[] = [];
  const mine = runs.filter((run) => run.modelId === row.model.id);

  if (row.attempts === 0) return ["Not run."];
  if (row.providerFailures > 0) {
    notes.push(
      `${row.providerFailures} of ${row.attempts} attempts never reached the provider (overload or rate limit). These are excluded from the quality averages — an unreachable model has not drawn a bad board.`,
    );
  }
  if (row.compiled < row.attempts - row.providerFailures) {
    const broken = mine.filter((run) => !run.providerError && !run.scores.compiles);
    const reasons = [...new Set(broken.flatMap((run) => run.scores.issues))].slice(0, 3);
    notes.push(`${broken.length} response(s) did not meet the contract. Reasons seen: ${reasons.join("; ")}.`);
  }
  if (row.truncations > 0) {
    notes.push(
      `${row.truncations} response(s) hit the output ceiling. That is a budget finding, not a quality one — the component was cut off mid-write.`,
    );
  }
  if (row.fenced > 0) {
    notes.push(`${row.fenced} response(s) arrived wrapped in markdown fences despite the instruction not to.`);
  }
  if ((row.thinkingShare ?? 0) > 0.3) {
    notes.push(
      `Spends ${Math.round((row.thinkingShare ?? 0) * 100)}% of its output budget on hidden reasoning tokens, which are billed as output — the reason its cost per slide is higher than its headline price suggests.`,
    );
  }
  if (row.stdDev !== null && row.stdDev > 15) {
    notes.push(
      `Inconsistent: composite scores vary by ±${row.stdDev.toFixed(1)} across runs, so a single good result should not be trusted as typical.`,
    );
  } else if (row.stdDev !== null) {
    notes.push(`Consistent across runs (±${row.stdDev.toFixed(1)} composite).`);
  }
  if (row.meanVision !== null) {
    notes.push(
      `Mean shape-recognisability ${row.meanVision.toFixed(1)}/5 from the independent vision judge on physical subjects.`,
    );
  }
  return notes.length ? notes : ["No notable issues."];
}

export async function buildSlideBenchReport(allRuns: SlideBenchRun[]): Promise<Buffer> {
  const latest = latestRuns(allRuns);
  const rows = aggregate(latest);
  const caseIds = [...new Set(allRuns.map((run) => run.caseId))];
  const casesUsed: SlideBenchCase[] = caseIds
    .map((id) => SLIDE_BENCH_CASES.find((entry) => entry.id === id) ?? null)
    .filter((entry): entry is SlideBenchCase => entry !== null);
  const totalSpend = allRuns.reduce((sum, run) => sum + run.costUsd, 0);

  const ranked = [...rows]
    .filter((row) => row.meanComposite !== null)
    .sort((a, b) => (b.meanComposite ?? 0) - (a.meanComposite ?? 0));

  const children: (Paragraph | Table)[] = [
    new Paragraph({
      children: [new TextRun({ text: "Slide generation: model comparison", bold: true, size: 40 })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 120 },
    }),
    P(
      `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${allRuns.length} recorded runs across ${rows.length} models and ${casesUsed.length || caseIds.length} test cases · total spend ${money(totalSpend)}.`,
      { italic: true },
    ),

    HEAD("1. What was measured, and how", HeadingLevel.HEADING_1),
    P(
      "Each model was asked to write one self-contained React component that teaches a single idea as an animated lecture slide. Every model received a byte-identical prompt for a given test case — the prompt is generated by one function with no per-provider wording, so any difference in the results is a difference between models rather than between prompts.",
    ),
    P(
      "Each returned component was then judged on two independent tracks. The first is deterministic and runs without a model: does it parse, does it export the expected component, does it drive its motion from the caller's clock rather than a timer of its own, does it label its parts. These checks are reproducible — the same code scores the same tomorrow.",
    ),
    P(
      "The second track is an independent vision judge: the component is rendered to a static frame and a fixed vision model is asked whether the drawing is recognisable as the subject, scoring 1-5. The judge is the same for every contestant and is never one of the contestants, so no model grades its own work.",
    ),

    HEAD("Limits of these numbers", HeadingLevel.HEADING_2),
    P(
      "· The vision judge is only shown PHYSICAL subjects. It condemns an abstract board — a timeline, a search tree — for not looking like an object, so abstract cases are deliberately left unjudged on that axis and are marked 'n/a' rather than scored zero.",
    ),
    P(
      "· A provider failure is not a bad slide. Runs that never reached the provider are counted in their own column and excluded from every quality average.",
    ),
    P(
      "· 'Animation smoothness' is inferred from source, not from watching. The count of distinct progress-driven values says whether parts move independently; it cannot say whether the result is beautiful. Judge that by scrubbing the boards side by side in the bench UI.",
    ),
    P(
      "· Where a model has only one run for a case, its score is a sample, not a median. The consistency column is the honest guide to how much weight a single number deserves.",
    ),

    HEAD("2. Test cases", HeadingLevel.HEADING_1),
  ];

  for (const testCase of casesUsed) {
    children.push(HEAD(testCase.title, HeadingLevel.HEADING_2));
    children.push(P(`Teaching point: ${testCase.teachingPoint}`));
    children.push(P(`Why this case: ${testCase.rationale}`, { italic: true }));
    children.push(
      P(`Judged by the vision critic: ${testCase.physical ? "yes (physical subject)" : "no (abstract subject)"}`),
    );
  }

  if (casesUsed.length) {
    children.push(HEAD("The exact prompt", HeadingLevel.HEADING_2));
    children.push(
      P("Reproduced verbatim for the first case. Only the title, teaching point and narration differ between cases."),
    );
    for (const line of slidePrompt(casesUsed[0]).split("\n")) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: line || " ", font: "Consolas", size: 16 })],
          spacing: { after: 0 },
        }),
      );
    }
  }

  children.push(
    HEAD("3. Results", HeadingLevel.HEADING_1),
    P("One row per model, averaged over its runs. Sorted by mean composite score."),
    table(
      ["Model", "Score", "Vision", "Compiled", "Latency", "Cost/slide", "Consistency", "Failures"],
      rows
        .slice()
        .sort((a, b) => (b.meanComposite ?? -1) - (a.meanComposite ?? -1))
        .map((row) => [
          row.model.label,
          row.meanComposite === null ? "—" : row.meanComposite.toFixed(0),
          row.meanVision === null ? "n/a" : `${row.meanVision.toFixed(1)}/5`,
          `${row.compiled}/${row.attempts - row.providerFailures}`,
          row.meanLatencyMs === null ? "—" : seconds(row.meanLatencyMs),
          row.meanCost === null ? "—" : money(row.meanCost),
          row.stdDev === null ? "single run" : `±${row.stdDev.toFixed(1)}`,
          String(row.providerFailures),
        ]),
    ),
  );

  /*
   * AVAILABILITY BEFORE QUALITY. A model that could not be reached has no quality result, and
   * printing its blank row without saying why invites the reader to conclude it failed the test.
   */
  const blocked = rows.filter((row) => row.providerFailures > 0);
  if (blocked.length) {
    children.push(
      HEAD("3b. Models that could not be measured", HeadingLevel.HEADING_1),
      P(
        "These rows are blank because the request never reached the model, not because the model drew badly. Nothing about their quality can be read from this report.",
      ),
      table(
        ["Model", "Attempts", "Never reached", "What the provider said"],
        blocked.map((row) => {
          const example = allRuns.find((run) => run.modelId === row.model.id && run.providerError);
          return [
            row.model.label,
            String(row.attempts),
            String(row.providerFailures),
            (example?.providerError ?? "").slice(0, 120),
          ];
        }),
      ),
      HEAD("Why Gemini 3.8 Flash has no results", HeadingLevel.HEADING_2),
      P(
        "The API key used for the Gemini models is on Google's free tier, which allows 20 requests per day per model (quota GenerateRequestsPerDayPerProjectPerModel-FreeTier). That allowance was exhausted during this bench, so gemini-3.8-flash could not be measured at all.",
      ),
      P(
        "Two things made this hard to see, and both are worth knowing before reading any Gemini row here. First, the harness retried each failed attempt three times, so nine recorded attempts spent roughly twenty-seven requests — the retry logic intended to survive a transient outage is what consumed the daily allowance. That has since been changed: a quota error is no longer retried, because retrying it spends more of the budget that just ran out.",
      ),
      P(
        "Second, once the cap trips the failures do not look like a quota. A very small prompt still succeeds, while any real slide-sized request returns 503 'this model is currently experiencing high demand' — so the model appears intermittently broken rather than rate-limited. The reliable diagnosis is the structured error detail (error.details[].violations[].quotaId), not the message.",
      ),
      P(
        "To measure Gemini 3.8 Flash properly, billing must be enabled on the Google AI Studio project; the free allowance also resets daily, which is enough for a single case but not a full sweep. Until then, treat its absence here as unmeasured, not as a result.",
        { bold: true },
      ),
    );
  }

  const shots = screenshotsForReport();
  if (shots.length) {
    children.push(
      HEAD("4. The boards, side by side", HeadingLevel.HEADING_1),
      P(
        "One screenshot per test case, every model's board rendered live in the production sandbox at the same point on the clock. These are included so the scoring can be argued with: in the heart case, the model scoring 34 is visibly not drawing a heart, and the models scoring 98 are. Where a number and a picture disagree, trust the picture.",
      ),
    );
    for (const shot of shots) {
      children.push(P(shot.caption, { bold: true }));
      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: shot.data,
              // 1600x1250 source, scaled to fit a portrait page with margins.
              transformation: { width: 600, height: 469 },
              type: "png",
            }),
          ],
          spacing: { after: 240 },
        }),
      );
    }
  }

  children.push(
    HEAD("5. Cost", HeadingLevel.HEADING_1),
    P(
      "Cost is computed from each provider's own reported token usage at that model's list price. Gemini bills hidden 'thinking' tokens as output, so they are included — a model that reasons at length is not cheap merely because its answer is short.",
    ),
    table(
      ["Model", "Provider", "API key", "Mean cost", "Total spent", "Thinking share"],
      rows.map((row) => [
        row.model.label,
        row.model.provider,
        row.model.apiKeyEnv,
        row.meanCost === null ? "—" : money(row.meanCost),
        money(row.totalCost),
        row.thinkingShare === null ? "—" : `${Math.round(row.thinkingShare * 100)}%`,
      ]),
    ),
  );

  children.push(HEAD("6. Per-model observations", HeadingLevel.HEADING_1));
  for (const row of rows) {
    children.push(HEAD(row.model.label, HeadingLevel.HEADING_2));
    children.push(P(row.model.note, { italic: true }));
    for (const note of observationsFor(row, allRuns)) children.push(P(`· ${note}`));
  }

  children.push(
    HEAD("7. Every run", HeadingLevel.HEADING_1),
    P(
      "The full log, newest per case/model pair. 'Key' is the environment variable that held the credential plus a non-reversible fingerprint, so two keys can be told apart without the key appearing in this document.",
    ),
    table(
      ["Case", "Model", "Score", "Latency", "In→Out tok", "Cost", "Key", "Notes"],
      latest.map((run) => [
        run.caseTitle,
        run.modelLabel,
        run.providerError ? "error" : String(run.composite),
        seconds(run.latencyMs),
        `${run.promptTokens}→${run.outputTokens}`,
        money(run.costUsd),
        run.apiKeyId,
        run.providerError
          ? run.providerError.slice(0, 80)
          : run.scores.issues[0] ?? (run.visionNote ?? "clean"),
      ]),
    ),
  );

  if (ranked.length) {
    children.push(
      HEAD("8. Conclusion", HeadingLevel.HEADING_1),
      P(
        `On this evidence ${ranked[0].model.label} leads on mean composite score (${ranked[0].meanComposite?.toFixed(0)}/100)${
          ranked[1] ? `, ahead of ${ranked[1].model.label} (${ranked[1].meanComposite?.toFixed(0)})` : ""
        }.`,
      ),
      P(
        "Read that alongside the cost and consistency columns rather than on its own: the cheapest model that clears the quality bar is usually the right production choice, and a model whose scores swing widely between runs is a risk that a single average conceals. Where two models are within a few points, this bench cannot separate them — that needs more runs per cell, which the UI supports by rerunning individual models.",
      ),
    );
  }

  return Packer.toBuffer(new Document({ sections: [{ children }] })) as unknown as Promise<Buffer>;
}
