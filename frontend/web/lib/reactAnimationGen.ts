import OpenAI from "openai";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Beat } from "./lessonContent";
import { REACT_ANIMATION_SYSTEM_PROMPT, REACT_ANIMATION_ABSTRACT_SYSTEM_PROMPT } from "./drawPrompt";
import {
  getReactAnimationCodeDiagnostics,
  sanitizeReactAnimationOp,
  type ReactAnimationCodeDiagnostics,
  type ReactAnimationOp,
} from "./drawSanitize";
import { critiqueLayout, critiqueShapeRecognizability, critiqueForRefinement, reactAnimationVisionCriticEnabled, type BoardDefect } from "./reactAnimationVisionCritic";
import { findAssets, loadAssets, assetRuntimeFor, assetPromptBlock } from "./assetCatalogue";
import { appPath } from "./appPaths";
import { costFor } from "./modelPricing";

/**
 * Second step of the two-step generate-then-render pipeline for ANIMATION beats, mirroring
 * lib/imageGen.ts's fillImageOps. Takes beats whose DrawScript ops contain a
 * `{ kind: "reactAnimation", teachingPoint }` placeholder (written by the text model in step 1,
 * no `code` yet) and calls the configured animation model once per beat, in parallel, to write
 * the actual component source. A plain-text completion (fenced code block), not JSON — code strings inside a JSON
 * payload need escaping the model handles unreliably at this length.
 *
 * If a beat's code generation fails or the returned code fails validation, `code` is left unset.
 * The client shows an explicit unavailable state instead of masking the failure with a weak
 * line-diagram fallback.
 */

const MODEL = process.env.OPENAI_ANIMATION_MODEL ?? process.env.OPENAI_LECTURE_MODEL ?? "gpt-4o";
const PLANNER_MODEL = process.env.OPENAI_ANIMATION_PLANNER_MODEL ?? MODEL;
const REVIEW_MODEL = process.env.OPENAI_ANIMATION_REVIEW_MODEL ?? MODEL;
const MAX_TOKENS = Math.max(3_000, Math.min(20_000, Number(process.env.OPENAI_ANIMATION_MAX_TOKENS ?? 12_000)));
// Keep normal lessons predictable in both latency and cost. The generator gets one corrective
// retry for malformed code; expensive model-authored planning/review passes are opt-in.
const MAX_ATTEMPTS = Math.max(1, Math.min(3, Number(process.env.OPENAI_ANIMATION_ATTEMPTS ?? 2)));
const AI_VISUAL_PLANNING_ENABLED = process.env.AI_VISUAL_PLANNING_ENABLED === "1";
const AI_VISUAL_REVIEW_ENABLED = process.env.AI_VISUAL_REVIEW_ENABLED === "1";
const DEBUG_SAVE_SVG = process.env.SVG_DEBUG_SAVE === "1";
// Only consulted for gpt-5/o-series models. See modelCallParams for why this is not optional.
// "minimal" is rejected by gpt-5.5, so the accepted set is deliberately narrow.
type ReasoningEffort = "low" | "medium" | "high";
// create -> critique -> improve the existing board -> repeat. Distinct from the older
// regenerate-from-scratch retry (REACT_CRITIC_RETRY), which was measured NOT to work: it threw the
// board away each round and the mean never moved off 2.60/5. This edits what is already there.
const REFINE_ROUNDS = Math.max(0, Math.min(4, Number(process.env.REACT_REFINE_ROUNDS ?? 3)));
const REFINE_BUDGET_USD = Math.max(0, Number(process.env.REACT_REFINE_BUDGET_USD ?? 0.6));

const REASONING_EFFORT: ReasoningEffort = (() => {
  const raw = process.env.OPENAI_ANIMATION_REASONING_EFFORT;
  return raw === "medium" || raw === "high" ? raw : "low";
})();

// Cost estimate uses the same gpt-4o-era rates as generate-lecture; override models may differ.

export type ReactAnimationFillStats = {
  costUsd: number;
  pending: number;
  filled: number;
  rejected: number;
  issues: string[];
};

export type ReactAnimationFillUpdate = {
  beat: Beat;
  beatIndex: number;
  costUsd: number;
  status: "ready" | "failed";
};

/**
 * Priced by the model that produced the usage, not by a constant sitting next to the call.
 *
 * This file is why lib/modelPricing.ts exists: OPENAI_ANIMATION_MODEL was pointed at gpt-5.5 while
 * the constants here still read gpt-4o's rates, so the most expensive calls in the app reported a
 * third of their real output cost and nothing failed. MODEL, PLANNER_MODEL and REVIEW_MODEL can all
 * be pointed at different models, so each call site names the one it used.
 */
function costUsd(model: string, usage: OpenAI.Chat.Completions.ChatCompletion["usage"] | undefined): number {
  return costFor(model, usage);
}

// Deterministic classifier: is this beat an ABSTRACT/conceptual topic (algorithm, data structure,
// math, logic, procedure) whose correct visual is a DIAGRAM — rather than a PHYSICAL subject
// (biology/chemistry/physics/anatomy/device) with a recognizable silhouette? The physical-subject
// contract (real object, silhouette, "no boxes and arrows") produces irrelevant animations for
// abstract content, so we switch the system prompt + validator + skip the shape critic when true.
const ABSTRACT_SIGNALS =
  /\b(algorithm|algorithms|complexity|runtime|big-?o|asymptotic|pseudocode|data structure|array|arrays|list|linked list|stack|queue|hash|hashmap|hash table|dictionary|map\b|set\b|tree|trees|binary tree|bst|heap|trie|graph|graphs|node|nodes|edge|edges|vertex|vertices|traversal|bfs|dfs|recursion|recursive|recurrence|dynamic programming|memoization|memoized|greedy|backtracking|divide and conquer|sorting|sort\b|search\b|binary search|schedule|scheduling|interval|intervals|matrix|matrices|vector|tensor|probability|statistics|distribution|combinatorics|permutation|combination|equation|function\b|derivative|integral|calculus|theorem|lemma|proof|induction|logic|boolean|truth table|predicate|grammar|automaton|finite state|state machine|regex|regular expression|protocol|networking|packet|database|sql|query|schema|index\b|pointer|compiler|parsing|token|bit|binary\b|encryption|hashing|cache|complexity class|np-?complete|optimization|linear programming|gradient|neural|finance|interest rate|compound interest|amortiz|economic|supply and demand|elasticity)\b/i;
const PHYSICAL_SIGNALS =
  /\b(cell|cells|membrane|organ|organs|heart|lung|brain|neuron|leaf|plant|photosynthesis|chloroplast|mitochond|molecule|atom|atoms|ion|electron|reaction|enzyme|protein|dna|rna|tissue|muscle|bone|skeleton|blood|artery|vein|body|anatomy|apparatus|engine|piston|circuit|battery|motor|gear|lever|pulley|magnet|wave|lens|planet|orbit|volcano|rock|mineral|river|climate|weather|ecosystem|animal|insect|bacteria|virus|skin|digest|respirat)\b/i;

