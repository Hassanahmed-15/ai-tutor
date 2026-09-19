/**
 * THE DETERMINISTIC HALF OF THE VERDICT.
 *
 * Everything here is computed from the generated source without a model and without a network
 * call, which matters for two reasons. It is reproducible — the same code scores the same tomorrow,
 * so a rerun measures the model rather than the judge's mood. And it is free, so it can be applied
 * to every run rather than a sample.
 *
 * This deliberately does NOT try to judge whether the picture looks like the thing. No static
 * analysis can do that; it takes a vision model looking at a rendered frame, which is what
 * lib/reactAnimationVisionCritic.ts already does and what the runner uses for the quality score.
 * What is checkable here is whether the code obeys the contract it was given — and the history of
 * this repo is that contract violations are the common failure, not ugly drawings: a component
 * that ignores `progress` renders a still image, and a fenced response does not parse at all.
 */

export interface StaticSlideScores {
  /** Does it parse and expose the expected component shape at all? */
  compiles: boolean;
  /**
   * Did the answer stop because it hit the token ceiling rather than because it was finished?
   *
   * Measured: Gemini 3.5 Flash spent 7,677 of its 8,000 output tokens on hidden thinking and had
   * ~300 left for the component, which arrived with unbalanced braces. Reporting that as "writes
   * broken code" would be a lie about the model — it is a finding about the BUDGET. The report says
   * truncated, and the runner raises the ceiling for reasoning models.
   */
  likelyTruncated: boolean;
  /** Reasons it was judged not to compile / not to conform. Shown verbatim in the report. */
  issues: string[];
  /**
   * ANIMATION SMOOTHNESS, as far as source can reveal it.
   *
   * Counts distinct interpolations driven by `progress`. A board with one is a slide that fades in;
   * a board with a dozen has parts that move independently, which is what makes an animation read
   * as an explanation rather than a reveal. Not a quality score — a richness one.
   */
  progressDrivenValues: number;
  /** Uses of the clock the contract forbids: timers, effects, state. Each one is a correctness bug. */
  forbiddenClockUses: string[];
  /** <text> labels. The contract requires parts be named; zero labels is a content failure. */
  labelCount: number;
  /** Distinct SVG primitives — a proxy for visual richness, not for beauty. */
  shapeVariety: number;
  /** Did the model wrap its answer in markdown despite being told not to? */
  hadCodeFences: boolean;
  /** Rough size, for the "did it pad" observation. */
  sourceChars: number;
}

/**
 * Models sometimes wrap code in markdown despite being told not to. Stripping it is not leniency —
 * an unstripped fence is a syntax error, and scoring a model 0 for formatting when the component
 * underneath is fine would be measuring instruction-following in the quality column, where it does
 * not belong. Fence compliance is reported separately, as its own observation.
 *
 * Lives here rather than beside the providers that call it because providers.ts imports
 * "server-only" and cannot be loaded by the CommonJS test build — the same reason
 * lib/beatSourceScope.ts is separate from the progressive worker.
 */
export function stripCodeFences(raw: string): { code: string; hadFences: boolean } {
  const trimmed = (raw ?? "").trim();
  const fence = /^```(?:jsx?|tsx?|javascript|typescript)?\s*\n([\s\S]*?)\n?```$/;
  const match = trimmed.match(fence);
  if (match) return { code: match[1].trim(), hadFences: true };
  return { code: trimmed, hadFences: false };
}

