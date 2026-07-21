import OpenAI from "openai";
import type { Beat } from "./lessonContent";
import { REACT_ANIMATION_SYSTEM_PROMPT } from "./drawPrompt";
import {
  getReactAnimationCodeDiagnostics,
  sanitizeReactAnimationOp,
  type ReactAnimationCodeDiagnostics,
  type ReactAnimationOp,
} from "./drawSanitize";

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
const MAX_TOKENS = Math.max(3_000, Math.min(20_000, Number(process.env.OPENAI_ANIMATION_MAX_TOKENS ?? 12_000)));
const MAX_ATTEMPTS = Math.max(1, Math.min(6, Number(process.env.OPENAI_ANIMATION_ATTEMPTS ?? 5)));

// Cost estimate uses the same gpt-4o-era rates as generate-lecture; override models may differ.
const INPUT_PRICE = 2.50 / 1_000_000;
const OUTPUT_PRICE = 10.0 / 1_000_000;

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

function costUsd(usage: OpenAI.Chat.Completions.ChatCompletion["usage"] | undefined): number {
  return usage ? usage.prompt_tokens * INPUT_PRICE + usage.completion_tokens * OUTPUT_PRICE : 0;
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
  /** True when this attempt's primitiveScore/objectPrimitiveScore barely moved (or regressed)
   *  versus the attempt before it — signals the model is repeating itself instead of closing
   *  the gap, and needs a more forceful instruction than another generic "add more" nudge. */
  stalled: boolean;
};