function isAbstractTopic(op: ReactAnimationOp, beat: Beat): boolean {
  const haystack = `${beat.title} ${beat.script} ${op.teachingPoint ?? ""}`;
  const abstract = (haystack.match(ABSTRACT_SIGNALS) ?? []).length;
  const physical = (haystack.match(PHYSICAL_SIGNALS) ?? []).length;
  // Any abstract signal wins unless the beat is clearly more physical (a physics/bio worked example
  // that happens to mention an equation shouldn't flip to diagram mode).
  return abstract > 0 && abstract >= physical;
}

// Cached @babel/standalone module — used to confirm generated code actually PARSES before we
// accept it. The density validator (getReactAnimationCodeDiagnostics) checks richness but not
// syntactic validity, so without this a component that passes density but has a syntax error
// would ship to the browser and fail at render time ("animation failed to run safely") — the
// exact silent failure this whole path is meant to prevent. Rejecting here instead lets the
// retry loop try again with a real error message.
let babelModule: typeof import("@babel/standalone") | null = null;
async function transpileCheck(code: string): Promise<string | null> {
  try {
    if (!babelModule) babelModule = await import("@babel/standalone");
    // MUST match ReactAnimationSandbox's transpile config exactly (classic runtime, no
    // automatic jsx-runtime require) — otherwise this check passes code the browser then
    // rejects at runtime, defeating its whole purpose.
    babelModule.transform(code, {
      presets: [["react", { runtime: "classic", pragma: "React.createElement", pragmaFrag: "React.Fragment" }]],
      plugins: ["transform-modules-commonjs"],
      filename: "animation.jsx",
    });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "code failed to parse";
  }
}

/**
 * One refinement round: hand the model its OWN component back with the defects found in the
 * rendered image, and ask for a revision.
 *
 * THE DISTINCTION THAT MAKES THIS WORTH DOING. The pre-existing retry (REACT_CRITIC_RETRY, off by
 * default) regenerated FROM SCRATCH with the complaint appended, and was measured not to work —
 * mean stuck at 2.60/5, cost doubled. Starting over discards everything already correct and re-rolls
 * the same dice. Editing keeps the parts that work and changes only what was wrong, which is what a
 * person would do.
 */
async function refineBoard(
  client: OpenAI,
  code: string,
  defects: BoardDefect[],
  subject: string,
): Promise<{ code: string | null; costUsd: number }> {
  const defectList = defects.map((d, i) => `${i + 1}. ${d.what}\n   Where: ${d.where}\n   Fix: ${d.fix}`).join("\n");
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You revise an existing teaching whiteboard component. Return ONE ```jsx fenced block containing the COMPLETE revised component and nothing else.\n" +
            "Fix EXACTLY the listed defects and change nothing else. Keep the same export signature, the same viewBox, every data-teach-* attribute, every <Asset/>, and all correct existing structure.\n" +
            "This is an edit, not a rewrite: preserve what already works. Never write a bare < in element text — write &lt;.",
        },
        {
          role: "user",
          content: `This board must depict: ${subject}\n\nDefects found in the rendered image:\n${defectList}\n\nCurrent component:\n\`\`\`jsx\n${code}\n\`\`\``,
        },
      ],
      ...modelCallParams(MODEL, MAX_TOKENS, 0.3),
    });
    const revised = extractCodeFence(completion.choices[0]?.message?.content ?? "");
    return { code: revised || null, costUsd: costUsd(MODEL, completion.usage) };
  } catch {
    return { code: null, costUsd: 0 };
  }
}

/**
 * create -> critique -> improve -> repeat, until the board reaches the reference standard, stops
 * improving, or runs out of rounds/budget. Returns the best code seen — never worse than the input.
 */
async function refineUntilGood(
  client: OpenAI,
  beat: Beat,
  op: ReactAnimationOp,
  startCode: string,
  subject: string,
  assetRuntime: string | undefined,
  abstract: boolean,
): Promise<{ code: string; costUsd: number }> {
  // Abstract boards are excluded for the same reason the shape critic skips them: the standard here
  // is physical structure, which wrongly condemns a timeline or an array diagram.
  if (abstract || !reactAnimationVisionCriticEnabled() || REFINE_ROUNDS < 1) {
    return { code: startCode, costUsd: 0 };
  }

  let bestCode = startCode;
  let bestScore = -1;
  let spent = 0;
  const trail: string[] = [];

  for (let round = 0; round <= REFINE_ROUNDS; round++) {
    const critique = await critiqueForRefinement(client, beat, bestCode, subject, assetRuntime);
    spent += critique.costUsd;
    if (critique.score === null) break; // could not look — that is not the same claim as "perfect"
    if (critique.score > bestScore) bestScore = critique.score;
    trail.push(`r${round}=${critique.score}`);

    if (critique.score >= 5 || critique.defects.length === 0) break;
    if (round === REFINE_ROUNDS) break;
    if (spent >= REFINE_BUDGET_USD) {
      trail.push("budget-stop");
      break;
    }

    const revision = await refineBoard(client, bestCode, critique.defects, subject);
    spent += revision.costUsd;
    if (!revision.code) break;

    // A revision earns its place only by passing every gate the first draft passed AND scoring
    // higher. Without that comparison a round can quietly walk a 4/5 board down to 2/5 and ship it,
    // which is worse than never having refined at all.
    if (await transpileCheck(revision.code)) continue;
    const revalidated = sanitizeReactAnimationOp({ ...op, code: revision.code }, { requireQuality: false, abstract });
    if (!revalidated.code) continue;
    const rescored = await critiqueForRefinement(client, beat, revalidated.code, subject, assetRuntime);
    spent += rescored.costUsd;
    if (rescored.score !== null && rescored.score > bestScore) {
      bestScore = rescored.score;
      bestCode = revalidated.code;
    } else {
      trail.push("rejected");
      break; // not improving — stop paying for rounds that do not move the score
    }
  }

  console.error(`[anim-refine] beat=${beat.id} ${trail.join(" -> ")} final=${bestScore}/5 $${spent.toFixed(3)}`);
  return { code: bestCode, costUsd: spent };
}

function extractCodeFence(text: string): string {
  // Closed fence (```jsx ... ```): take the inside.
  const closed = text.match(/```(?:jsx|tsx|js|javascript)?\s*\n?([\s\S]*?)```/);
  if (closed) return closed[1].trim();
  // Opening fence with no closing fence — happens when the model's code runs long or it just
  // forgets the closer. Strip the leading ```lang line so the fence never leaks into the code
  // (an unstripped ```jsx prefix is a hard Babel parse error → "animation failed to run").
  const openOnly = text.match(/^\s*```(?:jsx|tsx|js|javascript)?[^\n]*\n([\s\S]*)$/);
  if (openOnly) return openOnly[1].replace(/```\s*$/, "").trim();
  return text.trim();
}

type PreviousFailure = {
  issue: string;
  diagnostics: ReactAnimationCodeDiagnostics;
  code: string;
  review?: VisualReview;
  /** True when this attempt's primitiveScore/objectPrimitiveScore barely moved (or regressed)
   *  versus the attempt before it — signals the model is repeating itself instead of closing
   *  the gap, and needs a more forceful instruction than another generic "add more" nudge. */
  stalled: boolean;
};

type VisualBlueprint = {
  subject: string;
  view: string;
  learningGoal: string;
  recognitionCues: string[];
  requiredParts: Array<{
    name: string;
    relationship: string;
    relativePosition: string;
  }>;
  forbiddenShortcuts: string[];
  composition: {
    focalRegion: string;
    annotationRegions: string[];
    readingPath: string;
  };
};

