import OpenAI from "openai";
import { createElement, type ReactNode } from "react";
import type { Beat } from "./lessonContent";

/**
 * Vision-based shape-recognizability critic for generated `reactAnimation` whiteboard SVGs.
 *
 * The existing static analysis in drawSanitize.ts (getReactAnimationCodeDiagnostics) only counts
 * SVG primitive tags — it has no way to know whether the resulting shape actually READS as the
 * named real object (a leaf, a cell, an engine part) versus a pile of generic circles/rects that
 * technically clears the primitive-count floor. This critic renders the component's actual
 * progress=1 frame server-side and has a vision model LOOK at the real pixels and judge exactly
 * that one question, mirroring lib/boardVisionCritic.ts's rendered-output pattern (Clarix idea:
 * multimodal LLMs read images at far higher fidelity than any regex/structural heuristic).
 *
 * Rendering pipeline (all server-side, no browser): the same @babel/standalone transpile
 * reactAnimationGen.ts already runs for its parse-check compiles the JSX, then react-dom/server's
 * renderToStaticMarkup executes the resulting Animation({ progress: 1 }) component to a plain SVG
 * string (safe: the banned-pattern check in drawSanitize.ts already guarantees the code never
 * touches document/window/network/storage/timers, so this is a pure function of `progress`).
 * @resvg/resvg-js then rasterizes that SVG to a PNG for the vision call, exactly as the board critic
 * already does.
 *
 * Every stage degrades to { ok: true } on failure — a transpile error, a render throw, a missing
 * rasterizer, or a vision-call failure never blocks or fails a beat. This critic only ever REJECTS
 * a shape it positively judged unrecognizable, feeding a concrete revision instruction back into
 * reactAnimationGen.ts's existing retry loop (the same mechanism the text-based
 * AI_VISUAL_REVIEW_ENABLED review already uses) so a bad shape gets regenerated, never shipped.
 *
 * Env: REACT_ANIMATION_VISION_CRITIC=1 (default on). OPENAI_VISION_MODEL (default gpt-4o).
 */

const ENABLED = process.env.REACT_ANIMATION_VISION_CRITIC !== "0";
const MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-4o";
const REJECT_BELOW = Number(process.env.REACT_ANIMATION_VISION_MIN_SCORE ?? 3); // 1-5 scale
const INPUT_PRICE = 2.5 / 1_000_000;
const OUTPUT_PRICE = 10.0 / 1_000_000;

export function reactAnimationVisionCriticEnabled(): boolean {
  return ENABLED;
}

function costUsd(usage: OpenAI.Chat.Completions.ChatCompletion["usage"] | undefined): number {
  return usage ? usage.prompt_tokens * INPUT_PRICE + usage.completion_tokens * OUTPUT_PRICE : 0;
}

// Lazily loaded so a missing/incompatible native binary or Babel bundle degrades this critic to a
// no-op instead of crashing the generation route at import time (same defensive pattern
// boardVisionCritic.ts uses for @resvg/resvg-js).
let resvgMod: typeof import("@resvg/resvg-js") | null | undefined;
async function loadResvg(): Promise<typeof import("@resvg/resvg-js") | null> {
  if (resvgMod === undefined) {
    resvgMod = await import("@resvg/resvg-js").catch((e) => {
      console.error(`[anim-vision] resvg unavailable, critic disabled: ${e instanceof Error ? e.message : "import failed"}`);
      return null;
    });
  }
  return resvgMod;
}

let babelMod: typeof import("@babel/standalone") | null | undefined;
async function loadBabel(): Promise<typeof import("@babel/standalone") | null> {
  if (babelMod === undefined) {
    babelMod = await import("@babel/standalone").catch((e) => {
      console.error(`[anim-vision] babel unavailable, critic disabled: ${e instanceof Error ? e.message : "import failed"}`);
      return null;
    });
  }
  return babelMod;
}

/** Compile the generated JSX and execute it server-side to a static SVG string at progress=1 —
 *  the same finished-frame a student would see once the narration reaches the end of this beat.
 *  Returns null on any transpile/render failure rather than throwing, so the caller can skip the
 *  critic instead of blocking generation on a rendering bug in this file. */
async function renderStaticFrame(code: string): Promise<string | null> {
  try {
    const Babel = await loadBabel();
    if (!Babel) return null;
    const transpiled = Babel.transform(code, {
      presets: [["react", { runtime: "classic", pragma: "React.createElement", pragmaFrag: "React.Fragment" }]],
      plugins: ["transform-modules-commonjs"],
      filename: "animation.jsx",
    }).code;
    if (!transpiled) return null;

    // The transpiled source is CommonJS (`exports.default = Animation`); evaluate it with a
    // minimal require() that only ever needs to resolve "react" (Animation components have no
    // other imports — that's one of the banned-pattern checks drawSanitize.ts already enforces).
    // (Named `fakeModule`, not `module` — Next.js flags reassigning/shadowing the real Node
    // `module` binding, even though this scope is a local const, not the actual CJS module object.)
    const fakeModule = { exports: {} as { default?: (props: { progress: number }) => ReactNode } };
    const fakeRequire = (name: string) => {
      if (name === "react") return { createElement };
      throw new Error(`unexpected require("${name}") in generated animation code`);
    };
    const factory = new Function("module", "exports", "require", "React", transpiled);
    const ReactGlobal = { createElement };
    factory(fakeModule, fakeModule.exports, fakeRequire, ReactGlobal);
    const Animation = fakeModule.exports.default;
    if (typeof Animation !== "function") return null;

    // Dynamic import (not a static top-level one): Next.js's build-time analysis special-cases a
    // static `import ... from "react-dom/server"` as if this file were a Server Component about to
    // render one, which it isn't — this is a plain Node utility call inside a route handler. The
    // dynamic form sidesteps that trip-wire while still resolving to the same module at runtime.
    const { renderToStaticMarkup } = await import("react-dom/server");
    const element = createElement(Animation, { progress: 1 });
    return renderToStaticMarkup(element);
  } catch (err) {
    console.error(`[anim-vision] render failed: ${err instanceof Error ? err.message : "error"}`);
    return null;
  }
}

