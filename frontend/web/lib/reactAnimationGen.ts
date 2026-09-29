import OpenAI from "openai";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Beat } from "./lessonContent";
import { REACT_ANIMATION_SYSTEM_PROMPT, REACT_ANIMATION_ABSTRACT_SYSTEM_PROMPT } from "./drawPrompt";
import { randomUUID } from "node:crypto";
import { generateIllustratedBoard, type LectureMemoryOption } from "./illustratedBoard";
import {
  getReactAnimationCodeDiagnostics,
  sanitizeReactAnimationOp,
  type ReactAnimationCodeDiagnostics,
  type ReactAnimationOp,
} from "./drawSanitize";
import {
  critiqueLayout,
  critiqueShapeRecognizability,
  critiqueForRefinement,
  labelGroundingDefects,
  labelGroundingIssue,
  reactAnimationVisionCriticEnabled,
  ungroundedBoardTexts,
  type BoardDefect,
  type LabelGroundingFault,
  type LayoutCritique,
  type ShapeCritique,
} from "./reactAnimationVisionCritic";
import { findAssets, loadAssets, assetRuntimeFor, assetPromptBlock, type LoadedAsset } from "./assetCatalogue";
import { contentStems, labelIsGrounded, sourceVocabulary, stem, type BeatSourceGrounding } from "./sourceGrounding";
import { appPath } from "./appPaths";
import { costFor } from "./modelPricing";
import { reactLabelSyncIssue } from "./boardSentenceSync";
import { animationModelForBeat, type AnimationModel } from "./animationModels";
import { recordAnimationTrial } from "./animationTrials";
import { candidateTemperatures, pickCandidate, type CandidateVerdict } from "./animationCandidates";
import { withAudience } from "./learnerBrief";

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
/**
 * Board candidates drawn AT THE SAME TIME per round (lib/animationCandidates.ts).
 *
 * They used to be drawn one after another, each retry told what was wrong with the last. Measured on
 * a real lecture: every animated beat drew all three, the first two were rejected every time, and the
 * retries never produced a board that passed — so the student waited for three drawings to get the
 * best single one. Drawing them together costs the same and takes as long as ONE.
 */
const ANIMATION_CANDIDATES = Math.max(1, Math.min(4, Number(process.env.ANIMATION_CANDIDATES ?? 3)));
/**
 * Rounds. A second round runs only when no candidate of the first could run at all (nothing
 * returned, nothing parsed) — never for a soft quality miss, which the best candidate ships through.
 */
const MAX_ROUNDS = Math.max(1, Math.min(3, Number(process.env.OPENAI_ANIMATION_ATTEMPTS ?? 2)));
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

/**
 * How long the refine loop may keep improving one board before shipping the best it has.
 *
 * 45 s is set from measurement, not taste: production timings showed react-animation beats taking
 * 66-206 s almost entirely inside this loop, against 2.6-4.9 s for the beat's script. Three beats
 * must finish before the lecture can start, so a 200 s board is most of the wait the student feels.
 *
 * Deliberately generous enough that a board reaching 5/5 in one or two rounds — the common case —
 * is never interrupted. It truncates only the long tail that was spending minutes to move a 4 to
 * a 5, and the loop keeps the best-scoring version it found rather than discarding the work.
 */
const REFINE_TIME_BUDGET_MS = Math.max(
  10_000,
  Math.min(180_000, Number(process.env.REACT_REFINE_TIME_BUDGET_MS ?? 45_000)),
);
const REFINE_BUDGET_USD = Math.max(0, Number(process.env.REACT_REFINE_BUDGET_USD ?? 0.6));

const REASONING_EFFORT: ReasoningEffort = (() => {
  const raw = process.env.OPENAI_ANIMATION_REASONING_EFFORT;
  return raw === "medium" || raw === "high" ? raw : "low";
})();

// Cost estimate uses the same gpt-4o-era rates as generate-lecture; override models may differ.

/**
 * Where one board's generation time went. Measured, not estimated: every slow call in generateOne
 * is wrapped so its duration lands in one of these buckets, and every model attempt is listed with
 * how long it took and why it was thrown away.
 *
 * WHY THIS EXISTS. A board takes 40-200 s and is most of a lecture's wait, and "the animation is
 * slow" cannot be fixed without knowing whether the time is the model writing, the checks
 * rendering, the vision critic looking, the refine loop, or attempts being generated and discarded.
 */
export type AnimationTiming = {
  totalMs: number;
  /** Writing the board: every generation call, including attempts later thrown away. */
  modelMs: number;
  /** Deterministic checks: parse and rendered-layout measurement. */
  checkMs: number;
  /** The vision critic judging recognisability. */
  criticMs: number;
  /** The critique-and-revise loop on an accepted board (its own critic calls included). */
  refineMs: number;
  /** Finding and loading catalogue artwork. */
  assetsMs: number;
  attempts: Array<{ model: string; ms: number; outcome: string }>;
  outcome: "shipped" | "sub-floor" | "refused" | "failed";
};

export type ReactAnimationFillStats = {
  costUsd: number;
  pending: number;
  filled: number;
  rejected: number;
  issues: string[];
  /** One per board generated, in the order the boards were processed. */
  timings?: AnimationTiming[];
};

/**
 * Who draws this board: the model, and the client that reaches its provider.
 *
 * Only generation and refinement use it. Every critic keeps the OpenAI client and its own vision
 * model, so when models are compared (lib/animationModels.ts) they are all scored by one judge.
 */
type GenerationChoice = { model: string; client: OpenAI };

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
//
// Terms, not a regex over prose: each list is matched as whole words with an optional plural, so
// "lungs" finds "lung" and "respiration" finds "respirat" — the old single regex ended every term
// in \b, which silently disabled every stem ("mitochond", "respirat", "digest") and every plural.
const ABSTRACT_TERMS = [
  "algorithm", "complexity", "runtime", "big-?o", "asymptotic", "pseudocode", "data structure", "array", "list",
  "linked list", "stack", "queue", "hash", "hashmap", "hash table", "dictionary", "map", "set", "tree", "binary tree",
  "bst", "heap", "trie", "graph", "node", "edge", "vertex", "vertices", "traversal", "bfs", "dfs", "recursion",
  "recursive", "recurrence", "dynamic programming", "memoization", "memoized", "greedy", "backtracking",
  "divide and conquer", "sorting", "sort", "search", "binary search", "schedule", "scheduling", "interval", "matrix",
  "matrices", "vector", "tensor", "probability", "statistics", "distribution", "combinatorics", "permutation",
  "combination", "equation", "function", "derivative", "integral", "calculus", "theorem", "lemma", "proof",
  "induction", "logic", "boolean", "truth table", "predicate", "grammar", "automaton", "finite state",
  "state machine", "regex", "regular expression", "protocol", "networking", "packet", "database", "sql", "query",
  "schema", "index", "pointer", "compiler", "parsing", "token", "bit", "binary", "encryption", "hashing", "cache",
  "complexity class", "np-?complete", "optimization", "linear programming", "gradient", "neural", "finance",
  "interest rate", "compound interest", "amortiz\\w*", "economic\\w*", "supply and demand", "elasticity",
];
const PHYSICAL_TERMS = [
  "cell", "membrane", "organ", "heart", "lung", "brain", "neuron", "leaf", "leaves", "plant", "photosynthesis",
  "chloroplast", "chlorophyll", "mitochondri\\w*", "molecule", "atom", "ion", "electron", "reaction", "enzyme",
  "protein", "dna", "rna", "tissue", "muscle", "bone", "skeleton", "blood", "artery", "arteries", "vein", "body",
  "bodies", "anatomy", "apparatus", "engine", "piston", "circuit", "battery", "batteries", "motor", "gear", "lever",
  "pulley", "magnet", "wave", "lens", "lenses", "planet", "orbit", "volcano", "rock", "mineral", "river", "climate",
  "weather", "ecosystem", "animal", "insect", "bacteria", "bacterium", "virus", "skin", "digest\\w*",
  "respirat\\w*", "stomata", "starch", "glucose", "beaker", "flask", "test tube", "bunsen", "microscope",
];
/**
 * Abstract words that are just as often ordinary English in a science script — "a list of", "the
 * function of chlorophyll", "a set of cells", "lymph node", "the edge of the leaf". Counted only when
 * the beat's TITLE uses them, where they name the topic rather than decorate a sentence.
 */
const WEAK_ABSTRACT_TERMS = new Set(["list", "set", "map", "index", "search", "function", "bit", "token", "tree", "node", "edge", "sort", "binary"]);

function termPattern(terms: string[]): RegExp {
  return new RegExp(`\\b(?:${terms.join("|")})(?:s|es)?\\b`, "gi");
}
const ABSTRACT_PATTERN = termPattern(ABSTRACT_TERMS);
const PHYSICAL_PATTERN = termPattern(PHYSICAL_TERMS);

/** Distinct terms matched, singular-folded ("cell" and "cells" are one term). */
function distinctTerms(text: string, pattern: RegExp): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(pattern)) found.add(match[0].toLowerCase().replace(/(?:es|s)$/, ""));
  return [...found];
}

/**
 * Is this beat's board a DIAGRAM of an abstract idea rather than a drawing of a physical subject?
 *
 * THE BUG THIS FIXES. Both keyword regexes lacked the /g flag, so `.match()` returned [match, group]
 * — length 2 — for any hit at all, and the rule "abstract if abstract >= physical" reduced to "any
 * abstract word wins a tie with any number of physical words". A photosynthesis beat that said
 * "word equation" became abstract: it got the diagram prompt ("do NOT invent a physical object",
 * names SIT INSIDE nodes), and — because abstract boards skip them — no shape critic and no refine
 * pass ever looked at it. The trial log shows "Photosynthesis" abstract in 6 of 6 runs.
 *
 * Now: distinct terms are counted, weak words count only in the title, and PHYSICAL WINS TIES. A
 * title that names a physical subject is physical outright, and so is a beat whose source has a
 * figure to redraw (labels, caption or image) — a figure is a picture of something, unless its
 * title is plainly about an abstract idea and names nothing physical.
 */