type VisualReview = {
  pass: boolean;
  criticalIssues: string[];
  scores: {
    scientificFidelity: number;
    recognizability: number;
    composition: number;
    labeling: number;
    educationalClarity: number;
    professionalFinish: number;
  };
  revision: string;
};

/**
 * The parameters that differ by model family, as one spread.
 *
 * gpt-5.x / o-series need `max_completion_tokens` AND accept only their default temperature:
 *   temperature: 0.55 -> 400 "does not support 0.55 with this model. Only the default (1)".
 *
 * The token half of this was already handled; the temperature half was not, which mattered because
 * the retry loop RAISES temperature per attempt (0.55, 0.75, 0.95). Pointing OPENAI_ANIMATION_MODEL
 * at a newer model without this would 400 every attempt, fail every beat, and drop each one to the
 * fallback board — indistinguishable from a total quality collapse unless you read the logs.
 */
function modelCallParams(model: string, maxTokens: number, temperature: number) {
  const modern = /^(gpt-5|o[0-9])/.test(model);
  return modern
    ? {
        max_completion_tokens: maxTokens,
        /**
         * REQUIRED, not a tuning knob. On these models reasoning tokens are drawn from the SAME
         * budget as the reply, and at the default effort a 12,000-token cap was consumed entirely
         * by internal reasoning: `finish=length rawLen=0` on every attempt, three attempts, zero
         * output, beat refused. It looked exactly like a catastrophic quality regression.
         *
         * At "low" the same call spends ~30 reasoning tokens and returns 5.4KB of component in
         * ~21s. This board is a drawing task — the thinking that matters is in the layout grid and
         * the worked example, not in deliberation. ("minimal" is rejected by gpt-5.5.)
         */
        reasoning_effort: REASONING_EFFORT,
      }
    : { max_tokens: maxTokens, temperature };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    const parsed = JSON.parse(clean);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function stringList(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim().slice(0, 180))
        .slice(0, max)
    : [];
}

function fallbackBlueprint(op: ReactAnimationOp, beat: Beat): VisualBlueprint {
  return {
    subject: beat.title,
    view: "the clearest scientifically appropriate teaching view",
    learningGoal: op.teachingPoint ?? beat.title,
    recognitionCues: ["recognizable silhouette", "correct relative proportions", "clear functional relationships"],
    requiredParts: [],
    forbiddenShortcuts: ["generic icon", "unlabeled blob", "decorative geometry", "unrelated analogy object"],
    composition: {
      focalRegion: "the central teaching region",
      annotationRegions: ["clear exterior whitespace near each named part"],
      readingPath: "title, main subject, functional relationship, concise takeaway",
    },
  };
}

async function planVisual(
  client: OpenAI,
  op: ReactAnimationOp,
  beat: Beat
): Promise<{ blueprint: VisualBlueprint; costUsd: number }> {
  const fallback = fallbackBlueprint(op, beat);
  try {
    const completion = await client.chat.completions.create({
      model: PLANNER_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a scientific visual architect for a premium educational whiteboard. " +
            "Plan one accurate, recognizable editable SVG illustration before anyone draws it. " +
            "Be subject-specific and topology-aware. Never prescribe generic icons, clip art, UI cards, or decorative analogies. " +
            "Return JSON only.",
        },
        {
          role: "user",
          content: [
            `Title: ${beat.title}`,
            `Teaching brief: ${op.teachingPoint ?? beat.title}`,
            `Narration: ${beat.script}`,
            "Return this exact shape:",
            JSON.stringify({
              subject: "exact real subject being depicted",
              view: "specific view/cutaway/perspective best suited to the concept",
              learningGoal: "what the finished figure must make visually obvious",
              recognitionCues: ["3-6 visible cues without which the subject is not recognizable"],
              requiredParts: [
                {
                  name: "part",
                  relationship: "how it connects to or acts on another part",
                  relativePosition: "where it must sit relative to the whole",
                },
              ],
              forbiddenShortcuts: ["3-6 tempting but misleading generic substitutions"],
              composition: {
                focalRegion: "where the main subject belongs",
                annotationRegions: ["where labels and explanations can sit without collisions"],
                readingPath: "natural order in which a teacher builds and revisits the figure",
              },
            }),
            "Include only parts needed for this teaching point. Use accurate morphology and relative position, not exhaustive detail.",
          ].join("\n\n"),
        },
      ],
      response_format: { type: "json_object" },
      ...modelCallParams(PLANNER_MODEL, 1_400, 0.2),
    });
    const parsed = parseJsonObject(completion.choices[0]?.message?.content ?? "");
    if (!parsed) return { blueprint: fallback, costUsd: costUsd(PLANNER_MODEL, completion.usage) };
    const requiredParts = Array.isArray(parsed.requiredParts)
      ? parsed.requiredParts.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const part = item as Record<string, unknown>;
          const name = typeof part.name === "string" ? part.name.trim() : "";
          if (!name) return [];
          return [{
            name: name.slice(0, 80),
            relationship: typeof part.relationship === "string" ? part.relationship.trim().slice(0, 180) : "",
            relativePosition: typeof part.relativePosition === "string" ? part.relativePosition.trim().slice(0, 180) : "",
          }];
        }).slice(0, 9)
      : [];
    const composition = parsed.composition && typeof parsed.composition === "object"
      ? parsed.composition as Record<string, unknown>
      : {};
    return {
      blueprint: {
        subject: typeof parsed.subject === "string" ? parsed.subject.trim().slice(0, 140) : fallback.subject,
        view: typeof parsed.view === "string" ? parsed.view.trim().slice(0, 180) : fallback.view,
        learningGoal: typeof parsed.learningGoal === "string" ? parsed.learningGoal.trim().slice(0, 240) : fallback.learningGoal,
        recognitionCues: stringList(parsed.recognitionCues, 6),
        requiredParts,
        forbiddenShortcuts: stringList(parsed.forbiddenShortcuts, 6),
        composition: {
          focalRegion: typeof composition.focalRegion === "string" ? composition.focalRegion.trim().slice(0, 160) : fallback.composition.focalRegion,
          annotationRegions: stringList(composition.annotationRegions, 5),
          readingPath: typeof composition.readingPath === "string" ? composition.readingPath.trim().slice(0, 220) : fallback.composition.readingPath,
        },
      },
      costUsd: costUsd(PLANNER_MODEL, completion.usage),
    };
  } catch {
    return { blueprint: fallback, costUsd: 0 };
  }
}

function reviewScore(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(5, number)) : 1;
}