async function rasterize(svg: string): Promise<string | null> {
  try {
    const resvg = await loadResvg();
    if (!resvg) return null;
    const trimmed = svg.trim();
    // renderToStaticMarkup emits a bare `<svg viewBox="...">...</svg>` with no `xmlns` — browsers
    // don't need it inline, but resvg's standalone XML parser requires a real root namespace or it
    // refuses to parse the document at all ("does not have a root node"). Inject it whenever the
    // root tag is missing that attribute; wrap entirely (with a viewBox fallback) if the component
    // didn't even emit a root <svg> tag, so this is never a fatal condition for the critic.
    const isSvgRoot = /^<svg[\s>]/.test(trimmed);
    const hasXmlns = /^<svg[^>]*\bxmlns\s*=/.test(trimmed);
    const wrapped = !isSvgRoot
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 560">${trimmed}</svg>`
      : hasXmlns
        ? trimmed
        : trimmed.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    const r = new resvg.Resvg(wrapped, { fitTo: { mode: "width", value: 1000 } });
    const png = r.render().asPng();
    return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
  } catch (err) {
    console.error(`[anim-vision] rasterize failed: ${err instanceof Error ? err.message : "error"}`);
    return null;
  }
}

const SYSTEM_PROMPT =
  "You are a strict scientific illustrator reviewing a student teaching diagram. You are shown the " +
  "finished board. Judge ONLY whether the main subject is visually RECOGNIZABLE as the real thing " +
  "it claims to depict — not layout, not color, not text. Reply JSON: " +
  '{ "recognizable": boolean, "score": 1-5, "issue": string }. Score 5 = the subject is immediately ' +
  "recognizable as the real object/organism/mechanism named, with correct silhouette, proportions, " +
  "and part relationships — a person unfamiliar with the topic could still tell what it is. Lower the " +
  "score when the subject reads as generic shapes (interchangeable circles/rectangles/blobs standing " +
  "in for something specific), has the wrong silhouette or proportions for the named subject, or is " +
  'missing a defining recognizable feature. In "issue", name the SPECIFIC shape problem to fix (e.g. ' +
  "'the leaf is drawn as a plain oval with no lobes or veins, it reads as a circle not a leaf'); empty " +
  "string if score is 5.";

export type ShapeCritique = { ok: boolean; score: number; issue?: string; costUsd: number };

/**
 * Critique a single generated animation's finished shape. Returns ok=true (never blocks) unless
 * the vision model positively judges the subject unrecognizable, in which case ok=false with a
 * concrete issue to feed the retry loop in reactAnimationGen.ts.
 */
export async function critiqueShapeRecognizability(
  client: OpenAI,
  beat: Beat,
  code: string,
  subject: string,
): Promise<ShapeCritique> {
  if (!ENABLED) return { ok: true, score: 5, costUsd: 0 };
  const svg = await renderStaticFrame(code);
  if (!svg) return { ok: true, score: 5, costUsd: 0 }; // couldn't render -> skip, don't block
  const png = await rasterize(svg);
  if (!png) return { ok: true, score: 5, costUsd: 0 }; // rasterizer unavailable -> skip, don't block

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: `Beat: "${beat.title}". This diagram must depict: ${subject}. Judge only shape recognizability.` },
            { type: "image_url", image_url: { url: png, detail: "low" } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });
    const cost = costUsd(completion.usage);
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
    const score = typeof parsed.score === "number" ? parsed.score : 5;
    const issue = typeof parsed.issue === "string" ? parsed.issue.trim() : "";
    const ok = parsed.recognizable !== false && score >= REJECT_BELOW;
    if (!ok) console.error(`[anim-vision] beat=${beat.id} score=${score} REJECT: ${issue}`);
    else console.error(`[anim-vision] beat=${beat.id} score=${score} OK`);
    return {
      ok,
      score,
      issue: ok ? undefined : issue || `the ${subject} does not read as recognizable; rebuild its silhouette to match the real subject`,
      costUsd: cost,
    };
  } catch (err) {
    console.error(`[anim-vision] beat=${beat.id} critic failed (skipping): ${err instanceof Error ? err.message : "error"}`);
    return { ok: true, score: 5, costUsd: 0 };
  }
}