export function isAbstractTopic(op: Pick<ReactAnimationOp, "teachingPoint">, beat: Pick<Beat, "title" | "script">, source?: BeatSourceGrounding): boolean {
  const title = beat.title ?? "";
  const titlePhysical = distinctTerms(title, PHYSICAL_PATTERN);
  if (titlePhysical.length > 0) return false;
  const titleAbstract = distinctTerms(title, ABSTRACT_PATTERN);
  const hasFigure = Boolean(source && (source.labels.length > 0 || source.caption || source.figureImage));
  if (hasFigure && titleAbstract.filter((term) => !WEAK_ABSTRACT_TERMS.has(term)).length === 0) return false;

  const haystack = `${title} ${beat.script ?? ""} ${op.teachingPoint ?? ""}`;
  const abstract = distinctTerms(haystack, ABSTRACT_PATTERN).filter(
    (term) => !WEAK_ABSTRACT_TERMS.has(term) || titleAbstract.includes(term),
  );
  const physical = distinctTerms(haystack, PHYSICAL_PATTERN);
  return abstract.length > physical.length;
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
 * Everything the board's DETERMINISTIC gates found on one version of it: the rendered layout
 * (overlap, clipping, connectors, a component that throws), label timing against the narration,
 * and — in strict source mode — every written word against the source.
 *
 * One render serves all of them (lib/reactAnimationVisionCritic.ts caches it), no model is called,
 * and each fault comes back twice: as a sentence for the logs and as a concrete defect the refiner
 * can act on. Candidates, revisions and the final board all pass through this same function, which
 * is what lets a revision be REJECTED for a regression the old loop never looked for.
 */
type DeterministicCheck = {
  layout: LayoutCritique;
  labelSyncIssue: string | null;
  groundingFaults: LabelGroundingFault[];
  /** Strict only: false when a written word is not in the source; undefined outside strict or unmeasured. */
  grounded?: boolean;
  faults: string[];
  defects: BoardDefect[];
  /** Each fault's identity with its numbers and quotes blanked, for comparing two versions. */
  keys: string[];
};

/** What every step of one board's generation needs to know about it. */
type BoardContext = {
  client: OpenAI;
  choice: GenerationChoice;
  beat: Beat;
  op: ReactAnimationOp;
  subject: string;
  assetRuntime?: string;
  abstract: boolean;
  /** The beat's own source, when the caller supplied one (lib/sourceGrounding.ts). */
  source?: BeatSourceGrounding;
  /** Strict source mode: nothing may be drawn or written that the source does not contain. */
  strict: boolean;
  /** The narration split exactly as the prompt numbers it, so sentence indices agree everywhere. */
  sentences: string[];
};

function faultKey(issue: string): string {
  return issue.replace(/"[^"]*"/g, '""').replace(/-?\d+(?:\.\d+)?/g, "#").slice(0, 60);
}

async function deterministicChecks(code: string, ctx: BoardContext): Promise<DeterministicCheck> {
  const layout = await critiqueLayout(code, ctx.assetRuntime);
  const faults: string[] = [];
  const defects: BoardDefect[] = [];
  const keys: string[] = [];

  // A board whose code throws first: nothing else about it reaches the student.
  for (const issue of layout.issues) {
    faults.push(`the rendered board has a layout fault: ${issue}`);
    keys.push(`layout:${faultKey(issue)}`);
    defects.push({
      what: issue,
      where: "measured on the rendered finished frame",
      fix: "change only what this names — move the text to its own clear row, wrap it onto two lines keeping every word, or re-route the stroke — and leave everything else exactly as it is",
    });
  }

  // Tags that exist and are spread out can still be WRONG: a label written sentences before the
  // teacher says it. Split exactly as buildUserPrompt numbers the script, so indices agree.
  const labelSyncIssue = reactLabelSyncIssue(code, ctx.sentences);
  if (labelSyncIssue) {
    faults.push(labelSyncIssue);
    keys.push(`sync:${faultKey(labelSyncIssue)}`);
    defects.push({
      what: labelSyncIssue,
      where: "the data-teach-sentence attributes of the labels named",
      fix: "set each label's data-teach-sentence to the number of the spoken sentence that first says that label's words; change no geometry",
    });
  }

  let groundingFaults: LabelGroundingFault[] = [];
  let grounded: boolean | undefined;
  if (ctx.strict && ctx.source && layout.measured) {
    groundingFaults = ungroundedBoardTexts(layout.texts, ctx.source);
    grounded = groundingFaults.length === 0;
    const issue = labelGroundingIssue(groundingFaults);
    if (issue) {
      faults.push(issue);
      for (const fault of groundingFaults) keys.push(`ground:${fault.text.toLowerCase()}`);
      defects.push(...labelGroundingDefects(groundingFaults, ctx.source));
    }
  }
  return { layout, labelSyncIssue, groundingFaults, grounded, faults, defects, keys };
}

/**
 * Is `next` worse than `prev` on the deterministic gates? Any fault `prev` did not have, or more
 * faults overall. A revision is an edit, so it must not buy a better vision score with a new
 * overlap, a broken label timing, or an invented word — the old loop checked only that it parsed.
 */
function regressed(prev: DeterministicCheck, next: DeterministicCheck): string | null {
  const before = new Set(prev.keys);
  const added = next.keys.filter((key) => !before.has(key));
  if (added.length) return `new fault: ${next.faults.find((_, i) => !before.has(next.keys[i])) ?? added[0]}`;
  if (next.keys.length > prev.keys.length) return "more faults than before";
  if (prev.layout.measured && !next.layout.measured) return "can no longer be measured";
  return null;
}

/**
 * The SOURCE block, as the generator and the refiner read it.
 *
 * Strict wording and reference wording differ in one respect only: strict says this is the ONLY
 * content allowed; reference says keep to its facts and wording. The labels are listed verbatim in
 * both, because they are the one piece of the source a figure is built from.
 */
function sourcePromptBlock(source: BeatSourceGrounding, strict: boolean, heading: string | null): string {
  const text = source.text.replace(/\[page \d+\]\s*/g, "").replace(/[ \t]+/g, " ").trim().slice(0, 3_000);
  const lines = [
    strict
      ? "SOURCE — the student's own material for this board. It is the ONLY content allowed on the board:"
      : "SOURCE — the student's own material for this board. Keep to its facts and its wording:",
    '"""',
    text,
    '"""',
  ];
  if (source.caption) lines.push(`SOURCE FIGURE: ${source.caption}`);
  if (source.labels.length) {
    lines.push(
      `PARTS THE SOURCE FIGURE SHOWS (draw each one recognisably; a label on the board uses these exact words): ` +
        source.labels.map((label) => `"${label}"`).join(", "),
    );
  } else if (strict) {
    /*
     * This used to say "write nothing but the title" — and every strict board over a page without a
     * word-labelled figure (a scanned textbook, a tree of numbered nodes, a page of prose) came out
     * as a heading on blank paper. Strict forbids NEW content, not drawing: the things SOURCE names
     * and the relations it states are its content, and the grounding gate checks every written word.
     */
    lines.push(
      (source.caption
        ? "The source's figure has no printed labels. Redraw the structure its caption and SOURCE describe — "
        : "The source prints no labelled figure. Draw the structure SOURCE describes — ") +
        "a box (or node) for each thing SOURCE names, an arrow for each step, change or relation SOURCE states, " +
        "a tree, list, array or table when SOURCE describes one, using the values SOURCE prints. " +
        "Inside each box or node write its name or value copied verbatim from SOURCE (a few words). Never leave the board as a bare title.",
    );
  }
  if (strict) {
    lines.push(
      heading
        ? `HEADING: write it as exactly "${heading}".`
        : "HEADING: copy the source's own section heading from SOURCE, or write no heading.",
    );
  }
  return lines.join("\n");
}

/**
 * The strict heading: the beat title when every word of it is the source's own, with the
 * pipeline's "(Part 2)" suffix removed (the source never prints it). Null when the title brings in
 * words the source lacks — a strict board then takes its heading from the source itself.
 */
export function strictHeading(title: string, source: BeatSourceGrounding): string | null {
  const cleaned = title.replace(/\s*\((?:part|pt\.?)\s*\d+\)\s*$/i, "").trim();
  return cleaned && labelIsGrounded(cleaned, sourceVocabulary(source)) ? cleaned : null;
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
 *
 * It now gets the NUMBERED SCRIPT (and the source, when there is one). It used to see only "this
 * board must depict: <title>", so a revision could move a label's data-teach-sentence to a sentence
 * that never says it, or — told to "add structure" — draw parts no source mentions.
 */
async function refineBoard(
  ctx: BoardContext,
  code: string,
  defects: BoardDefect[],
): Promise<{ code: string | null; costUsd: number; ms: number }> {
  const { client, model } = ctx.choice;
  const startedAt = Date.now();
  const defectList = defects.map((d, i) => `${i + 1}. ${d.what}\n   Where: ${d.where}\n   Fix: ${d.fix}`).join("\n");
  const numbered = ctx.sentences.map((sentence, index) => `[${index}] ${sentence}`).join("\n");
  const strictRule = ctx.strict
    ? "\nSTRICT SOURCE MODE: every word on this board must come from SOURCE, verbatim. Fix a defect by using SOURCE's own words or by deleting — never add a word, part, label, number or scene that SOURCE does not contain."
    : "";
  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You revise an existing teaching whiteboard component. Return ONE ```jsx fenced block containing the COMPLETE revised component and nothing else.\n" +
            "Fix EXACTLY the listed defects and change nothing else. Keep the same export signature, the same viewBox, every sentence-keyed reveal (reveal(N), draw(N), on(N) — or, in an older board, every data-teach-* attribute), every <Asset/>, and all correct existing structure.\n" +
            "Every reveal stays keyed to a number from the numbered script, and each label stays revealed in the sentence that says it.\n" +
            "This is an edit, not a rewrite: preserve what already works. Never write a bare < in element text — write &lt;." +
            strictRule,
        },
        {
          role: "user",
          content: [
            `This board must depict: ${ctx.subject}`,
            `Spoken script, numbered (every reveal's sentence refers to these numbers):\n${numbered}`,
            ctx.source ? sourcePromptBlock(ctx.source, ctx.strict, ctx.strict ? strictHeading(ctx.beat.title, ctx.source) : null) : "",
            `Defects found in the rendered board:\n${defectList}`,
            `Current component:\n\`\`\`jsx\n${code}\n\`\`\``,
          ].filter(Boolean).join("\n\n"),
        },
      ],
      ...modelCallParams(model, MAX_TOKENS, 0.3),
    });
    const revised = extractCodeFence(completion.choices[0]?.message?.content ?? "");
    return { code: revised || null, costUsd: costUsd(model, completion.usage), ms: Date.now() - startedAt };
  } catch {
    return { code: null, costUsd: 0, ms: Date.now() - startedAt };
  }
}