function diagnosticsSummary(diagnostics: ReactAnimationCodeDiagnostics): string {
  return [
    `groups=${diagnostics.groupCount}/5+`,
    `primitiveScore=${diagnostics.primitiveScore}/18+`,
    `primitiveTags=${diagnostics.primitiveTagCount}`,
    `objectPrimitives=${diagnostics.objectPrimitiveScore}/12+`,
    `silhouettes=${diagnostics.silhouetteCount}/1+`,
    `primitiveTypes=${diagnostics.distinctPrimitiveTypes}/4+`,
    `progressRefs=${diagnostics.progressRefs}`,
    `progressDriveScore=${diagnostics.progressDriveScore}/14+`,
    `lineLike=${diagnostics.lineLikeCount}`,
    `text=${diagnostics.textCount}`,
    `fills=bright:${diagnostics.brightFillCount}/dark:${diagnostics.darkFillCount}`,
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
  if (diagnostics.primitiveScore < 18) gaps.push(`${18 - diagnostics.primitiveScore} more real drawn SVG tags — actual meaningful shapes, not decorative filler clusters (currently ${diagnostics.primitiveScore}, need 18+)`);
  if (diagnostics.objectPrimitiveScore < 12) gaps.push(`${12 - diagnostics.objectPrimitiveScore} more object/body primitives — more path/rect/circle/ellipse/polygon shapes forming the mechanism's actual parts (currently ${diagnostics.objectPrimitiveScore}, need 12+)`);
  if (diagnostics.silhouetteCount < 1) gaps.push("at least one path/polygon/ellipse silhouette or cutaway shape (currently 0)");
  if (diagnostics.distinctPrimitiveTypes < 4) gaps.push(`${4 - diagnostics.distinctPrimitiveTypes} more distinct SVG primitive type(s) — mix path/circle/rect/ellipse/polygon, not just one or two kinds (currently ${diagnostics.distinctPrimitiveTypes}, need 4+)`);
  if (diagnostics.progressDriveScore < 14) gaps.push(`${14 - diagnostics.progressDriveScore} more progress-drive score — more lerp/clamp/phase-derived variables actually referenced in the JSX bindings (currently ${diagnostics.progressDriveScore}, need 14+)`);
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

function buildUserPrompt(op: ReactAnimationOp, beat: Beat, previousFailure?: PreviousFailure): string {
  const isSuprnotesWhiteboard = (op.teachingPoint ?? "").includes("SUPRNOTES_WHITEBOARD_SVG_BOARD");
  if (isSuprnotesWhiteboard) {
    const whiteboardContract =
      "SUPRNOTES WHITEBOARD MODE: create a mostly STATIC, full-board WHITE SVG teaching board, like a polished handwritten science whiteboard. Override the default dark-board style: the component itself must render a white/off-white background (#ffffff or #fbfbf8), soft gray handwritten-looking headings, and colored marker-style diagrams. Use SVG primitives directly: path, circle, ellipse, rect, polygon, line, polyline, text. This is not a loading animation and not a generic flowchart. Use a more realistic textbook-sketch approach: real object/structure silhouettes, correct subject parts, and believable arrows/forces/particles, not abstract UI pills.";
    const contentContract =
      "CONTENT QUALITY: ground every visible label and diagram element in the Suprnotes source text below. Do not invent random words. Do not make generic circles/bubbles unless they represent a real atom, particle, molecule, ion, object, or table cell named by the notes. Prefer subject-specific visuals: molecular/structural sketches, before/after panels, annotated diagrams, comparison tables, arrows showing actual cause/effect, and short labels copied or tightly paraphrased from the notes. For chemistry properties, draw realistic/simple lab-style objects where appropriate: beakers, water/oil layers, dissolved ions, solid crystals, electrodes, molecule dipoles, or force arrows. The visual must make the exact source concept visible without reading the narration.";
    const layoutContract =
      "LAYOUT: use a clean two-zone teacher whiteboard composition. Do NOT use title pills, floating translucent label cards, or labels on top of the molecule/diagram. Title is plain handwritten text centered at y 52-78. Left notes zone: x 95-420, y 150-405, max 3 stacked short labels. Main visual zone: x 560-845, y 155-405, one large chemistry drawing. Keep a clear gutter from x 430-535. Optional formula/comparison strip may use x 210-790, y 455-500. Keep a 95px safe margin on every side. All text must fit fully inside the SVG; no ellipses, no clipping, no labels behind other labels. Use at most 5 text labels total, each <= 22 characters. Before placing text, estimate its bounding box (width≈0.58*fontSize*chars, height≈1.35*fontSize) and ensure it does not intersect any other label or visual object. Use fontFamily: 'Chalkboard SE, Marker Felt, Bradley Hand, Comic Sans MS, Trebuchet MS, sans-serif' on every text element. If a source sentence is long, convert it into a compact diagram label plus a short note. Do not place a big transcript paragraph on the board.";
    const animationContract =
      "ANIMATION VISIBILITY: progress must feel like a marker/teacher writing on the board, not a slide fade. Do not make text slowly fade from opacity 0 over several seconds. When a text label's phase begins, make it readable immediately (opacity 1) and, if you animate it, use a quick clip-path/strokeDashoffset/write-on effect under 500ms. Use 4 phases: phase 1 writes title/left notes, phase 2 draws the main atoms/object with strokeDashoffset, phase 3 moves electrons/arrows/forces clearly across the board, phase 4 reveals the final state/highlight. At least two major visual elements must change position, strokeDashoffset, or scale using progress-derived values. The moving electron/arrow path must be visible at normal playback speed.";
    const implementationContract =
      "IMPLEMENTATION: export default function Animation({ progress }) exactly. You may use progress only for subtle draw-in/fade/arrow movement; the board should already be understandable as a static SVG. Include at least 18 meaningful SVG primitive tags and at least 5 <g> groups, but avoid decorative filler. Use inline SVG only, no external assets.";

    return [
      `Beat title: ${beat.title}`,
      `Spoken script: ${beat.script}`,
      `Whiteboard source brief:\n${op.teachingPoint}`,
      whiteboardContract,
      contentContract,
      layoutContract,
      animationContract,
      implementationContract,
      previousFailure
        ? [
            `The previous generated component was rejected because: ${previousFailure.issue}.`,
            `Validator metrics for the rejected source: ${diagnosticsSummary(previousFailure.diagnostics)}`,
            gapInstruction(previousFailure.diagnostics),
            "Rewrite the whiteboard SVG from scratch while preserving the source facts. Fix validation by adding meaningful subject-specific diagram parts, not filler dots or decorative blobs.",
            "Rejected source for diagnosis only:",
            "```jsx",
            codeExcerpt(previousFailure.code),
            "```",
          ].join("\n")
        : "Generate the whiteboard SVG component now. Return only one fenced jsx code block.",
    ].filter(Boolean).join("\n\n");
  }

  const sceneContract =
    "Quality contract: create a full-board mini scene with grouped layers: setting/background, main subject/object, internal parts or stages, moving agents/particles/materials, visible cause/effect path, and final changed state. The validator rejects line diagrams, endpoint labels connected by paths, text-heavy slides, and sparse SVGs.";
  const validatorChecklist =
    "Hard validator checklist (these are FLOORS, not targets — stop once cleared): include 5+ <g> groups; 18+ drawn SVG primitive tags total across path/circle/rect/ellipse/polygon/polyline/line/text; 12+ object/body primitives across path/rect/circle/ellipse/polygon; at least one silhouette or cutaway shape using path, polygon, or ellipse; at least 4 primitive tag types; strong progress-driven motion via progress-derived phase variables, lerp/clamp calls, and animated bindings; labels must support the scene, not dominate it. Build the physical scene first, then add only as much extra detail as genuinely helps teach the mechanism — do not keep adding shapes past that point.";
  const implementationPattern =
    "Implementation pattern: use explicit scene groups named in comments or aria-labels: background, apparatus/body, internal-parts, moving-agents, energy-or-material-paths, result-state, labels. Keep it SIMPLE: prefer one well-drawn subject with a few clearly meaningful moving parts. Only use arrays/maps for something that is genuinely a real repeated agent (e.g. particles actually traveling along a path) — never as a way to make a sub-component 'look detailed' with a decorative cluster of dots. Build the central subject as a solid, clearly-shaped object with a few visible internal parts before adding arrows/trails — not every named part needs its own internal ornamentation.";

  return [
    `Beat title: ${beat.title}`,
    `Spoken script: ${beat.script}`,
    `Teaching point to visualize: ${op.teachingPoint ?? beat.title}`,
    sceneContract,
    validatorChecklist,
    implementationPattern,
    previousFailure
      ? [
          `The previous generated component was rejected because: ${previousFailure.issue}.`,
          `Validator metrics for the rejected source: ${diagnosticsSummary(previousFailure.diagnostics)}`,
          gapInstruction(previousFailure.diagnostics),
          previousFailure.stalled
            ? "STALL WARNING: your last two attempts barely changed these numbers — you are repeating the same scene instead of growing it. Do not tweak the existing shapes. Add an ENTIRELY NEW visual layer the previous attempts did not have: e.g. a second repeated particle/agent group (5+ mapped instances), a background texture layer (grid/gradient/dots as multiple primitives), or a multi-part cutaway body for the main object with 4+ internal segments. The scene must look visually denser than before, not just numerically different."
            : "Rewrite from scratch as a denser physical/mechanistic scene that satisfies every validator number above. Do not merely rename labels or add one arrow. Add real topic-specific object bodies, background, internal parts, repeated moving agents, trails, gauges/material changes, and a changed result state. Preserve the exact export signature and sandbox rules.",
          "Rejected source for diagnosis only:",
          "```jsx",
          codeExcerpt(previousFailure.code),
          "```",
        ].join("\n")
      : "Make the first attempt pass: a setting, topic-specific objects, internal parts, multiple moving agents/groups, labels, and a clear before/during/after change driven by progress.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function generateOne(
  client: OpenAI,
  op: ReactAnimationOp,
  beat: Beat
): Promise<{ costUsd: number; filled: boolean; issue?: string }> {
  let totalCostUsd = 0;
  let previousFailure: PreviousFailure | undefined;

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
      // gpt-5.x models reject `max_tokens` (require `max_completion_tokens`); gpt-4.x/4o accept
      // `max_tokens`. Pick the right key from the model name so either family works.
      const tokenParam = /^(gpt-5|o[0-9])/.test(MODEL)
        ? { max_completion_tokens: MAX_TOKENS }
        : { max_tokens: MAX_TOKENS };
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: REACT_ANIMATION_SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(op, beat, previousFailure) },
        ],
        temperature,
        ...tokenParam,
      });
      totalCostUsd += costUsd(completion.usage);

      const raw = completion.choices[0]?.message?.content ?? "";
      const code = extractCodeFence(raw);
      const diagnostics = getReactAnimationCodeDiagnostics(code);
      const finishReason = completion.choices[0]?.finish_reason;
      // Always-on (not debug-gated): animation failures were invisible in production logs, so we
      // kept flying blind on why a beat showed "unavailable". One concise line per attempt.
      console.error(
        `[anim] beat=${beat.id} attempt=${attempt} finish=${finishReason} rawLen=${raw.length} codeLen=${code.length} issue=${diagnostics.issue ?? "OK"} | ${diagnosticsSummary(diagnostics)}`
      );
      if (diagnostics.issue) {
        const stalled = isStalled(previousFailure?.diagnostics, diagnostics);
        previousFailure = { issue: diagnostics.issue, diagnostics, code, stalled };
        continue;
      }

      // Density passed — now confirm it actually parses/transpiles before accepting, so a
      // syntactically broken component never reaches the browser to fail at render time.
      const parseError = await transpileCheck(code);
      if (parseError) {
        console.error(`[anim] beat=${beat.id} attempt=${attempt} PARSE FAIL: ${parseError}`);
        previousFailure = {
          issue: `the code did not parse: ${parseError}. Return ONLY valid JSX with no markdown fences and no TypeScript type annotations.`,
          diagnostics,
          code,
          stalled: false,
        };
        continue;
      }

      const validated = sanitizeReactAnimationOp({ ...op, code });
      if (validated.code) {
        op.code = validated.code;
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

  // Leave op.code unset; the client will show the animation-unavailable state for this beat.
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