async function reviewGeneratedVisual(
  client: OpenAI,
  beat: Beat,
  blueprint: VisualBlueprint,
  code: string
): Promise<{ review: VisualReview; costUsd: number }> {
  const failedReview: VisualReview = {
    pass: false,
    criticalIssues: ["The independent visual review did not return a valid verdict."],
    scores: {
      scientificFidelity: 1,
      recognizability: 1,
      composition: 1,
      labeling: 1,
      educationalClarity: 1,
      professionalFinish: 1,
    },
    revision: "Rebuild the figure conservatively from the visual blueprint with a recognizable silhouette, correct topology, and collision-free labels.",
  };
  try {
    const completion = await client.chat.completions.create({
      model: REVIEW_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are the uncompromising art director and scientific editor for a premium educational platform. " +
            "Review the final progress=1 SVG implied by the React source. Reject attractive but inaccurate, generic, tangled, crowded, childish, or clip-art-like work. " +
            "A passing figure must be recognizable before reading labels, preserve the blueprint's topology and relative positions, use clean non-crossing leaders, and look publication-ready. " +
            "Do not reward primitive count or code complexity. Return JSON only.",
        },
        {
          role: "user",
          content: [
            `Beat: ${beat.title}`,
            `Visual blueprint:\n${JSON.stringify(blueprint, null, 2)}`,
            "Score each category from 1 to 5. Passing requires every category >=4 and zero critical issues.",
            "Critical failures include: wrong morphology; missing required part; incorrect connection/direction; generic substitute; subject unrecognizable without labels; text or leaders crossing the subject; overlapping labels; crossed/tangled leaders; clipped content; decorative analogy dominating the real subject.",
            "Return: {\"pass\":boolean,\"criticalIssues\":string[],\"scores\":{\"scientificFidelity\":number,\"recognizability\":number,\"composition\":number,\"labeling\":number,\"educationalClarity\":number,\"professionalFinish\":number},\"revision\":\"one precise actionable revision brief\"}",
            `Generated component:\n\`\`\`jsx\n${code}\n\`\`\``,
          ].join("\n\n"),
        },
      ],
      response_format: { type: "json_object" },
      ...modelCallParams(REVIEW_MODEL, 1_200, 0),
    });
    const parsed = parseJsonObject(completion.choices[0]?.message?.content ?? "");
    if (!parsed) return { review: failedReview, costUsd: costUsd(REVIEW_MODEL, completion.usage) };
    const rawScores = parsed.scores && typeof parsed.scores === "object"
      ? parsed.scores as Record<string, unknown>
      : {};
    const scores = {
      scientificFidelity: reviewScore(rawScores.scientificFidelity),
      recognizability: reviewScore(rawScores.recognizability),
      composition: reviewScore(rawScores.composition),
      labeling: reviewScore(rawScores.labeling),
      educationalClarity: reviewScore(rawScores.educationalClarity),
      professionalFinish: reviewScore(rawScores.professionalFinish),
    };
    const criticalIssues = stringList(parsed.criticalIssues, 8);
    const strictPass = criticalIssues.length === 0 && Object.values(scores).every((score) => score >= 4);
    return {
      review: {
        pass: parsed.pass === true && strictPass,
        criticalIssues,
        scores,
        revision: typeof parsed.revision === "string" && parsed.revision.trim()
          ? parsed.revision.trim().slice(0, 900)
          : failedReview.revision,
      },
      costUsd: costUsd(REVIEW_MODEL, completion.usage),
    };
  } catch {
    return { review: failedReview, costUsd: 0 };
  }
}

function diagnosticsSummary(diagnostics: ReactAnimationCodeDiagnostics): string {
  return [
    `groups=${diagnostics.groupCount}/5+`,
    `primitiveScore=${diagnostics.primitiveScore}/14+`,
    `primitiveTags=${diagnostics.primitiveTagCount}`,
    `objectPrimitives=${diagnostics.objectPrimitiveScore}/8+`,
    `silhouettes=${diagnostics.silhouetteCount}/1+`,
    `primitiveTypes=${diagnostics.distinctPrimitiveTypes}/4+`,
    `progressRefs=${diagnostics.progressRefs}`,
    `progressDriveScore=${diagnostics.progressDriveScore}/8+`,
    `lineLike=${diagnostics.lineLikeCount}`,
    `text=${diagnostics.textCount}`,
    `directlyTimedText=${diagnostics.directlyTimedTextCount}/${diagnostics.textCount}`,
    `fills=bright:${diagnostics.brightFillCount}/dark:${diagnostics.darkFillCount}`,
    `timelineSteps=${diagnostics.timelineStepCount}/8+`,
    `sentenceMapped=${diagnostics.timelineSentenceCount}/${diagnostics.timelineStepCount}`,
    `distinctSentences=${diagnostics.distinctTimelineSentences}/3+`,
    `boardPlan=${diagnostics.boardPlanPresent ? "present" : "missing"}`,
    `visualSpec=${diagnostics.visualSpecPresent ? "present" : "missing"}`,
    `bytes=${diagnostics.byteLength}/49152`,
    `tags=${JSON.stringify(diagnostics.tagCounts)}`,
  ].join("; ");
}

/** Turns the rejected attempt's diagnostics into an explicit numeric shortfall so the retry has
 *  a concrete target instead of a vague "add more" — near-miss rejections (e.g. primitiveScore
 *  31/34) otherwise tend to regenerate a metrically near-identical scene at the next attempt
 *  rather than closing the gap. */
function gapInstruction(diagnostics: ReactAnimationCodeDiagnostics): string {
  const gaps: string[] = [];
  if (diagnostics.groupCount < 5) gaps.push(`${5 - diagnostics.groupCount} more <g> group(s) (currently ${diagnostics.groupCount}, need 5+)`);
  if (diagnostics.primitiveScore < 14) gaps.push(`${14 - diagnostics.primitiveScore} more real drawn SVG tags — actual meaningful shapes, not decorative filler clusters (currently ${diagnostics.primitiveScore}, need 14+)`);
  if (diagnostics.objectPrimitiveScore < 8) gaps.push(`${8 - diagnostics.objectPrimitiveScore} more object/body primitives — only genuine parts of the subject (currently ${diagnostics.objectPrimitiveScore}, need 8+)`);
  if (diagnostics.silhouetteCount < 1) gaps.push("at least one path/polygon/ellipse silhouette or cutaway shape (currently 0)");
  if (diagnostics.timelineStepCount < 8) gaps.push(`${8 - diagnostics.timelineStepCount} more complete teacher timeline step(s), each with order/kind/weight attributes`);
  if (diagnostics.timelineSentenceCount < diagnostics.timelineStepCount) gaps.push(`${diagnostics.timelineStepCount - diagnostics.timelineSentenceCount} timeline step(s) still need data-teach-sentence`);
  if (diagnostics.distinctTimelineSentences < 3) gaps.push(`${3 - diagnostics.distinctTimelineSentences} more distinct spoken sentence cue(s) must own timeline actions`);
  if (diagnostics.directlyTimedTextCount < diagnostics.textCount) gaps.push(`${diagnostics.textCount - diagnostics.directlyTimedTextCount} SVG text element(s) need all four timeline attributes directly on the text node`);
  if (!diagnostics.boardPlanPresent) gaps.push("the required const boardPlan with composition, readingPath, and reservedRegions");
  if (!diagnostics.visualSpecPresent) gaps.push("the required const visualSpec with recognitionCues, requiredParts, and forbiddenShortcuts");
  if (diagnostics.distinctPrimitiveTypes < 4) gaps.push(`${4 - diagnostics.distinctPrimitiveTypes} more distinct SVG primitive type(s) — mix path/circle/rect/ellipse/polygon, not just one or two kinds (currently ${diagnostics.distinctPrimitiveTypes}, need 4+)`);
  if (diagnostics.progressDriveScore < 8) gaps.push(`${8 - diagnostics.progressDriveScore} more progress-drive score — more lerp/clamp/phase-derived variables actually referenced in the JSX bindings (currently ${diagnostics.progressDriveScore}, need 8+)`);
  if (gaps.length === 0) return "";
  return `EXACT GAP TO CLOSE (the previous attempt was close — add real, meaningful parts, not clutter): ${gaps.join("; ")}. Close each gap by drawing genuine additional parts of the mechanism (more internal components, more cutaway detail, evenly-spaced agents), keeping the layout clean and uncrowded — never by adding filler text, duplicate labels, random scattered dots, or background noise.`;
}