/** Where a refine loop starts: the board, what the gates found on it, and what is already known to be wrong. */
type RefineStart = {
  code: string;
  check: DeterministicCheck;
  /**
   * Defects already known WITHOUT a new vision call, and how to judge a fix for them:
   *   "deterministic" — layout, label timing or grounding faults; a revision is kept when it has
   *                     fewer of them and none new, which needs no model to decide.
   *   "shape"         — the shape critic's own complaint; judged by the same (cheap) shape critic.
   *   "none"          — nothing known; the refinement critic looks first.
   */
  seed: { kind: "none" | "deterministic" | "shape"; defects: BoardDefect[]; shapeScore?: number | null };
};

type RefineResult = { code: string; check: DeterministicCheck; costUsd: number; score: number | null; trail: string };

/** First guess for one vision critic call, replaced by the measured duration after the first one. */
const CRITIC_CALL_ESTIMATE_MS = 6_000;
/** First guess for one refine (a full component rewrite) when the draw time is unknown. */
const REFINE_CALL_ESTIMATE_MS = 20_000;

/**
 * create -> critique -> improve -> repeat, until the board reaches the reference standard, stops
 * improving, or runs out of rounds/budget. Returns the best code seen — never worse than the input.
 *
 * WHAT CHANGED, AND WHY EACH CHANGE LOWERS LATENCY.
 *   1. The rescore IS the next round's critique. An accepted revision was scored, and the next round
 *      then critiqued the same code again — one redundant gpt-4o "high" call (3-8 s) per round.
 *   2. Known faults skip the first critique. A board that shipped with a measured overlap, a label
 *      revealed early or an invented word already has its defect list; round 0 goes straight to the
 *      refiner with it instead of paying a vision call to rediscover (or miss) it.
 *   3. A revision that does not parse, fails the safety check, or regresses on the deterministic
 *      gates ends the loop. It used to `continue` into a fresh critique of the UNCHANGED code.
 *   4. The time budget is PREDICTIVE. It was checked only when a round began, so a 20 s budget let a
 *      critique (5 s) + rewrite (14 s) + rescore (5 s) run to 24 s and a 45 s budget ran past 70.
 *      A round now starts only if its measured cost fits what is left. On the opening beats that
 *      usually means a board that passed every gate ships at once, and one with a known fault gets
 *      exactly one targeted repair.
 */