const FORBIDDEN = [
  { pattern: /\buseState\s*\(/, label: "useState" },
  { pattern: /\buseEffect\s*\(/, label: "useEffect" },
  { pattern: /\bsetInterval\s*\(/, label: "setInterval" },
  { pattern: /\bsetTimeout\s*\(/, label: "setTimeout" },
  { pattern: /\brequestAnimationFrame\s*\(/, label: "requestAnimationFrame" },
  { pattern: /\bDate\.now\s*\(/, label: "Date.now" },
  { pattern: /\bnew\s+Date\b/, label: "new Date" },
  { pattern: /\bMath\.random\s*\(/, label: "Math.random" },
];

const SVG_PRIMITIVES = [
  "circle", "rect", "path", "line", "ellipse", "polygon", "polyline",
  "text", "g", "defs", "linearGradient", "radialGradient", "filter", "clipPath", "mask",
];

export function scoreSlideSource(
  rawCode: string,
  hadCodeFences: boolean,
  /** Output tokens used and the ceiling they were capped at, when the caller knows them. */
  budget?: { outputTokens: number; maxTokens: number },
): StaticSlideScores {
  // Within 2% of the ceiling means the model was still writing when it was cut off.
  const likelyTruncated = Boolean(budget && budget.outputTokens >= budget.maxTokens * 0.98);
  const code = rawCode ?? "";
  const issues: string[] = [];

  if (!code.trim()) {
    return {
      compiles: false,
      likelyTruncated,
      issues: ["Empty response."],
      progressDrivenValues: 0,
      forbiddenClockUses: [],
      labelCount: 0,
      shapeVariety: 0,
      hadCodeFences,
      sourceChars: 0,
    };
  }

  const hasDefaultExport = /export\s+default\s+function\s+\w*|export\s+default\s+\w+|module\.exports\s*=/.test(code);
  if (!hasDefaultExport) issues.push("No default export — the sandbox cannot mount it.");

  const takesProgress = /\bprogress\b/.test(code);
  if (!takesProgress) issues.push("Never mentions `progress` — the board cannot animate.");

  const hasSvg = /<svg[\s>]/.test(code);
  if (!hasSvg) issues.push("No <svg> element.");

  const hasViewBox = /viewBox\s*=\s*["'{]/.test(code);
  if (!hasViewBox) issues.push("No viewBox — the board will not scale to the stage.");

  /*
   * Balanced delimiters as a cheap syntax check. Not a parser: it cannot see a brace inside a
   * string literal, so it under-reports. That is the right direction to be wrong — it never
   * condemns valid code, it only misses some invalid code, which the sandbox then catches at
   * runtime and reports as a render failure.
   */
  const balanced = (open: string, close: string) =>
    (code.split(open).length - 1) === (code.split(close).length - 1);
  if (!balanced("{", "}")) issues.push("Unbalanced braces.");
  if (!balanced("(", ")")) issues.push("Unbalanced parentheses.");

  const forbiddenClockUses = FORBIDDEN.filter((entry) => entry.pattern.test(code)).map((entry) => entry.label);
  for (const use of forbiddenClockUses) {
    issues.push(`Uses ${use}, which the caller's clock forbids (scrubbing breaks).`);
  }

  /*
   * HOW MANY THINGS MOVE INDEPENDENTLY — counted from staged reveals, not from mentions.
   *
   * The first version of this counted distinct source lines containing `progress`, and it was
   * measurably backwards. GPT-5.6 Sol wrote the richest board in the bench — 21 labels, 13 shape
   * kinds, a vision score of 5 — by defining one `reveal(start, end)` helper and calling it for
   * each stage. That is the BETTER pattern, and it scored 2 while a model that inlined the same
   * arithmetic everywhere scored 12, handing the crude board a higher composite than the good one.
   *
   * What actually indicates independent motion is the number of distinct time WINDOWS the drawing
   * is staged across. So: count calls to any local helper that takes a start/end pair, plus the
   * distinct numeric thresholds `progress` is compared against, plus inline interpolations. A board
   * that reveals six parts at six different moments scores six however it expresses that.
   */
  const revealHelpers = [...code.matchAll(/(?:const|let|function)\s+(\w+)\s*=?\s*(?:\()?\s*\(?\s*(?:start|from|a)\s*,\s*(?:end|to|b)\s*[,)]/g)]
    .map((match) => match[1]);
  const helperCalls = revealHelpers.reduce(
    (sum, name) => sum + (code.match(new RegExp(`\\b${name}\\s*\\(`, "g")) ?? []).length - 1,
    0,
  );
  /** Thresholds like `progress > 0.4` — each one is a moment something appears. */
  const thresholds = new Set(
    [...code.matchAll(/\bprogress\s*[<>]=?\s*([0-9.]+)|\b(?:p|t)\s*[<>]=?\s*([0-9.]+)/g)].map(
      (match) => match[1] ?? match[2],
    ),
  );
  /** Inline interpolations: `progress * 300`, `50 + p * 20`. */
  const inlineInterpolations = new Set(
    (code.match(/[^;\n]*\b(?:progress|\bp\b)\s*[*+\-/][^;\n]*/g) ?? []).map((line) => line.trim()),
  );
  const progressExpressions = Math.max(
    helperCalls + thresholds.size,
    inlineInterpolations.size,
  );

  const labelCount = (code.match(/<text[\s>]/g) ?? []).length;
  if (labelCount === 0) issues.push("No <text> labels — nothing on the board is named.");

  const shapeVariety = SVG_PRIMITIVES.filter((tag) => new RegExp(`<${tag}[\\s/>]`).test(code)).length;

  if (likelyTruncated) {
    issues.push("Hit the output token ceiling — the component was cut off mid-write, not written badly.");
  }

  return {
    compiles: issues.length === 0,
    likelyTruncated,
    issues,
    progressDrivenValues: progressExpressions,
    forbiddenClockUses,
    labelCount,
    shapeVariety,
    hadCodeFences,
    sourceChars: code.length,
  };
}

/**
 * One 0-100 number, for sorting a table.
 *
 * A composite is a convenience, not a truth: it hides which axis a model lost on, which is why the
 * report prints every component column beside it and never this alone. The weights say what this
 * bench believes matters — correctness first (a board that does not run teaches nothing), then
 * whether it actually animates, then whether it is labelled and varied.
 */
export function compositeScore(
  scores: StaticSlideScores,
  visionScore: number | null,
): number {
  if (!scores.compiles) return 0;
  const animation = Math.min(1, scores.progressDrivenValues / 12);
  const labels = Math.min(1, scores.labelCount / 6);
  const variety = Math.min(1, scores.shapeVariety / 8);
  /*
   * A missing vision score is NOT a zero. Abstract subjects are deliberately not shown to the shape
   * critic (it condemns a timeline for not looking like an object), so scoring them zero would
   * punish the case, not the model. They are carried at the neutral 0.6 and the report says which
   * rows were judged by eye and which were not.
   */
  const vision = visionScore === null ? 0.6 : (visionScore - 1) / 4;
  const penalty = scores.forbiddenClockUses.length > 0 ? 0.75 : 1;
  return Math.round((vision * 45 + animation * 25 + labels * 15 + variety * 15) * penalty);
}