/** True when the two most-relevant validator scores barely moved (or regressed) between one
 *  rejected attempt and the next — i.e. the model is repeating itself rather than closing the
 *  gap. Observed in practice: consecutive attempts producing byte-identical or near-identical
 *  primitiveScore/objectPrimitiveScore despite an explicit numeric gap instruction. */
function isStalled(
  prev: ReactAnimationCodeDiagnostics | undefined,
  next: ReactAnimationCodeDiagnostics
): boolean {
  if (!prev) return false;
  const primitiveDelta = next.primitiveScore - prev.primitiveScore;
  const objectDelta = next.objectPrimitiveScore - prev.objectPrimitiveScore;
  return primitiveDelta <= 2 && objectDelta <= 2;
}

function codeExcerpt(code: string): string {
  const clean = code.trim();
  if (clean.length <= 9_000) return clean;
  return `${clean.slice(0, 4_500)}\n\n/* ...middle removed for repair prompt... */\n\n${clean.slice(-4_000)}`;
}

async function saveDebugSvgCandidate(beat: Beat, op: ReactAnimationOp, code: string, issue: string): Promise<void> {
  if (!DEBUG_SAVE_SVG) return;
  try {
    const generatedDir = appPath("public", "generated");
    await mkdir(generatedDir, { recursive: true });
    await writeFile(
      path.join(generatedDir, "debug-latest-svg.json"),
      JSON.stringify({
        script: beat.script,
        issue,
        draw: {
          caption: beat.draw?.caption ?? beat.title,
          durationMs: beat.draw?.durationMs ?? 26000,
          ops: [{ ...op, code, status: "ready" }],
        },
      }),
      "utf8"
    );
  } catch (err) {
    console.error(`[anim-debug] could not save latest SVG candidate: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Unified whiteboard-diagram contract — used for EVERY reactAnimation beat regardless of source
// (free-typed topic or Suprnotes upload). Originally Suprnotes-only (gated behind a sentinel
// string in teachingPoint); free-topic beats used a separate dark-background "motion scene"
// contract that predates this app's paper-surface default (see applyPaperLayout in
// generate-lecture/route.ts) and was stylistically mismatched with it — a free-topic lecture's
// animation beat would render a dark particle scene sitting on an otherwise all-paper lecture.
// Unified to this contract since it's the proven-good style (confirmed against real Suprnotes
// output: clean flat-pastel labeled diagrams on a white board, not generic dark motion).
function buildUserPrompt(
  op: ReactAnimationOp,
  beat: Beat,
  blueprint: VisualBlueprint,
  previousFailure?: PreviousFailure,
  abstract = false,
): string {
  const spokenSentences = beat.script
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const numberedScript = spokenSentences.map((sentence, index) => `[${index}] ${sentence}`).join("\n");
  const whiteboardContract = abstract
    ? "WHITEBOARD MODE: create a full-board WHITE SVG teaching canvas that evolves like a lesson, not a slide. Render an off-white paper background and a clean, precise, editable concept DIAGRAM using SVG primitives directly: rect, line, polyline, path, circle, ellipse, polygon, text. Cells, rows, nodes, edges, axes, and arrows are the concept — use them. This is not a loading animation, fixed template, or collection of UI cards."
    : "WHITEBOARD MODE: create a full-board WHITE SVG teaching canvas that evolves like a lesson, not a slide. Render an off-white paper background, natural handwritten lines, and a professional editable educational illustration. Use SVG primitives directly: path, circle, ellipse, rect, polygon, line, polyline, text. This is not a loading animation, generic flowchart, fixed template, or collection of UI cards.";
  const contentContract = abstract
    ? "CONTENT QUALITY: draw the CORRECT diagram for this abstract concept (indexed array/grid, labeled timeline of intervals, tree/graph of nodes and edges, number line, coordinate plane, ordered step flow, or matrix — whichever teaches THIS beat). Use REAL example values from the script (actual numbers, names, intervals), not placeholders. Do NOT invent a physical object, mascot, or silhouette to stand in for the concept. Ground every cell, node, edge, axis, and label in the beat's script. Draw the full structure clearly; show relationships (pointers, edges, comparisons, selection) explicitly."
    : "CONTENT QUALITY: the VISUAL BLUEPRINT below is the source of truth for morphology, topology, proportions, and required parts. The main subject must be recognizable before any label is read. Ground every visible label and diagram element in the beat's script and blueprint. Never replace the real subject with a metaphor, mascot, generic circle cluster, icon, or decorative analogy. Draw fewer parts well rather than many vague parts. Every connection, direction, layer, chamber, boundary, and relative position must agree with the blueprint.";
  const layoutContract =
    `DYNAMIC COMPOSITION: first choose the layout that best teaches THIS content: center-out mechanism, causal path, vertical derivation, zoom-in cutaway, radial anatomy, equation spine, timeline/map, or comparison only when comparison is the idea. Define const boardPlan with that composition, its reading path, and reservedRegions as NUMERIC {name,x,y,w,h} rectangles. Do not default to left text/right diagram. Reserve a title strip inside x=54..946,y=30..104 and place teaching content only inside x=64..936,y=122..500. Place each explanation beside the object or relationship it explains and reserve room for later annotations. Before returning, estimate every text box as width=0.62*fontSize*characterCount and height=1.35*fontSize; no estimated text rectangle may intersect a diagram rectangle, another text rectangle, or leave the content bounds. Keep at least 36px between text and diagram silhouettes, 28px between unrelated items, and 64px horizontal safety after every line's last character. Occupy roughly 58-76% of the usable board. Use 4-7 short text lines, each <=25 characters, one line per SVG text node. Put the timing attributes directly on every text node. ${
      abstract
        ? "A value or short name that belongs to a cell/node/bar (an array value, an index, a node label) SITS INSIDE that element; an explanatory annotation stays outside near what it describes."
        : "No descriptive label may overlap or sit inside the subject silhouette; only real chemical symbols <=4 characters may be inside. All other labels stay outside and use a leader line that touches the named part."
    } No cards, pills, clipped text, ellipses, or transcript paragraph. Use fontFamily: 'Chalkboard SE, Marker Felt, Bradley Hand, Comic Sans MS, Trebuchet MS, sans-serif' on every text element.`;
  const longNarrationContract =
    "LONG-NARRATION DISCIPLINE: the teacher may spend close to a minute on this board. Do not respond by drawing more objects or copying more sentences. Select 3-5 pivotal sentence cues for new visual actions, then let the existing diagram remain while later narration explains, revisits, highlights, and connects those same anchors. The final board must stay as concise as a premium textbook figure.";
  const animationContract =
    `TEACHING SCORE: add data-teach-order, data-teach-kind, data-teach-weight, and a LITERAL data-teach-sentence={N} to at least 8 meaningful outer elements/groups. N must be the zero-based sentence number whose spoken words introduce that exact visual action, from 0 through ${Math.max(0, spokenSentences.length - 1)}. Distribute the steps across at least 3 different sentences and normally assign no more than 3 steps to one sentence; assigning the whole board to sentence 0 is a failure. Start by writing the heading, then INTERLEAVE a claim, its drawing, its label, its relationship arrow, the next nearby claim, and a later annotation that returns to something already drawn. Never put all text before all diagrams. The host writes words and traces contours from these attributes, so do not hide timeline groups with your own opacity and never construct partial strings with slice, substring, substr, or a progress-driven character count. Progress may additionally drive at least two scientifically meaningful changes. Diagram contours should be real paths and shapes that can be traced; fills settle after outlines; labels come after their target; arrows draw in their actual direction.`;
  const implementationContract =
    "IMPLEMENTATION: export default function Animation({ progress }) exactly. Inside it define const visualSpec using the blueprint's subject, recognitionCues, requiredParts, relationships, morphology/view, and forbiddenShortcuts; also define const boardPlan with composition, readingPath, and reservedRegions. Use enough editable inline SVG primitives to draw the real subject convincingly, but never add elements to satisfy a count. At progress=1 the page must be coherent, premium, recognizable, and understandable as a static teaching figure.";

  return [
    `Beat title: ${beat.title}`,
    `Spoken script split into exact synchronization cues:\n${numberedScript}`,
    `Whiteboard source brief:\n${op.teachingPoint}`,
    `MANDATORY VISUAL BLUEPRINT:\n${JSON.stringify(blueprint, null, 2)}`,
    whiteboardContract,
    contentContract,
    layoutContract,
    longNarrationContract,
    animationContract,
    implementationContract,
    previousFailure
      ? [
          `The previous generated component was rejected because: ${previousFailure.issue}.`,
          `Validator metrics for the rejected source: ${diagnosticsSummary(previousFailure.diagnostics)}`,
          gapInstruction(previousFailure.diagnostics),
          previousFailure.review
            ? `INDEPENDENT ART-DIRECTION REVIEW:\nCritical issues: ${previousFailure.review.criticalIssues.join("; ") || "quality scores below threshold"}\nScores: ${JSON.stringify(previousFailure.review.scores)}\nRequired revision: ${previousFailure.review.revision}`
            : "",
          "Rewrite the whiteboard SVG from scratch while preserving the source facts and visual blueprint. Fix ONLY the named failure. Unless the failure is explicitly that the scene is too sparse or too flat, keep the SAME number of shapes or FEWER — a format, timeline, or layout failure is fixed by restructuring what is already there, never by drawing more parts. Do not add filler dots, decorative blobs, extra labels, or unrelated analogy objects. A calmer, simpler board that fixes the issue beats a busier one.",
          "Rejected source for diagnosis only:",
          "```jsx",
          codeExcerpt(previousFailure.code),
          "```",
        ].join("\n")
      : "Generate the whiteboard SVG component now. Return only one fenced jsx code block.",
  ].filter(Boolean).join("\n\n");
}