async function refineUntilGood(
  ctx: BoardContext,
  start: RefineStart,
  options: {
    /** See ReactAnimationFillOptions.refineTimeBudgetMs. Undefined means the module default. */
    refineTimeBudgetMs?: number;
    /** How long this model took to draw the board — a rewrite costs about the same. */
    generationMs?: number;
    /** The shape critic, memoised per code by the caller. */
    shapeCritique: (code: string) => Promise<ShapeCritique>;
  },
): Promise<RefineResult> {
  const unchanged = (trail = ""): RefineResult => ({ code: start.code, check: start.check, costUsd: 0, score: null, trail });
  // Abstract boards are excluded for the same reason the shape critic skips them: the standard here
  // is physical structure, which wrongly condemns a timeline or an array diagram.
  if (ctx.abstract || !reactAnimationVisionCriticEnabled() || REFINE_ROUNDS < 1) return unchanged();

  const startedAt = Date.now();
  // Clamped to the module ceiling so a caller can only ever ask for LESS time, never more.
  const timeBudgetMs = Math.max(
    10_000,
    Math.min(REFINE_TIME_BUDGET_MS, options.refineTimeBudgetMs ?? REFINE_TIME_BUDGET_MS),
  );
  const remaining = () => timeBudgetMs - (Date.now() - startedAt);
  let refineEstimate = Math.max(5_000, options.generationMs ?? REFINE_CALL_ESTIMATE_MS);
  let criticEstimate = CRITIC_CALL_ESTIMATE_MS;
  const criticSource = ctx.strict && ctx.source ? { source: ctx.source } : {};
  const critique = async (code: string) => {
    const t0 = Date.now();
    const result = await critiqueForRefinement(ctx.client, ctx.beat, code, ctx.subject, ctx.assetRuntime, criticSource);
    if (result.score !== null) criticEstimate = Date.now() - t0;
    return result;
  };

  let best = { code: start.code, check: start.check, score: null as number | null, shapeScore: start.seed.shapeScore ?? null };
  let spent = 0;
  const trail: string[] = [];
  let mode: "deterministic" | "shape" | "vision" = "vision";
  let defects: BoardDefect[] = [];

  /** Look with the refinement critic; false when the loop should stop instead. */
  const look = async (): Promise<boolean> => {
    // A vision round is critique -> rewrite -> rescore; start it only if all three fit.
    if (remaining() < criticEstimate + refineEstimate + criticEstimate) {
      trail.push(`skip@${Math.round((Date.now() - startedAt) / 1000)}s(budget)`);
      return false;
    }
    const seen = await critique(best.code);
    spent += seen.costUsd;
    if (seen.score === null) return false; // could not look — that is not the same claim as "perfect"
    best.score = seen.score;
    trail.push(`r=${seen.score}`);
    if (seen.score >= 5 || seen.defects.length === 0) return false;
    mode = "vision";
    defects = seen.defects;
    return true;
  };

  if (start.seed.defects.length > 0 && start.seed.kind !== "none") {
    mode = start.seed.kind;
    defects = start.seed.defects.slice(0, 5);
    trail.push(`seed=${start.seed.kind}:${defects.length}`);
  } else if (!(await look())) {
    return { code: best.code, check: best.check, costUsd: spent, score: best.score, trail: trail.join(" -> ") };
  }

  for (let round = 0; round < REFINE_ROUNDS; round++) {
    if (spent >= REFINE_BUDGET_USD) {
      trail.push("budget-stop");
      break;
    }
    const judgeCost = mode === "vision" ? criticEstimate : mode === "shape" ? Math.round(criticEstimate / 2) : 0;
    if (remaining() < refineEstimate + judgeCost) {
      trail.push(`time-stop@${Math.round((Date.now() - startedAt) / 1000)}s`);
      break;
    }

    const revision = await refineBoard(ctx, best.code, defects);
    spent += revision.costUsd;
    refineEstimate = Math.max(5_000, revision.ms);
    if (!revision.code) {
      trail.push("no-revision");
      break;
    }
    // A revision earns its place only by passing every gate the first draft passed AND improving.
    // Without that comparison a round can quietly walk a 4/5 board down to 2/5 and ship it, which is
    // worse than never having refined at all.
    if (await transpileCheck(revision.code)) {
      trail.push("unparsable");
      break;
    }
    const revalidated = sanitizeReactAnimationOp({ ...ctx.op, code: revision.code }, { requireQuality: false, abstract: ctx.abstract, sourceFaithful: ctx.strict });
    if (!revalidated.code) {
      trail.push("unsafe");
      break;
    }
    const check = await deterministicChecks(revalidated.code, ctx);
    const regression = regressed(best.check, check);
    if (regression) {
      trail.push("regressed");
      console.error(`[anim-refine] beat=${ctx.beat.id} revision rejected before rescoring: ${regression.slice(0, 160)}`);
      break;
    }
    const fixedFaults = check.keys.length < best.check.keys.length;

    if (mode === "deterministic") {
      if (!fixedFaults) {
        trail.push("not-fixed");
        break;
      }
      best = { ...best, code: revalidated.code, check, shapeScore: null };
      trail.push(`fixed:${best.check.keys.length}left`);
      if (check.defects.length > 0) {
        defects = check.defects.slice(0, 5);
        continue;
      }
      if (!(await look())) break;
      continue;
    }

    if (mode === "shape") {
      const shape = await options.shapeCritique(revalidated.code);
      spent += shape.costUsd;
      const before = best.shapeScore ?? 0;
      if (shape.score !== null && (shape.score > before || (shape.ok && fixedFaults))) {
        best = { ...best, code: revalidated.code, check, shapeScore: shape.score };
        trail.push(`shape=${shape.score}`);
        if (!(await look())) break;
        continue;
      }
      trail.push("rejected");
      break;
    }

    // mode === "vision": the rescore is also the next round's critique — no second look at the same code.
    const rescored = await critique(revalidated.code);
    spent += rescored.costUsd;
    const bestScore = best.score ?? -1;
    if (rescored.score !== null && (rescored.score > bestScore || (rescored.score === bestScore && fixedFaults))) {
      best = { ...best, code: revalidated.code, check, score: rescored.score, shapeScore: null };
      trail.push(`r=${rescored.score}`);
      if (rescored.score >= 5 && check.defects.length === 0) break;
      defects = [...check.defects, ...rescored.defects].slice(0, 5);
      if (defects.length === 0) break;
      // The next round is a rewrite plus a rescore; the critique it would have started with is this one.
      continue;
    }
    trail.push("rejected");
    break; // not improving — stop paying for rounds that do not move the score
  }

  console.error(`[anim-refine] beat=${ctx.beat.id} model=${ctx.choice.model} ${trail.join(" -> ")} final=${best.score ?? "unscored"}/5 $${spent.toFixed(3)} ${Date.now() - startedAt}ms`);
  return { code: best.code, check: best.check, costUsd: spent, score: best.score, trail: trail.join(" -> ") };
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

/**
 * The blueprint of a beat that has a SOURCE: built from the source, not planned by a model.
 *
 * The subject is the source figure's caption (or the beat title when there is none) and the
 * required parts are the figure's labels, verbatim. The planner, when on, writes parts from general
 * knowledge, and the fallback names only the title; both let the board draw a textbook version of
 * the subject instead of the figure the student is looking at. This costs nothing and cannot invent.
 */
export function sourceBlueprint(op: Pick<ReactAnimationOp, "teachingPoint">, beat: Pick<Beat, "title">, source: BeatSourceGrounding): VisualBlueprint {
  const subject = (source.caption?.trim() || beat.title).slice(0, 140);
  return {
    subject,
    view: source.labels.length || source.caption ? "the source figure's own view and arrangement" : "the plainest view of what the source text describes",
    learningGoal: (source.strict ? subject : op.teachingPoint ?? subject).slice(0, 240),
    recognitionCues: source.labels.length
      ? ["the source figure's outline and arrangement", "every labelled part where the source places it"]
      : ["only what the source text names"],
    // Names only: "where the source places it" is said once in view/recognitionCues, not per part.
    requiredParts: source.labels.slice(0, 12).map((name) => ({ name: name.slice(0, 80), relationship: "", relativePosition: "" })),
    forbiddenShortcuts: source.strict
      ? ["anything the source does not contain", "invented parts, labels, numbers or scenes", "stock scenery", "a reworded, abbreviated or truncated source label"]
      : ["generic icon", "unlabeled blob", "a reworded source label", "unrelated analogy object"],
    composition: {
      focalRegion: "the central teaching region",
      annotationRegions: ["clear space beside each labelled part"],
      readingPath: source.labels.length ? "heading, the figure, its labels in the order the narration names them" : "heading, the source's statements in order",
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
    `${diagnostics.motionBoard ? "revealSteps" : "timelineSteps"}=${diagnostics.timelineStepCount}/8+`,
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
  if (diagnostics.motionBoard) {
    if (diagnostics.timelineStepCount < 8) gaps.push(`${8 - diagnostics.timelineStepCount} more motion element(s) keyed to a sentence with a literal reveal(N) or draw(N) in the tag`);
    if (diagnostics.distinctTimelineSentences < 3) gaps.push(`${3 - diagnostics.distinctTimelineSentences} more distinct spoken sentence(s) must own reveals`);
  } else {
    if (diagnostics.timelineStepCount < 8) gaps.push(`${8 - diagnostics.timelineStepCount} more complete teacher timeline step(s), each with order/kind/weight attributes`);
    if (diagnostics.timelineSentenceCount < diagnostics.timelineStepCount) gaps.push(`${diagnostics.timelineStepCount - diagnostics.timelineSentenceCount} timeline step(s) still need data-teach-sentence`);
    if (diagnostics.distinctTimelineSentences < 3) gaps.push(`${3 - diagnostics.distinctTimelineSentences} more distinct spoken sentence cue(s) must own timeline actions`);
    if (diagnostics.directlyTimedTextCount < diagnostics.textCount) gaps.push(`${diagnostics.textCount - diagnostics.directlyTimedTextCount} SVG text element(s) need all four timeline attributes directly on the text node`);
  }
  if (!diagnostics.boardPlanPresent) gaps.push("the required const boardPlan with composition, readingPath, and reservedRegions");
  if (!diagnostics.visualSpecPresent) gaps.push("the required const visualSpec with recognitionCues, requiredParts, and forbiddenShortcuts");
  if (diagnostics.distinctPrimitiveTypes < 4) gaps.push(`${4 - diagnostics.distinctPrimitiveTypes} more distinct SVG primitive type(s) — mix path/circle/rect/ellipse/polygon, not just one or two kinds (currently ${diagnostics.distinctPrimitiveTypes}, need 4+)`);
  if (diagnostics.progressDriveScore < 8) gaps.push(diagnostics.motionBoard
    ? `more sentence-driven motion — more reveals and sentenceProgress-driven changes (currently ${diagnostics.progressDriveScore}, need 8+)`
    : `${8 - diagnostics.progressDriveScore} more progress-drive score — more lerp/clamp/phase-derived variables actually referenced in the JSX bindings (currently ${diagnostics.progressDriveScore}, need 8+)`);
  if (gaps.length === 0) return "";
  return `EXACT GAP TO CLOSE (the previous attempt was close — add real, meaningful parts, not clutter): ${gaps.join("; ")}. Close each gap by drawing genuine additional parts of the mechanism (more internal components, more cutaway detail, evenly-spaced agents), keeping the layout clean and uncrowded — never by adding filler text, duplicate labels, random scattered dots, or background noise.`;
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
//
// ONE LAYOUT SOURCE. This prompt used to carry its own "DYNAMIC COMPOSITION" block — "do not
// default to left text/right diagram", "occupy 58-76% of the board", a 0.62-em text estimate, a
// 25-character line cap, a font stack, and "names SIT INSIDE nodes" — while the system prompt
// (lib/drawPrompt.ts) laid down a fixed grid, a different cap and a different font. A low-reasoning
// model resolved the contradiction by copying whichever example was nearest, and the caps forced
// source labels such as "chloroplast containing chlorophyll" into invented abbreviations. Layout,
// fonts and text sizes now come from the system prompt alone; this prompt says WHAT to draw.
export function buildUserPrompt(
  op: ReactAnimationOp,
  beat: Beat,
  blueprint: VisualBlueprint,
  previousFailure?: PreviousFailure,
  abstract = false,
  source?: BeatSourceGrounding,
): string {
  const spokenSentences = scriptSentences(beat.script);
  const numberedScript = spokenSentences.map((sentence, index) => `[${index}] ${sentence}`).join("\n");
  const strict = source?.strict === true;
  const whiteboardContract = abstract
    ? "WHITEBOARD MODE: a teaching canvas that evolves like a lesson, not a slide: a clean, precise, editable concept DIAGRAM built from SVG primitives (rect, line, polyline, path, circle, ellipse, polygon, text). Use cells and nodes only when the subject is inherently an array, grid, tree, graph, or state machine. For security, networking, and process concepts prefer moving data tokens, routed paths, trust boundaries, layered zones, and visible state transformations. This is not a loading animation, fixed template, or collection of UI cards."
    : "WHITEBOARD MODE: a teaching canvas that evolves like a lesson, not a slide: a professional, editable educational illustration built from SVG primitives (path, circle, ellipse, rect, polygon, line, polyline, text). This is not a loading animation, generic flowchart, fixed template, or collection of UI cards.";
  const contentContract = strict
    ? "CONTENT: SOURCE (above) is the only content this board may show. Draw only what SOURCE states or its figure shows — and DO draw it: its parts, and the boxes and arrows for the steps and relations it states. Words go only in the title (SOURCE's words), INSIDE a drawn box or node as its name or value, and in labels naming the source figure's parts — every word copied verbatim from SOURCE. If a narration sentence says something SOURCE does not, draw nothing for it. Leave space empty rather than fill it with anything SOURCE lacks, but a board that is only a title is a failure."
    : abstract
    ? "CONTENT QUALITY: draw the CORRECT diagram for this abstract concept (indexed array/grid, labeled timeline of intervals, tree/graph of nodes and edges, number line, coordinate plane, routed process, trust-boundary scene, or matrix — whichever teaches THIS beat). Use REAL example values from the script (actual numbers, names, intervals), not placeholders. Do NOT invent a physical object, mascot, or silhouette to stand in for the concept. Ground every cell, node, edge, axis, token, boundary, and label in the beat's script. Draw the full structure clearly and show relationships or state changes explicitly. Rectangular cards are not a universal fallback; unless the concept is inherently a grid/table/array, use at most two large rectangular containers."
    : "CONTENT QUALITY: the VISUAL BLUEPRINT below is the source of truth for morphology, topology, proportions, and required parts. The main subject must be recognizable before any label is read. Ground every visible label and diagram element in the beat's script and blueprint. Never replace the real subject with a metaphor, mascot, generic circle cluster, icon, or decorative analogy. Every connection, direction, layer, chamber, boundary, and relative position must agree with the blueprint.";
  const labellingContract =
    "KEY NOTES: write 2-4 key notes in the left column (one line each, at most 24 characters, each on the sentence that says it). LABELS: at most three, and only when naming parts is this slide's point — listed in ONE <BoardLabels side=\"right\" labels={[{ text, x, y, sentence }]} /> as the last child of the svg, each point INSIDE the part it names. The host places the words, leaders and dots so nothing overlaps; never write a label, leader or label dot yourself. Every arrow starts at one named thing and ends at another.";
  const longNarrationContract =
    "LONG-NARRATION DISCIPLINE: the teacher may spend close to a minute on this board. Do not respond by drawing more objects or copying more sentences. Select 3-5 pivotal sentence cues for new visual actions, then let the existing diagram remain while later narration explains, revisits, highlights, and connects those same anchors. The final board must stay as concise as a premium textbook figure.";
  const animationContract =
    `MOTION TIMELINE: wrap at least ${strict ? 6 : 8} meaningful parts in motion elements keyed to a LITERAL sentence number — animate={reveal(N)} for a group, animate={draw(N)} for a stroke or arrow. N is the zero-based sentence whose spoken words introduce that exact visual action, from 0 through ${Math.max(0, spokenSentences.length - 1)}. Distribute the steps across at least 3 different sentences and normally no more than 3 steps per sentence; revealing the whole board on sentence 0 is a failure. A label appears in the sentence that first SAYS its words, together with its leader and dot. Start with the heading on sentence 0, then INTERLEAVE a part, its label, its relationship arrow, the next part, and a later highlight that returns to something already drawn. Never reveal all text before all drawings. Never construct partial strings with slice, substring, substr, or a character count. Within a sentence, sentenceProgress may additionally drive at least two ${strict ? "changes the source itself describes" : "scientifically meaningful changes"} (a token travelling, an organ contracting, a value filling). Outlines are real paths that draw with pathLength; arrows draw in their actual direction after the parts they join.`;
  const implementationContract =
    "IMPLEMENTATION: export default function Animation({ sentence, sentenceProgress }) exactly, with the reveal helpers from the system prompt (on, reveal, draw) defined at its top. Inside it define const visualSpec using the blueprint's subject, recognitionCues, requiredParts, relationships, morphology/view, and forbiddenShortcuts; also define const boardPlan with composition, readingPath, and reservedRegions. Use enough editable inline SVG primitives to draw the real subject convincingly, but never add elements to satisfy a count. Once every sentence has been spoken the page must be coherent, recognizable, and understandable as a static teaching figure.";

  return [
    `Beat title: ${beat.title}`,
    source ? sourcePromptBlock(source, strict, strict ? strictHeading(beat.title, source) : null) : "",
    `Spoken script split into exact synchronization cues${strict ? " (for TIMING only — never a source of content)" : ""}:\n${numberedScript}`,
    // The brief is the title, points and opening narration again: on a strict board it only repeats
    // the script (timing, never content), so it is left out rather than offered as a second source.
    strict ? "" : `Whiteboard source brief:\n${op.teachingPoint}`,
    // Compact JSON: the same blueprint in roughly 40% fewer prompt tokens than the indented form.
    `MANDATORY VISUAL BLUEPRINT:\n${JSON.stringify(blueprint)}`,
    whiteboardContract,
    contentContract,
    labellingContract,
    longNarrationContract,
    animationContract,
    implementationContract,
    previousFailure
      ? [
          `The previous generated component was rejected because: ${previousFailure.issue}.`,
          `Validator metrics for the rejected source: ${diagnosticsSummary(previousFailure.diagnostics)}`,
          // The gap instruction asks for MORE parts, which on a strict board means invented ones.
          strict ? "" : gapInstruction(previousFailure.diagnostics),
          previousFailure.review
            ? `INDEPENDENT ART-DIRECTION REVIEW:\nCritical issues: ${previousFailure.review.criticalIssues.join("; ") || "quality scores below threshold"}\nScores: ${JSON.stringify(previousFailure.review.scores)}\nRequired revision: ${previousFailure.review.revision}`
            : "",
          "Rewrite the whiteboard SVG from scratch while preserving the source facts and visual blueprint. Fix ONLY the named failure. Unless the failure is explicitly that the scene is too sparse or too flat, keep the SAME number of shapes or FEWER — a format, timeline, or layout failure is fixed by restructuring what is already there, never by drawing more parts. Do not add filler dots, decorative blobs, extra labels, or unrelated analogy objects. A calmer, simpler board that fixes the issue beats a busier one.",
          "Rejected source for diagnosis only:",
          "```jsx",
          codeExcerpt(previousFailure.code),
          "```",
        ].filter(Boolean).join("\n")
      : "Generate the whiteboard SVG component now. Return only one fenced jsx code block.",
  ].filter(Boolean).join("\n\n");
}

/** The narration split exactly as the prompt numbers it, so every sentence index agrees. */
export function scriptSentences(script: string): string[] {
  return script
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * Appended to the system prompt on a STRICT beat, after everything else, so it is the last word.
 *
 * The base prompts are written for reference lessons: "draw the internal structure", "target 45-90
 * primitives", "add the parts the subject actually has", a worked example full of anatomy. On a
 * strict lesson each of those is an instruction to invent. They are not edited out (the base prompt
 * is shared and owned elsewhere); this block overrides them explicitly and says so.
 */
export const SOURCE_FAITHFUL_OVERRIDE = `

SOURCE-FAITHFUL MODE — THIS OVERRIDES EVERY RULE ABOVE THAT CONFLICTS WITH IT.
The student chose to learn ONLY from their own source. The SOURCE block in the user message is the
entire content this board may carry.
- DRAW only what the source text states or its figure shows. No invented parts, organelles,
  molecules, apparatus, arrows, scenes, analogies, mascots, stock scenery (sun, clouds, soil, pots),
  or decorative detail. If the source does not show it, it is not on this board.
- What the source DOES state must be drawn: a box or node for each thing it names, an arrow for each
  step, change or relation it states, a tree/list/array with the values it prints. Such an arrow or
  box is the source's content, not an invention. A board that is only a title is a failure.
- WRITE only the source's words. Every <text> is a phrase copied from SOURCE or one of the ALLOWED
  LABELS, verbatim: same words, same spelling. You may shorten a source sentence by leaving words
  out, never by rewording it. Formula spellings of the source's own words are allowed (CO2 for
  "carbon dioxide", O2 for "oxygen", H2O for "water"). No number, unit or name the source does not print.
- A long label keeps all its words and wraps onto two lines. Never abbreviate or truncate a word.
- When the source has a figure, redraw THAT figure: its parts, in its arrangement, each named with
  the source's label and joined to its part by a leader line. Name every ALLOWED LABEL; name nothing else.
- The narration is for TIMING only. When a narration sentence says something SOURCE does not,
  draw and write nothing for it.
- The primitive targets, density floors and "draw the internal structure / add the parts the subject
  actually has" rules above DO NOT APPLY: a sparse board that shows exactly the source is the correct
  board. Leave space empty rather than fill it with anything the source lacks.
- visualSpec.requiredParts = the PARTS THE SOURCE FIGURE SHOWS; visualSpec.forbiddenShortcuts includes "anything not in SOURCE".`;


/**
 * The assets the board ACTUALLY renders, not the ones it was offered.
 *
 * These two diverge constantly: a beat is offered six neuron illustrations, uses none of them, and
 * hand-draws a grey circle. Reporting the offered list made the sandbox fetch six SVGs the board
 * never draws, and made the logs read as though artwork were in use when it was not — which is how
 * "the boards use real artwork now" went unchallenged while every subject was still hand-drawn.
 */
function assetsUsedBy(code: string, offered: Array<{ id: string }>): string[] | undefined {
  const used = offered.filter((a) => new RegExp(`name=["\x27]${a.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["\x27]`).test(code));
  return used.length ? used.map((a) => a.id) : undefined;
}

/**
 * Does this animation model take image input? Decided from how this repo actually calls models.
 *
 * gpt-4o (and -mini) are sent page and figure images on the script, parse and critic paths, so an
 * image to them is known to work. The gpt-5.6 animation models are never sent an image anywhere in
 * this repo; attaching one there is unverified, and a 400 would fail every candidate of the round at
 * once. So they get the source's TEXT and labels only, unless OPENAI_ANIMATION_IMAGE_INPUT=1 says
 * the deployment has checked. ("0" turns images off for every model.)
 */
export function animationModelAcceptsImages(model: string, env: Record<string, string | undefined> = process.env): boolean {
  if (env.OPENAI_ANIMATION_IMAGE_INPUT === "1") return true;
  if (env.OPENAI_ANIMATION_IMAGE_INPUT === "0") return false;
  return /^gpt-4o(?:-|$)/.test(model);
}

/**
 * Catalogue artwork for a STRICT board: only an asset that IS one of the source figure's labelled
 * parts. Searching by the beat title offers stock illustrations of a textbook subject — a generic
 * leaf, a generic cell — whose drawn detail the source never shows; on a strict board that is
 * invented content, however good it looks. No labels, no artwork.
 */
async function strictAssets(source: BeatSourceGrounding): Promise<LoadedAsset[]> {
  if (source.labels.length === 0) return [];
  const found = await findAssets(source.labels.join(" "), 8);
  const labelStems = source.labels.map((label) => contentStems(label)).filter((stems) => stems.length > 0);
  const matching = found.filter((asset) => {
    const words = new Set([...asset.id.split("-"), ...asset.name.toLowerCase().split(/\s+/)].map((word) => stem(word)));
    return labelStems.some((stems) => stems.every((value) => words.has(value)));
  });
  return loadAssets(matching.slice(0, 3));
}

/**
 * A strict board's ranking score: how many of the source figure's labels it writes, then how well it
 * keeps time with the narration — never how much it draws. Ranking by drawing density (the reference
 * score) shipped the busiest candidate, and on a strict board the busiest is the least faithful.
 */
export function sourceFidelityScore(
  texts: string[],
  source: BeatSourceGrounding,
  diagnostics: Pick<ReactAnimationCodeDiagnostics, "distinctTimelineSentences" | "timelineStepCount">,
): number {
  const written = new Set(texts.flatMap((text) => contentStems(text)));
  const covered = source.labels.filter((label) => {
    const stems = contentStems(label);
    return stems.length > 0 && stems.every((value) => written.has(value));
  }).length;
  return 100 * covered + 10 * Math.min(diagnostics.distinctTimelineSentences ?? 0, 8) + Math.min(diagnostics.timelineStepCount ?? 0, 12);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Deletes each <text> element whose whole content is one of `texts` — the last guarantee of a strict
 * board, used only when the refine loop could not replace a word the source does not contain.
 *
 * Literal JSX text only: a string built by an expression cannot be matched and is left alone (the
 * caller re-checks, so it knows). A single-text label group (<g data-teach-kind="label"> holding one
 * <text> plus its leader) is removed whole, so no leader is left pointing at nothing — and so is the
 * layout contract's own form (lib/drawPrompt.ts): a text-free label group holding the leader and
 * dot, followed directly by its <text> as a sibling.
 */
export function stripUngroundedTexts(code: string, texts: string[]): string {
  let out = code;
  const inner = "(?:\\s|<\\/?tspan\\b[^>]*>)";
  for (const text of texts) {
    const words = text.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
    if (words.length === 0) continue;
    const body = `${inner}*(?:\\{\\s*["'\`])?${inner}*${words.join(`${inner}+`)}${inner}*(?:["'\`]\\s*\\})?${inner}*`;
    const element = `<text\\b[^>]*>${body}<\\/text>`;
    // The whole single-label group first, when the text is its only <text>.
    out = out.replace(
      new RegExp(`<g\\b[^>]*data-teach-kind=["']label["'][^>]*>((?:(?!<g\\b|<\\/g>|<text\\b)[\\s\\S])*)${element}((?:(?!<g\\b|<\\/g>|<text\\b)[\\s\\S])*)<\\/g>`, "g"),
      "",
    );
    // The contract's label: leader+dot group, then its words as the next sibling (JSX comments allowed between).
    out = out.replace(
      new RegExp(`<g\\b[^>]*data-teach-kind=["']label["'][^>]*>(?:(?!<g\\b|<\\/g>|<text\\b)[\\s\\S])*<\\/g>(?:\\s|\\{\\s*\\/\\*[\\s\\S]*?\\*\\/\\s*\\})*${element}`, "g"),
      "",
    );
    out = out.replace(new RegExp(element, "g"), "");
  }
  return out;
}

async function generateOne(
  client: OpenAI,
  op: ReactAnimationOp,
  beat: Beat,
  contestant: AnimationModel | null = null,
  /** See ReactAnimationFillOptions.refineTimeBudgetMs. Undefined means the module default. */
  refineTimeBudgetMs?: number,
  /** See ReactAnimationFillOptions.sourceByBeatId. */
  source?: BeatSourceGrounding,
  /** See ReactAnimationFillOptions.blocksPlayback. */
  blocksPlayback = false,
): Promise<{ costUsd: number; filled: boolean; issue?: string; timing?: AnimationTiming }> {
  const startedAt = Date.now();
  let attemptsMade = 0;
  const phase = { modelMs: 0, checkMs: 0, criticMs: 0, refineMs: 0, assetsMs: 0 };
  const attemptLog: AnimationTiming["attempts"] = [];
  /** Add a call's duration to one bucket of the timing record. */
  const timed = async <T,>(bucket: keyof typeof phase, work: Promise<T>): Promise<T> => {
    const t0 = performance.now();
    try {
      return await work;
    } finally {
      phase[bucket] += performance.now() - t0;
    }
  };
  let providerError: string | null = null;
  const choice: GenerationChoice = { model: contestant?.id ?? MODEL, client };
  const strict = source?.strict === true;
  // Abstract topics (algorithms/data-structures/math) draw as DIAGRAMS, not physical objects: use
  // the abstract system prompt + relaxed validator, and skip the physical shape-recognizability critic.
  const abstract = isAbstractTopic(op, beat, source);
  /** What the shipped board's deterministic gates found, for the trial log. */
  let shippedCheck: DeterministicCheck | null = null;
  /**
   * Stamp the board with who drew it and how it went, and log one trial line.
   *
   * The model rides on the op, so the corner chip can name it and the lecture cache, archive and
   * progressive docs keep it with no further plumbing. The trial log is what the comparison reads.
   */
  const finish = async (
    result: { costUsd: number; filled: boolean; issue?: string },
    outcome: "shipped" | "sub-floor" | "refused" | "failed",
    score: number | null,
    refineTrail = "",
  ) => {
    // A candidate still marked pending was never needed (the round was decided without it).
    for (const entry of attemptLog) if (entry.outcome === "pending") entry.outcome = "not needed";
    const timing: AnimationTiming = {
      totalMs: Date.now() - startedAt,
      modelMs: Math.round(phase.modelMs),
      checkMs: Math.round(phase.checkMs),
      criticMs: Math.round(phase.criticMs),
      refineMs: Math.round(phase.refineMs),
      assetsMs: Math.round(phase.assetsMs),
      attempts: attemptLog,
      outcome,
    };
    console.error(`[anim-timing] beat=${beat.id} ${JSON.stringify(timing)}`);
    op.model = choice.model;
    op.trial = {
      score,
      attempts: attemptsMade,
      refineTrail: refineTrail.slice(0, 120),
      costUsd: Number(result.costUsd.toFixed(5)),
      ms: Date.now() - startedAt,
    };
    const check = shippedCheck as DeterministicCheck | null;
    await recordAnimationTrial({
      model: choice.model,
      beatId: beat.id,
      title: beat.title,
      outcome,
      // A board the provider never answered for says nothing about how well that model draws.
      providerError: outcome === "failed" ? providerError : null,
      score,
      attempts: attemptsMade,
      costUsd: op.trial.costUsd,
      ms: op.trial.ms,
      abstract,
      strict,
      layout: check ? layoutOutcome(check.layout) : null,
      grounded: check?.grounded ?? null,
      refineTrail: refineTrail.slice(0, 160),
    });
    return { ...result, timing };
  };
  const basePrompt = abstract ? REACT_ANIMATION_ABSTRACT_SYSTEM_PROMPT : REACT_ANIMATION_SYSTEM_PROMPT;
  // A beat with a source is planned FROM the source (caption + labels), never by a model.
  const visualPlan = source
    ? { blueprint: sourceBlueprint(op, beat, source), costUsd: 0 }
    : AI_VISUAL_PLANNING_ENABLED
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
   * the artwork the student sees is scoring a different picture. A strict board is offered only
   * artwork that is one of its source's labelled parts (strictAssets).
   */
  const assets = await timed(
    "assetsMs",
    strict && source ? strictAssets(source) : findAssets(blueprint.subject).then((found) => loadAssets(found)),
  );
  const assetRuntime = assets.length ? assetRuntimeFor(assets) : undefined;
  const systemPrompt = basePrompt + assetPromptBlock(assets) + (strict ? SOURCE_FAITHFUL_OVERRIDE : "");
  if (assets.length) {
    console.error(`[react-assets] beat=${beat.id} offering ${assets.length}: ${assets.map((a) => a.id).join(", ")}`);
  }
  const ctx: BoardContext = {
    client,
    choice,
    beat,
    op,
    subject: blueprint.subject,
    assetRuntime,
    abstract,
    source,
    strict,
    sentences: scriptSentences(beat.script),
  };
  const criticSource = strict && source ? { source } : {};
  /**
   * Whether the shape critic judges (and may refuse) this board. Not for abstract diagrams, where
   * "does it look like the real object" is meaningless — and not for a STRICT beat whose source has
   * no figure: there the faithful board may be the source's own statements with little or nothing
   * drawn, and a recognisability judge would refuse exactly the sparse board strict mode asks for
   * (dropping the beat to a fallback board that never saw the source). Skipping it there also saves
   * its 2-5 s vision call. The layout and grounding gates still run on every board.
   */
  const sourceHasFigure = Boolean(source && (source.labels.length > 0 || source.caption || source.figureImage));
  const shapeGated = !abstract && reactAnimationVisionCriticEnabled() && !(strict && !sourceHasFigure);
  /**
   * The shape critic, at most once per distinct board. A candidate it judged, a refine round judged
   * by it, and the sub-floor refusal gate often look at the same code; each look is a vision call.
   * A repeat look is free (cost 0), so costs are never counted twice.
   */
  const shapeMemo = new Map<string, Promise<ShapeCritique>>();
  const shapeCritique = async (code: string): Promise<ShapeCritique> => {
    const hit = shapeMemo.get(code);
    if (hit) return { ...(await hit), costUsd: 0 };
    const pending = timed("criticMs", critiqueShapeRecognizability(client, beat, code, blueprint.subject, assetRuntime, criticSource));
    shapeMemo.set(code, pending);
    return pending;
  };
  /**
   * The source's own figure, for a model known to read images. Not sent to the gpt-5.6 models: see
   * animationModelAcceptsImages.
   */
  const figureImage = source?.figureImage && animationModelAcceptsImages(choice.model) ? source.figureImage : undefined;
  let previousFailure: PreviousFailure | undefined;
  const densityScore = (d: ReactAnimationCodeDiagnostics) =>
    (d.primitiveScore ?? 0) + 2 * (d.timelineStepCount ?? 0) + 2 * (d.groupCount ?? 0);

  type Verdict = CandidateVerdict & {
    diagnostics?: ReactAnimationCodeDiagnostics;
    rawCode?: string;
    check?: DeterministicCheck;
    seed?: RefineStart["seed"];
  };

  /**
   * Every check a candidate faces, returned as a verdict instead of a `continue`.
   *
   * THE ORDER IS THE POINT. The free checks run first and all of them run: static density, parse,
   * then one render that answers layout, label timing and (strict) source grounding together. Only a
   * candidate with no known fault pays for the vision critic. The rendered-layout verdict used to be
   * applied AFTER the shape critic, so every layout-failing candidate still paid a 2-5 s vision call
   * that could not change its fate. A candidate that fails carries its faults as refine defects, so
   * whichever one ships goes into the refine loop with its repair list already written.
   */
  const evaluateCandidate = async (raw: string, attempt: number, finishReason: string | null | undefined): Promise<Verdict> => {
    let code = extractCodeFence(raw);
    let diagnostics = getReactAnimationCodeDiagnostics(code, { abstract, sourceFaithful: strict });
    // Always-on (not debug-gated): animation failures were invisible in production logs, so we
    // kept flying blind on why a beat showed "unavailable". One concise line per attempt.
    console.error(
      `[anim] beat=${beat.id} model=${choice.model} attempt=${attempt} finish=${finishReason} rawLen=${raw.length} codeLen=${code.length} issue=${diagnostics.issue ?? "OK"} | ${diagnosticsSummary(diagnostics)}`
    );
    if (!code) return { kind: "hard-fail", issue: "no component code was returned", diagnostics, rawCode: code };

    // Density passing is not enough: a syntactically broken component would fail in the browser.
    const parseError = await timed("checkMs", transpileCheck(code));
    if (parseError) {
      console.error(`[anim] beat=${beat.id} attempt=${attempt} PARSE FAIL: ${parseError}`);
      await saveDebugSvgCandidate(beat, op, code, `parse failed: ${parseError}`);
      return {
        kind: "hard-fail",
        issue: `the code did not parse: ${parseError}. Return ONLY valid JSX with no markdown fences and no TypeScript type annotations.`,
        diagnostics,
        rawCode: code,
      };
    }

    // Rendered-frame gates: no model call. Known for every runnable candidate, so a board with
    // overlapping text or invented words is not preferred when none passes.
    let check = await timed("checkMs", deterministicChecks(code, ctx));
    /*
     * A STRICT OPENING BOARD WHOSE ONLY FAULT IS AN INVENTED WORD is repaired here, not later.
     *
     * That board gets no refine call (blocksPlayback), so the invented text would be deleted after
     * the round anyway (enforceGrounding). Deleting it NOW lets the candidate pass on arrival and
     * end the round, instead of every paraphrasing candidate soft-failing and the student waiting
     * for the slowest of three. Only when grounding is the sole fault and the stripped board is clean
     * on every gate; later beats keep the refine loop, which can reword rather than delete.
     */
    if (strict && blocksPlayback && check.groundingFaults.length > 0 && check.keys.every((key) => key.startsWith("ground:"))) {
      const stripped = stripUngroundedTexts(code, check.groundingFaults.map((fault) => fault.text));
      if (stripped !== code && !(await transpileCheck(stripped))) {
        const strippedCheck = await timed("checkMs", deterministicChecks(stripped, ctx));
        if (strippedCheck.layout.measured && strippedCheck.faults.length === 0) {
          console.error(`[anim] beat=${beat.id} attempt=${attempt} STRICT: removed ${check.groundingFaults.length} ungrounded text(s) before judging: ${check.groundingFaults.map((f) => f.text).join(" | ").slice(0, 160)}`);
          code = stripped;
          check = strippedCheck;
          diagnostics = getReactAnimationCodeDiagnostics(code, { abstract, sourceFaithful: strict });
        }
      }
    }
    if (!check.layout.measured) {
      console.error(`[anim] beat=${beat.id} attempt=${attempt} layout UNMEASURED (${check.layout.unmeasured}): ${check.layout.renderError ?? "no frame"}`);
    }
    const score = strict && source ? sourceFidelityScore(check.layout.texts, source, diagnostics) : densityScore(diagnostics);
    const soft = (issue: string, seed: RefineStart["seed"]): Verdict => ({
      kind: "soft-fail",
      code,
      score,
      layoutClean: check.layout.ok,
      measured: check.layout.measured,
      renderFailed: check.layout.unmeasured === "component",
      grounded: check.grounded,
      issue,
      diagnostics,
      rawCode: code,
      check,
      seed,
    });

    const generationIssue = diagnostics.issue ??
      (!diagnostics.visualSpecPresent ? "missing the required visualSpec with recognitionCues, requiredParts, and forbiddenShortcuts" : null);
    if (check.faults.length > 0 || generationIssue) {
      const issue = check.faults[0] ?? generationIssue ?? "quality floor";
      if (check.faults.length) console.error(`[anim] beat=${beat.id} attempt=${attempt} deterministic faults: ${check.faults.join(" | ").slice(0, 400)}`);
      await saveDebugSvgCandidate(beat, op, code, issue);
      return soft(issue, check.defects.length ? { kind: "deterministic", defects: check.defects } : { kind: "none", defects: [] });
    }

    if (AI_VISUAL_REVIEW_ENABLED) {
      const visualReview = await reviewGeneratedVisual(client, beat, blueprint, code);
      totalCostUsd += visualReview.costUsd;
      console.error(
        `[anim-review] beat=${beat.id} attempt=${attempt} pass=${visualReview.review.pass} scores=${JSON.stringify(visualReview.review.scores)} issues=${visualReview.review.criticalIssues.join(" | ") || "none"}`
      );
      if (!visualReview.review.pass) {
        const issue = visualReview.review.criticalIssues[0] ?? visualReview.review.revision;
        await saveDebugSvgCandidate(beat, op, code, issue);
        return soft(issue, { kind: "none", defects: [] });
      }
    }

    // Shape-recognizability critic: a vision model looks at the rendered frame and judges whether
    // the subject reads as the real thing (in strict mode: as the source's figure). SKIPPED for
    // abstract topics, where "does it look like the real object" is meaningless and wrongly rejects
    // a concept diagram.
    if (shapeGated) {
      const shape = await shapeCritique(code);
      totalCostUsd += shape.costUsd;
      if (!shape.ok) {
        await saveDebugSvgCandidate(beat, op, code, shape.issue ?? "shape not recognizable");
        return soft(`the rendered shape is not recognizable: ${shape.issue}`, {
          kind: "shape",
          shapeScore: shape.score,
          defects: [{
            what: shape.issue ?? "the subject does not read as what it names",
            where: "the main drawing",
            fix: strict
              ? "redraw the subject so it reads as the source's own figure, using only the parts the source shows"
              : "rebuild the subject's silhouette and defining parts so it reads as the real thing",
          }],
        });
      }
    }

    const validated = sanitizeReactAnimationOp({ ...op, code }, { abstract, sourceFaithful: strict });
    if (!validated.code) return soft("the code failed the safety validator after quality checks", { kind: "none", defects: [] });
    return { kind: "pass", code: validated.code, score, measured: check.layout.measured, diagnostics, rawCode: code, check };
  };

  /**
   * ONE ROUND: every candidate requested at once, each checked the moment it arrives. The first to
   * pass every check wins and the others are cancelled; otherwise the round ends when all are in.
   */
  let chosen: { verdict: Extract<Verdict, { kind: "pass" | "soft-fail" }>; passed: boolean; drawMs: number } | null = null;
  let chosenLog: { outcome: string } | null = null;
  for (let round = 0; round < MAX_ROUNDS && !chosen; round++) {
    const temperatures = candidateTemperatures(ANIMATION_CANDIDATES);
    const controllers = temperatures.map(() => new AbortController());
    const verdicts: Array<{ verdict: Verdict; log: AnimationTiming["attempts"][number] }> = [];
    const roundLogs: AnimationTiming["attempts"] = [];
    let winner: { verdict: Verdict; log: AnimationTiming["attempts"][number] } | null = null;
    const userPrompt = withAudience(beat, buildUserPrompt(op, beat, blueprint, previousFailure, abstract, source));
    const userContent: string | OpenAI.Chat.Completions.ChatCompletionContentPart[] = figureImage
      ? [
          { type: "text", text: userPrompt },
          { type: "text", text: "SOURCE FIGURE IMAGE — the student's own figure for this board. Redraw THIS figure as an animated diagram, faithfully: its parts, their arrangement and its labels, and nothing it does not show." },
          { type: "image_url", image_url: { url: figureImage, detail: "high" } },
        ]
      : userPrompt;

    await new Promise<void>((resolveRound) => {
      let outstanding = temperatures.length;
      const settle = () => {
        outstanding -= 1;
        if (outstanding === 0) resolveRound();
      };
      temperatures.forEach((temperature, index) => {
        const attempt = attemptsMade;
        attemptsMade += 1;
        const log = { model: choice.model, ms: 0, outcome: "pending" };
        attemptLog.push(log);
        roundLogs.push(log);
        const requestedAt = performance.now();
        choice.client.chat.completions
          .create(
            {
              model: choice.model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent },
              ],
              ...modelCallParams(choice.model, MAX_TOKENS, temperature),
            },
            { signal: controllers[index].signal },
          )
          .then(async (completion) => {
            log.ms = Math.round(performance.now() - requestedAt);
            providerError = null;
            totalCostUsd += costUsd(choice.model, completion.usage);
            if (winner) {
              log.outcome = "not needed (another candidate passed)";
              return;
            }
            const verdict = await evaluateCandidate(
              completion.choices[0]?.message?.content ?? "",
              attempt,
              completion.choices[0]?.finish_reason,
            );
            log.outcome = verdict.kind === "pass" ? "passed" : `rejected: ${verdict.issue.slice(0, 90)}`;
            verdicts.push({ verdict, log });
            if (verdict.kind === "pass" && !winner) {
              winner = { verdict, log };
              // The round is decided: stop paying for the others.
              controllers.forEach((controller, other) => other !== index && controller.abort());
              resolveRound();
            }
          })
          .catch((err) => {
            if (controllers[index].signal.aborted) {
              log.ms = Math.round(performance.now() - requestedAt);
              log.outcome = "cancelled (another candidate passed)";
              return;
            }
            // Kept apart from drawing failures: a 503 or a timeout says the provider was down, not
            // that the model draws badly, and the comparison must not score it as a bad board.
            providerError = err instanceof Error ? err.message.slice(0, 160) : "generation failed";
            log.outcome = `error: ${providerError.slice(0, 80)}`;
            verdicts.push({ verdict: { kind: "hard-fail", issue: providerError }, log });
          })
          .finally(settle);
      });
    });

    // Drawing time is the round's elapsed time, not the sum: the calls overlap.
    phase.modelMs += Math.max(0, ...roundLogs.map((log) => log.ms));

    const decided = winner as { verdict: Verdict; log: AnimationTiming["attempts"][number] } | null;
    const pick = decided?.verdict ?? pickCandidate(verdicts.map((v) => v.verdict));
    if (pick && pick.kind !== "hard-fail") {
      const pickedLog = decided?.log ?? verdicts.find((v) => v.verdict === pick)?.log ?? null;
      chosen = { verdict: pick, passed: pick.kind === "pass", drawMs: pickedLog?.ms ?? 0 };
      chosenLog = pickedLog;
      break;
    }
    // Nothing in this round could run at all: the only case that earns another round, and the only
    // one where telling the model what went wrong is worth the wait.
    const lastHard = [...verdicts].reverse().find((v) => v.verdict.kind === "hard-fail")?.verdict;
    previousFailure = {
      issue: lastHard && lastHard.kind === "hard-fail" ? lastHard.issue : "no candidate produced a runnable component",
      diagnostics: lastHard?.diagnostics ?? getReactAnimationCodeDiagnostics(""),
      code: lastHard?.rawCode ?? "",
      stalled: false,
    };
  }

  /** The chosen board's refine loop, with whatever the gates already know seeding round 0. */
  const refine = async (code: string, verdict: Verdict): Promise<RefineResult> => {
    const check = verdict.check ?? (await timed("checkMs", deterministicChecks(code, ctx)));
    if (blocksPlayback) {
      // The student is waiting on this board: no refine model call on the path to the first
      // playable board. The gates above still chose the cleanest, most faithful candidate, and a
      // strict board still loses any invented word (enforceGrounding) — both at zero model cost.
      return { code, check, costUsd: 0, score: null, trail: "starter:no-refine" };
    }
    return timed(
      "refineMs",
      refineUntilGood(
        ctx,
        { code, check, seed: verdict.seed ?? { kind: "none", defects: [] } },
        { refineTimeBudgetMs, generationMs: chosen?.drawMs || undefined, shapeCritique },
      ),
    );
  };

  /**
   * STRICT: the last guarantee that nothing written on the board is outside the source.
   *
   * The refine loop is asked to replace or delete every such word, and usually does. If some remain
   * (the time budget ran out, or the revision regressed elsewhere), the offending <text> elements are
   * deleted outright. A strict lesson promises the student that every word comes from their source;
   * a missing label breaks that promise less than an invented one does.
   */
  const enforceGrounding = async (result: RefineResult): Promise<RefineResult> => {
    if (!strict || !source || result.check.groundingFaults.length === 0) return result;
    const stripped = stripUngroundedTexts(result.code, result.check.groundingFaults.map((fault) => fault.text));
    if (stripped === result.code || (await transpileCheck(stripped))) {
      console.error(`[anim] beat=${beat.id} STRICT: could not remove ungrounded text (${result.check.groundingFaults.map((f) => f.text).join(" | ").slice(0, 200)})`);
      return result;
    }
    const check = await timed("checkMs", deterministicChecks(stripped, ctx));
    if (!check.layout.measured || check.groundingFaults.length >= result.check.groundingFaults.length) return result;
    console.error(`[anim] beat=${beat.id} STRICT: removed ${result.check.groundingFaults.length - check.groundingFaults.length} ungrounded text element(s)`);
    return { ...result, code: stripped, check, trail: `${result.trail}${result.trail ? " -> " : ""}stripped` };
  };

  if (chosen?.passed) {
    /**
     * Refine the winning board — the path most boards take once a candidate passes.
     *
     * The loop was originally placed only on the ACCEPT_BEST path, where sub-floor boards land.
     * A quality pass that only runs on the failure path is a quality pass that stops running
     * exactly when the pipeline starts working.
     */
    const refined = await refine(chosen.verdict.code, chosen.verdict);
    totalCostUsd += refined.costUsd;
    shippedCheck = refined.check;
    op.code = refined.code;
    // IDs only — the browser resolves them to markup via /api/animation-assets. See the op type.
    op.assetIds = assetsUsedBy(refined.code, assets);
    op.status = "ready";
    op.error = undefined;
    if (chosenLog) chosenLog.outcome = "shipped";
    return finish({ costUsd: totalCostUsd, filled: true }, "shipped", refined.score, refined.trail);
  }

  // ACCEPT_BEST: no candidate cleared the full floor, but the best runnable one ships rather than the
  // "unavailable" card — a real, slightly-below-floor animation beats no animation.
  if (chosen) {
    if (chosenLog) chosenLog.outcome = `chosen as best available (${chosenLog.outcome})`;
    // requireQuality:false — the candidate already transpiles; ship it even though it's below the
    // quality floor, rather than discarding to "unavailable".
    const validated = sanitizeReactAnimationOp({ ...op, code: chosen.verdict.code }, { requireQuality: false, abstract, sourceFaithful: strict });
    if (validated.code) {
      op.code = validated.code;
      op.assetIds = assetsUsedBy(validated.code, assets);
      op.status = "ready";
      op.error = undefined;
      console.error(`[anim] beat=${beat.id} accepted best candidate (score=${chosen.verdict.score}) of ${attemptsMade}.`);

      /**
       * CREATE -> CRITIQUE -> IMPROVE -> REPEAT, on the board that is about to ship.
       *
       * Runs against a reference standard rather than "recognizable", because a board can be
       * plainly identifiable and still be an outline with a messy annotation cluster — one such
       * scored 5/5 from the recognizability critic while visibly falling short. Round 0 starts from
       * the faults the gates already measured on this candidate (see refineUntilGood).
       */
      const refinedBest = await enforceGrounding(await refine(validated.code, chosen.verdict));
      totalCostUsd += refinedBest.costUsd;
      shippedCheck = refinedBest.check;
      op.code = refinedBest.code;
      op.assetIds = assetsUsedBy(refinedBest.code, assets);
      validated.code = refinedBest.code;

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
       * the exact compromise the fallback chain exists to make unnecessary. (Memoised: when the refine
       * loop left the board unchanged and the critic already judged it, this costs nothing.)
       */
      if (shapeGated) {
        const shipped = await shapeCritique(validated.code);
        totalCostUsd += shipped.costUsd;
        if (shipped.score !== null && !shipped.ok) {
          console.error(
            `[anim] beat=${beat.id} REFUSED sub-floor board scored ${shipped.score}/5 — ${shipped.issue ?? "below the recognisability floor"}. Falling back to another engine.`,
          );
          op.code = undefined;
          op.assetIds = undefined;
          op.status = "failed";
          op.error = shipped.issue ?? `board scored ${shipped.score}/5 for recognisability`;
          return finish({ costUsd: totalCostUsd, filled: false, issue: op.error }, "refused", refinedBest.score ?? shipped.score, refinedBest.trail);
        }
        console.error(
          `[anim] beat=${beat.id} SHIPPED sub-floor board scored ${shipped.score ?? "not scored"}/5` +
            (shipped.issue ? ` — ${shipped.issue}` : ""),
        );
        return finish({ costUsd: totalCostUsd, filled: true }, "sub-floor", refinedBest.score ?? shipped.score, refinedBest.trail);
      }
      return finish({ costUsd: totalCostUsd, filled: true }, "sub-floor", refinedBest.score, refinedBest.trail);
    }
  }

  // Truly nothing runnable — leave op.code unset; the client shows the animation-unavailable state.
  op.code = undefined;
  op.status = "failed";
  op.error = previousFailure?.issue ?? "animation code was not generated";
  console.error(`[anim] beat=${beat.id} model=${choice.model} GAVE UP after ${attemptsMade} candidates. final issue: ${op.error}`);
  return finish({ costUsd: totalCostUsd, filled: false, issue: previousFailure?.issue ?? "animation code was not generated" }, "failed", null);
}

/** How the shipped board's rendered layout came out, for the trial log. */
function layoutOutcome(layout: LayoutCritique): "clean" | "fault" | "unmeasured" | "render-failed" {
  if (layout.unmeasured === "component") return "render-failed";
  if (!layout.measured) return "unmeasured";
  return layout.ok ? "clean" : "fault";
}

/**
 * Fills each "reactAnimation" op placeholder in the beats with generated component source.
 * Returns the total generation cost in USD. Runs entirely in parallel with fillImageOps at the
 * call site (disjoint beats, both I/O-bound) — see app/api/generate-lecture/route.ts.
 */
export type ReactAnimationFillOptions = {
  limit?: number;
  /**
   * Rotation position of the first board, when the caller passes a slice of a lecture (the
   * progressive worker fills one beat at a time and passes its beat position). Only used for model
   * rotation.
   */
  animationIndexOffset?: number;
  /** Pin every board to one model (the head-to-head comparison script). */
  model?: AnimationModel | null;
  /**
   * Override the refine loop's wall-clock budget for these boards.
   *
   * Exists for the OPENING beats of a progressive lecture. Nothing plays until they are enriched,
   * so their refine time is time the student spends watching a spinner — whereas every later beat
   * is built behind a beat that is already playing, where the full budget costs nobody anything.
   * The loop keeps the best-scoring board it found when the clock runs out, so a tighter budget
   * lowers the ceiling on polish rather than risking an empty board.
   */
  refineTimeBudgetMs?: number;
  /**
   * Each beat's own source, keyed by beat id (lib/sourceGrounding.ts): its text, its figure's labels
   * verbatim, the caption, the fidelity flag, and optionally the figure itself.
   *
   * WHY THIS EXISTS. Strict source mode never reached the board: the generator saw a title, the
   * narration and a 700-character brief, so a strict lesson on a textbook's "Energy transfer"
   * paragraph drew an invented leaf with invented labels while its source printed a labelled
   * palisade cell. With a source here the board is planned from it (caption + labels), prompted with
   * it, and — in strict mode — every written word is checked against it on every candidate and every
   * revision. A Map is accepted as well as a plain record.
   */
  sourceByBeatId?: Record<string, BeatSourceGrounding> | ReadonlyMap<string, BeatSourceGrounding>;
  /**
   * True for a board the student is WAITING on (the opening beats of a progressive lecture): the
   * refine loop makes no model call at all for it.
   *
   * WHY A FLAG AND NOT JUST A SMALLER BUDGET. The classifier fix turns the shape critic and refine
   * loop back on for beats a bug had been exempting (a "Photosynthesis" opener was misfiled as
   * abstract in 6 of 6 runs and shipped with no check at all). Left alone, that fix would ADD a
   * repair call to the very boards the lecture's start waits on. With this flag the opening boards
   * get every free gate — measured layout, label timing, source grounding, candidate ranking — plus
   * the one shape look they already paid for, and nothing that makes the student wait longer.
   * Later beats, built while an earlier one plays, keep the refine loop.
   */
  blocksPlayback?: boolean;
  /**
   * The lecture these boards belong to, so picture boards remember what it has already pictured
   * (lib/lecturePictures.ts): a subtopic's later passes build on its picture, and no new subtopic
   * pictures the same thing again. The progressive worker passes its session and the pictures its
   * saved boards carry; without it, the boards of one call share a memory.
   */
  lecture?: LectureMemoryOption;
};

/** Fewer readable content words than this, and a source cannot ground a board (see sourceForBeat). */
const MIN_SOURCE_CONTENT_WORDS = 5;

/** The beat's source from either shape of `sourceByBeatId`, if it is well-formed. */
export function sourceForBeat(
  sources: ReactAnimationFillOptions["sourceByBeatId"],
  beatId: string,
): BeatSourceGrounding | undefined {
  if (!sources) return undefined;
  const found = sources instanceof Map
    ? sources.get(beatId)
    : Object.prototype.hasOwnProperty.call(sources, beatId)
      ? (sources as Record<string, BeatSourceGrounding>)[beatId]
      : undefined;
  if (!found || typeof found.text !== "string") return undefined;
  /*
   * A source with no readable words — a scanned page whose text layer is empty — cannot ground
   * anything: every word on the board would count as invented and be deleted, leaving a board with
   * no labels at all. Such a beat is drawn from its narration as before (its script is written from
   * the page images upstream) rather than stripped bare by a check that has nothing to check against.
   */
  const words = contentStems([found.text, ...(Array.isArray(found.labels) ? found.labels : []), found.caption ?? ""].join(" "));
  if (words.length < MIN_SOURCE_CONTENT_WORDS) {
    console.error(`[anim] beat=${beatId} source has ${words.length} readable content words; drawing from the narration instead of grounding against it`);
    return undefined;
  }
  return {
    text: found.text,
    labels: Array.isArray(found.labels)
      ? (found.labels as unknown[]).filter((label): label is string => typeof label === "string" && label.trim().length > 0).map((label) => label.trim())
      : [],
    caption: typeof found.caption === "string" && found.caption.trim() ? found.caption.trim() : undefined,
    strict: found.strict === true,
    figureImage: typeof found.figureImage === "string" && found.figureImage.startsWith("data:image/") ? found.figureImage : undefined,
  };
}

export async function fillReactAnimationOps(
  client: OpenAI,
  beats: Beat[],
  options: ReactAnimationFillOptions = {},
): Promise<ReactAnimationFillStats> {
  return fillReactAnimationOpsIncremental(client, beats, undefined, options);
}

export async function fillReactAnimationOpsIncremental(
  client: OpenAI,
  beats: Beat[],
  onUpdate?: (update: ReactAnimationFillUpdate) => void | Promise<void>,
  options: ReactAnimationFillOptions = {}
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

  // Rotation counts ANIMATED beats, not all beats: rotating on the plain beat index could hand every
  // animated beat in a lecture to the same model whenever they fell three beats apart.
  const animationOrder = new Map(pending.map((entry, order) => [entry.op, order]));
  const lecture: LectureMemoryOption = options.lecture ?? { key: `call:${randomUUID()}` };
  const results = await Promise.all(selected.map(async ({ op, beat, beatIndex }) => {
    const contestant = options.model !== undefined
      ? options.model
      : animationModelForBeat((options.animationIndexOffset ?? 0) + (animationOrder.get(op) ?? 0));
    const source = sourceForBeat(options.sourceByBeatId, beat.id);
    /*
     * A picturable subject is PICTURED first (lib/illustratedBoard.ts): a textbook illustration with
     * key notes and writing laid out deterministically. It declines what cannot be pictured and
     * source-grounded beats, and anything that fails falls through to the Motion board generator.
     */
    const illustrated = await generateIllustratedBoard(client, op, beat, {
      abstract: isAbstractTopic(op, beat, source),
      hasSource: Boolean(source),
      lecture,
    });
    const result = illustrated ?? await generateOne(
      client,
      op,
      beat,
      contestant,
      options.refineTimeBudgetMs,
      source,
      options.blocksPlayback === true,
    );
    await onUpdate?.({ beat, beatIndex, costUsd: result.costUsd, status: result.filled ? "ready" : "failed" });
    return result;
  }));
  const filled = results.filter((result) => result.filled).length;
  return {
    costUsd: results.reduce((sum, result) => sum + result.costUsd, 0),
    pending: selected.length,
    filled,
    rejected: selected.length - filled,
    timings: results.flatMap((result) => (result.timing ? [result.timing] : [])),
    issues: results
      .filter((result) => !result.filled && result.issue)
      .map((result) => result.issue as string)
      .slice(0, 5),
  };
}