/**
 * The assets the board ACTUALLY renders, not the ones it was offered.
 *
 * These two diverge constantly: a beat is offered six neuron illustrations, uses none of them, and
 * hand-draws a grey circle. Reporting the offered list made the sandbox fetch six SVGs the board
 * never draws, and made the logs read as though artwork were in use when it was not — which is how
 * "the boards use real artwork now" went unchallenged while every subject was still hand-drawn.
 */
function assetsUsedBy(code: string, offered: Array<{ id: string }>): string[] | undefined {
  const used = offered.filter((a) => new RegExp(`name=["\x27]${a.id.replace(/[.*+?^${}()|[\]\\]/g, "\\async function generateOne(")}["\x27]`).test(code));
  return used.length ? used.map((a) => a.id) : undefined;
}

async function generateOne(
  client: OpenAI,
  op: ReactAnimationOp,
  beat: Beat
): Promise<{ costUsd: number; filled: boolean; issue?: string }> {
  // Abstract topics (algorithms/data-structures/math) draw as DIAGRAMS, not physical objects: use
  // the abstract system prompt + relaxed validator, and skip the physical shape-recognizability critic.
  const abstract = isAbstractTopic(op, beat);
  const basePrompt = abstract ? REACT_ANIMATION_ABSTRACT_SYSTEM_PROMPT : REACT_ANIMATION_SYSTEM_PROMPT;
  const visualPlan = AI_VISUAL_PLANNING_ENABLED
    ? await planVisual(client, op, beat)
    : { blueprint: fallbackBlueprint(op, beat), costUsd: 0 };
  const blueprint = visualPlan.blueprint;
  let totalCostUsd = visualPlan.costUsd;

  /**
   * Real artwork for this subject, if the catalogue has any.
   *
   * This is the single change that moved the needle in anim-lab. Left to draw a subject itself the
   * model produces generic shapes — measured at 2.60/5 recognisability, with the critic reporting
   * "the mitochondrion is a plain oval without the characteristic cristae". Regenerating with that
   * exact complaint attached produced another 2/5: being told what is wrong does not make a model
   * able to draw an organelle. Handing it a real illustration to POSITION does.
   *
   * The runtime goes to the critics as well as to the browser — a critic scoring a board without
   * the artwork the student sees is scoring a different picture.
   */
  const assets = await loadAssets(await findAssets(blueprint.subject));
  const assetRuntime = assets.length ? assetRuntimeFor(assets) : undefined;
  const systemPrompt = basePrompt + assetPromptBlock(assets);
  if (assets.length) {
    console.error(`[react-assets] beat=${beat.id} offering ${assets.length}: ${assets.map((a) => a.id).join(", ")}`);
  }
  let previousFailure: PreviousFailure | undefined;

  // ACCEPT_BEST: track the richest RUNNABLE attempt so that if no attempt clears the full quality
  // floor, we still render the best real animation instead of discarding everything and showing the
  // "Animation unavailable" card. A candidate only counts once it's confirmed to transpile.
  type BestCandidate = { code: string; score: number };
  let best: BestCandidate | null = null;
  // The best candidate that also passed the rendered-layout check, kept separately so the
  // ACCEPT_BEST fallback below can prefer a well-laid-out board over a higher-scoring broken one.
  let bestLayoutClean: BestCandidate | null = null;
  const scoreOf = (d: ReactAnimationCodeDiagnostics) =>
    (d.primitiveScore ?? 0) + 2 * (d.timelineStepCount ?? 0) + 2 * (d.groupCount ?? 0);
  // Returns a runnable candidate that beats `best`, or null. Assignment happens in the outer scope
  // (below) so TypeScript's control-flow analysis tracks that `best` may become non-null.
  const runnableCandidate = async (
    code: string,
    d: ReactAnimationCodeDiagnostics,
    alreadyParsed: boolean,
  ): Promise<BestCandidate | null> => {
    if (!code) return null;
    const score = scoreOf(d);
    if (best && score <= best.score) return null;
    if (!alreadyParsed && (await transpileCheck(code))) return null; // not runnable — skip
    return { code, score };
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      // Retries need to diversify away from a near-miss, not converge harder on it — a lower
      // temperature on retry was observed producing metrically identical rejected output on
      // consecutive attempts. Raise temperature on each retry instead, and jump further once a
      // stall is detected (the moderate per-attempt ramp alone wasn't enough to break it).
      const temperature =
        attempt === 0
          ? 0.55
          : Math.min(1.0, 0.55 + attempt * 0.2 + (previousFailure?.stalled ? 0.15 : 0));
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: buildUserPrompt(op, beat, blueprint, previousFailure, abstract) },
        ],
        ...modelCallParams(MODEL, MAX_TOKENS, temperature),
      });
      totalCostUsd += costUsd(MODEL, completion.usage);

      const raw = completion.choices[0]?.message?.content ?? "";
      const code = extractCodeFence(raw);
      const diagnostics = getReactAnimationCodeDiagnostics(code, { abstract });
      const finishReason = completion.choices[0]?.finish_reason;
      // Always-on (not debug-gated): animation failures were invisible in production logs, so we
      // kept flying blind on why a beat showed "unavailable". One concise line per attempt.
      console.error(
        `[anim] beat=${beat.id} attempt=${attempt} finish=${finishReason} rawLen=${raw.length} codeLen=${code.length} issue=${diagnostics.issue ?? "OK"} | ${diagnosticsSummary(diagnostics)}`
      );
      const generationIssue = diagnostics.issue ??
        (!diagnostics.visualSpecPresent
          ? "missing the required visualSpec with recognitionCues, requiredParts, and forbiddenShortcuts"
          : null);
      if (generationIssue) {
        await saveDebugSvgCandidate(beat, op, code, generationIssue);
        const candidate: BestCandidate | null = (await runnableCandidate(code, diagnostics, false)) ?? best; // keep it if it runs
        best = candidate;
        // Sub-floor candidates are the ones ACCEPT_BEST actually ships, so it is worth knowing
        // which of them at least render without overlapping or clipped text. No model call —
        // critiqueLayout only rasterises and measures.
        if (candidate && candidate.code === code && (await critiqueLayout(code, assetRuntime)).ok) {
          bestLayoutClean = candidate;
        }
        const stalled = isStalled(previousFailure?.diagnostics, diagnostics);
        previousFailure = { issue: generationIssue, diagnostics, code, stalled };
        // Feed the layout fault back too, so the retry fixes placement as well as density.
        const layoutOnFail = await critiqueLayout(code, assetRuntime);
        if (!layoutOnFail.ok) {
          previousFailure.issue = `${generationIssue}. Also, the rendered board has a layout fault: ${layoutOnFail.issue}. A line of N characters at font-size F is about 0.62*F*N px wide, so on this 1000px board a 34px heading must stay under ~42 characters and a 24px body line under ~58. SHORTEN THE WORDING to fit — do not shrink the font, and do not let two text boxes intersect.`;
        }
        continue;
      }

      // Density passed — now confirm it actually parses/transpiles before accepting, so a
      // syntactically broken component never reaches the browser to fail at render time.
      const parseError = await transpileCheck(code);
      if (parseError) {
        console.error(`[anim] beat=${beat.id} attempt=${attempt} PARSE FAIL: ${parseError}`);
        await saveDebugSvgCandidate(beat, op, code, `parse failed: ${parseError}`);
        previousFailure = {
          issue: `the code did not parse: ${parseError}. Return ONLY valid JSX with no markdown fences and no TypeScript type annotations.`,
          diagnostics,
          code,
          stalled: false,
        };
        continue;
      }

      if (AI_VISUAL_REVIEW_ENABLED) {
        const visualReview = await reviewGeneratedVisual(client, beat, blueprint, code);
        totalCostUsd += visualReview.costUsd;
        console.error(
          `[anim-review] beat=${beat.id} attempt=${attempt} pass=${visualReview.review.pass} scores=${JSON.stringify(visualReview.review.scores)} issues=${visualReview.review.criticalIssues.join(" | ") || "none"}`
        );
        if (!visualReview.review.pass) {
          await saveDebugSvgCandidate(
            beat,
            op,
            code,
            visualReview.review.criticalIssues[0] ?? visualReview.review.revision
          );
          best = (await runnableCandidate(code, diagnostics, true)) ?? best; // already parsed above
          previousFailure = {
            issue: visualReview.review.criticalIssues[0] ?? visualReview.review.revision,
            diagnostics,
            code,
            review: visualReview.review,
            stalled: false,
          };
          continue;
        }
      }

      // Shape-recognizability critic: renders the ACTUAL finished frame server-side and has a
      // vision model look at the real pixels to judge whether the subject reads as the real thing
      // it claims to be (a leaf looks like a leaf, not a generic oval) — catches what the static
      // primitive-count diagnostics above and the text-based JSX review can't, since neither one
      // looks at a rendered image. Runs for every lecture, gated only by its own env flag.
      // SKIPPED for abstract topics: this critic judges whether the shape reads as a real physical
      // object, which is meaningless (and wrongly rejects) a concept diagram (timeline/array/tree/graph).
      if (!abstract && reactAnimationVisionCriticEnabled()) {
        const shapeCritique = await critiqueShapeRecognizability(client, beat, code, blueprint.subject, assetRuntime);
        totalCostUsd += shapeCritique.costUsd;
        if (!shapeCritique.ok) {
          await saveDebugSvgCandidate(beat, op, code, shapeCritique.issue ?? "shape not recognizable");
          best = (await runnableCandidate(code, diagnostics, true)) ?? best; // already parsed above
          previousFailure = {
            issue: `The rendered shape is not recognizable: ${shapeCritique.issue}. Rebuild the subject's silhouette so it visually reads as ${blueprint.subject} — correct proportions, real contours, not generic geometric substitutes.`,
            diagnostics,
            code,
            stalled: false,
          };
          continue;
        }
      }

      // Layout critic: measures the ACTUAL rendered text boxes for overlap and for anything
      // pushed outside the safe frame. Unlike the shape critic above this runs for abstract
      // boards too — geometry is exactly as wrong on a maths board, and those were the only ones
      // with no rendered-output check at all. Costs nothing (no model call) and degrades to ok.
      const layout = await critiqueLayout(code, assetRuntime);
      if (!layout.ok) {
        console.error(`[anim] beat=${beat.id} layout reject: ${layout.issue}`);
        await saveDebugSvgCandidate(beat, op, code, layout.issue ?? "layout violation");
        best = (await runnableCandidate(code, diagnostics, true)) ?? best;
        previousFailure = {
          issue: `The rendered board has a layout fault: ${layout.issue}. A line of N characters at font-size F is about 0.62*F*N px wide, so on this 1000px board a 34px heading must stay under ~42 characters and a 24px body line under ~58. SHORTEN THE WORDING to fit inside x=64..936, y=122..500, and make sure no two text boxes intersect — do not shrink the font to force a fit.`,
          diagnostics,
          code,
          stalled: false,
        };
        continue;
      }

      const validated = sanitizeReactAnimationOp({ ...op, code }, { abstract });
      if (validated.code) {
        /**
         * Refine on THIS path too — it is the one most boards now take.
         *
         * The loop was originally placed only on the ACCEPT_BEST path, where sub-floor boards land.
         * Once the animation model was upgraded, boards started clearing the density floor and
         * returning here instead, so the refinement never ran: the logs showed no [anim-refine]
         * line at all. A quality pass that only runs on the failure path is a quality pass that
         * stops running exactly when the pipeline starts working.
         */
        const refined = await refineUntilGood(client, beat, op, validated.code, blueprint.subject, assetRuntime, abstract);
        totalCostUsd += refined.costUsd;
        op.code = refined.code;
        // IDs only — the browser resolves them to markup via /api/animation-assets. See the op type.
        op.assetIds = assetsUsedBy(refined.code, assets);
        op.status = "ready";
        op.error = undefined;
        return { costUsd: totalCostUsd, filled: true };
      }
      previousFailure = {
        issue: "the code failed the safety validator after quality checks",
        diagnostics,
        code,
        stalled: false,
      };
    } catch (err) {
      previousFailure = {
        issue: err instanceof Error ? err.message : "generation failed",
        diagnostics: getReactAnimationCodeDiagnostics(""),
        code: "",
        stalled: false,
      };
    }
  }

  // ACCEPT_BEST: no attempt cleared the full floor, but if we captured a runnable candidate, ship it
  // rather than showing nothing. A real (slightly-below-floor) animation beats the "unavailable" card.
  if (best) {
    // Prefer a candidate whose LAYOUT is sound over one with a marginally higher primitive score.
    // This path ships a below-floor board by design, so the tie-break should be the fault a student
    // actually sees: overlapping labels and text clipped by the frame ruin a board far more than a
    // slightly thin primitive count does.
    if (bestLayoutClean && bestLayoutClean.code !== best.code) {
      console.error(`[anim] beat=${beat.id} preferring layout-clean candidate over higher-scoring one.`);
      best = bestLayoutClean;
    }
    // requireQuality:false — the best candidate already transpiles and passed the safety gate; ship
    // it even though it's below the quality floor, rather than discarding to "unavailable".
    const validated = sanitizeReactAnimationOp({ ...op, code: best.code }, { requireQuality: false, abstract });
    if (validated.code) {
      op.code = validated.code;
      op.assetIds = assetsUsedBy(validated.code, assets);
      op.status = "ready";
      op.error = undefined;
      console.error(`[anim] beat=${beat.id} accepted best sub-floor attempt (score=${best.score}) after ${MAX_ATTEMPTS} attempts.`);

      /**
       * SCORE THE BOARD THAT ACTUALLY SHIPS — AND REFUSE IT IF IT IS BAD.
       *
       * The shape critic above only runs on an attempt that already cleared the static density
       * gate — and on a real nephron lecture no attempt ever did, so both beats shipped through
       * this ACCEPT_BEST path with the critic never once looking at them. The measurement existed
       * and was inert on exactly the boards students see.
       *
       * This check USED to be measurement-only, on the reasoning that the attempts were spent and a
       * weak board still beat the "unavailable" card. That reasoning expired when lib/boardFallback.ts
       * landed: a refused board is no longer a dead beat, it is a beat that drops to a structure or
       * written board, both of which are guaranteed to render. So a board the critic rejects — an
       * airways diagram drawn as three plain circles, scored 2/5 — must not go out. Shipping it was
       * the exact compromise the fallback chain exists to make unnecessary.
       */
      /**
       * CREATE -> CRITIQUE -> IMPROVE -> REPEAT, on the board that is about to ship.
       *
       * Runs against a reference standard rather than "recognizable", because a board can be
       * plainly identifiable and still be an outline with a messy annotation cluster — one such
       * scored 5/5 from the recognizability critic while visibly falling short.
       */
      const refinedBest = await refineUntilGood(client, beat, op, validated.code, blueprint.subject, assetRuntime, abstract);
      totalCostUsd += refinedBest.costUsd;
      op.code = refinedBest.code;
      validated.code = refinedBest.code;

      if (!abstract && reactAnimationVisionCriticEnabled()) {
        const shipped = await critiqueShapeRecognizability(client, beat, validated.code, blueprint.subject, assetRuntime);
        totalCostUsd += shipped.costUsd;
        if (shipped.score !== null && !shipped.ok) {
          console.error(
            `[anim] beat=${beat.id} REFUSED sub-floor board scored ${shipped.score}/5 — ${shipped.issue ?? "below the recognisability floor"}. Falling back to another engine.`,
          );
          op.code = undefined;
          op.assetIds = undefined;
          op.status = "failed";
          op.error = shipped.issue ?? `board scored ${shipped.score}/5 for recognisability`;
          return { costUsd: totalCostUsd, filled: false, issue: op.error };
        }
        console.error(
          `[anim] beat=${beat.id} SHIPPED sub-floor board scored ${shipped.score ?? "not scored"}/5` +
            (shipped.issue ? ` — ${shipped.issue}` : ""),
        );
      }
      return { costUsd: totalCostUsd, filled: true };
    }
  }

  // Truly nothing runnable — leave op.code unset; the client shows the animation-unavailable state.
  op.code = undefined;
  op.status = "failed";
  op.error = previousFailure?.issue ?? "animation code was not generated";
  console.error(`[anim] beat=${beat.id} GAVE UP after ${MAX_ATTEMPTS} attempts. final issue: ${op.error}`);
  return { costUsd: totalCostUsd, filled: false, issue: previousFailure?.issue ?? "animation code was not generated" };
}

/**
 * Fills each "reactAnimation" op placeholder in the beats with generated component source.
 * Returns the total generation cost in USD. Runs entirely in parallel with fillImageOps at the
 * call site (disjoint beats, both I/O-bound) — see app/api/generate-lecture/route.ts.
 */
export async function fillReactAnimationOps(client: OpenAI, beats: Beat[]): Promise<ReactAnimationFillStats> {
  return fillReactAnimationOpsIncremental(client, beats);
}

export async function fillReactAnimationOpsIncremental(
  client: OpenAI,
  beats: Beat[],
  onUpdate?: (update: ReactAnimationFillUpdate) => void | Promise<void>,
  options: { limit?: number } = {}
): Promise<ReactAnimationFillStats> {
  const pending: Array<{ op: ReactAnimationOp; beat: Beat; beatIndex: number }> = [];
  for (let beatIndex = 0; beatIndex < beats.length; beatIndex++) {
    const beat = beats[beatIndex];
    if (!beat.draw) continue;
    for (const op of beat.draw.ops) {
      if (op.kind === "reactAnimation" && !op.code && op.status !== "failed") {
        pending.push({ op, beat, beatIndex });
      }
    }
  }
  const selected = typeof options.limit === "number" ? pending.slice(0, Math.max(0, options.limit)) : pending;
  if (selected.length === 0) {
    return { costUsd: 0, pending: 0, filled: 0, rejected: 0, issues: [] };
  }

  const results = await Promise.all(selected.map(async ({ op, beat, beatIndex }) => {
    const result = await generateOne(client, op, beat);
    await onUpdate?.({ beat, beatIndex, costUsd: result.costUsd, status: result.filled ? "ready" : "failed" });
    return result;
  }));
  const filled = results.filter((result) => result.filled).length;
  return {
    costUsd: results.reduce((sum, result) => sum + result.costUsd, 0),
    pending: selected.length,
    filled,
    rejected: selected.length - filled,
    issues: results
      .filter((result) => !result.filled && result.issue)
      .map((result) => result.issue as string)
      .slice(0, 5),
  };
}
