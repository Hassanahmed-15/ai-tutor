import OpenAI from "openai";
import { createElement, type ReactNode } from "react";
import type { Beat } from "./lessonContent";
import { ANIM_SANDBOX_RUNTIME } from "./anim/sandboxRuntime";

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
async function renderStaticFrame(code: string, assetRuntime?: string): Promise<string | null> {
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
    // The generated component calls the animation helpers the SANDBOX injects at runtime —
    // `phase`, `smooth`, `lagged`, `thereAndBack`, and friends. Without them every real board
    // threw "phase is not defined" here, renderStaticFrame returned null, and both critics
    // degraded to ok:true. The whole rendered-output quality layer was therefore silently inert
    // on every lecture ever generated, which is exactly how overlapping and clipped boards
    // reached the player. Prepending the same runtime the sandbox uses keeps the two in step.
    //
    // `assetRuntime` follows for the same reason: it defines <Asset/> and the artwork the board
    // places. Rendering without it would throw or silently drop the illustration, and the score
    // would then describe a picture the student never sees.
    const factory = new Function(
      "module",
      "exports",
      "require",
      "React",
      `${ANIM_SANDBOX_RUNTIME}\n${assetRuntime ?? ""}\n${transpiled}`,
    );
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

/**
 * `score: null` means NOT SCORED — the frame would not render, the rasteriser was missing, or the
 * vision call failed.
 *
 * This distinction is the whole reliability of the measurement. The previous version returned 5
 * for "no opinion", and in the lab that produced a flawless-looking 5.00/5 baseline across every
 * board while resvg was not even loading — confident numbers about work nobody had looked at. A
 * quality gate whose failure mode is "everything passes" is worse than no gate.
 *
 * `ok` still defaults to true when unscored: the critic must never block a beat over its own
 * inability to look.
 */
export type ShapeCritique = { ok: boolean; score: number | null; issue?: string; costUsd: number };

/* ── Layout critic ────────────────────────────────────────────────────────────
 * Geometry needs no vision model. The prompt already asks the model to reserve text as
 * {x,y,w,h} rectangles and keep them inside x=64..936 / y=122..500 without overlapping — it
 * simply does not comply, and nothing checked. Observed on a real Pythagoras board: a "3" and a
 * "c" printed on top of each other as "3c", and the final line "c² = 25 -> c = 5" clipped off the
 * bottom edge.
 *
 * So this measures the ACTUAL rendered frame instead of asking. It reuses renderStaticFrame (the
 * same transpile+render the shape critic uses) and applies the prompt's own width estimate to each
 * <text>. Deterministic, free, and — unlike the shape critic — meaningful for abstract boards,
 * which is exactly where it was missing.
 *
 * Deliberately conservative: it flags only unambiguous breakage (a box substantially outside the
 * frame, or two text boxes overlapping by more than a third of the smaller one), because a false
 * rejection costs a whole regeneration round.
 */
/**
 * The OUTER bound, deliberately not the content bound. The prompt gives two bands — title at
 * x=54..946 / y=30..104 and teaching content at x=64..936 / y=122..500 — so checking every text
 * against the content band alone rejected all four boards of a good lecture purely for having a
 * heading. This is the union plus a small tolerance: it still catches the real failure (a line
 * pushed off the bottom edge) without punishing a correctly placed title.
 */
const FRAME = { x0: 54, x1: 946, y0: 26, y1: 508 };

type TextBox = { text: string; x: number; y: number; w: number; h: number };

/** The prompt's own estimate: width = 0.62 * fontSize * chars, height = 1.35 * fontSize. */
function textBoxes(svg: string): TextBox[] {
  const boxes: TextBox[] = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const attrs = m[1];
    const content = m[2].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    if (!content) continue;
    const num = (name: string) => {
      const hit = new RegExp(name + '\\s*=\\s*"([-\\d.]+)"').exec(attrs);
      return hit ? Number(hit[1]) : null;
    };
    const x = num("x");
    const y = num("y");
    if (x === null || y === null) continue;
    const fs = num("font-size") ?? (/font-size:\s*([\d.]+)/.exec(attrs)?.[1] ? Number(/font-size:\s*([\d.]+)/.exec(attrs)![1]) : 16);
    const anchor = /text-anchor\s*=\s*"(middle|end)"/.exec(attrs)?.[1];
    const w = 0.62 * fs * content.length;
    const h = 1.35 * fs;
    // x is the anchor point, not the left edge; y is the baseline, not the top.
    const left = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    boxes.push({ text: content, x: left, y: y - h * 0.78, w, h });
  }
  return boxes;
}

function overlapArea(a: TextBox, b: TextBox): number {
  const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}

export type LayoutCritique = { ok: boolean; issue?: string };

/** Measures the rendered frame's text layout. Degrades to ok on any render failure, exactly like
 *  the shape critic — a bug in here must never block a lecture. */
export async function critiqueLayout(code: string, assetRuntime?: string): Promise<LayoutCritique> {
  if (!ENABLED) return { ok: true };
  const svg = await renderStaticFrame(code, assetRuntime);
  if (!svg) return { ok: true };
  const boxes = textBoxes(svg);
  if (boxes.length === 0) return { ok: true };

  const clipped = boxes.find(
    (b) => b.x < FRAME.x0 - 10 || b.x + b.w > FRAME.x1 + 10 || b.y < FRAME.y0 - 10 || b.y + b.h > FRAME.y1 + 10,
  );
  if (clipped) {
    return {
      ok: false,
      issue: `the text "${clipped.text.slice(0, 40)}" is outside the safe frame (measured x ${Math.round(clipped.x)}..${Math.round(clipped.x + clipped.w)}, y ${Math.round(clipped.y)}..${Math.round(clipped.y + clipped.h)}; allowed x ${FRAME.x0}..${FRAME.x1}, y ${FRAME.y0}..${FRAME.y1}), so it renders clipped by the board edge`,
    };
  }

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const area = overlapArea(a, b);
      if (area > 0.34 * Math.min(a.w * a.h, b.w * b.h)) {
        return {
          ok: false,
          issue: `the labels "${a.text.slice(0, 24)}" and "${b.text.slice(0, 24)}" are printed on top of each other (their boxes overlap), so they render as unreadable overlapping glyphs`,
        };
      }
    }
  }
  return { ok: true };
}

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
  assetRuntime?: string,
): Promise<ShapeCritique> {
  // Every one of these is "could not look", which is NOT the same claim as "looks perfect".
  if (!ENABLED) return { ok: true, score: null, costUsd: 0 };
  const svg = await renderStaticFrame(code, assetRuntime);
  if (!svg) return { ok: true, score: null, costUsd: 0 }; // couldn't render -> skip, don't block
  const png = await rasterize(svg);
  if (!png) return { ok: true, score: null, costUsd: 0 }; // rasterizer unavailable -> skip, don't block

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
    return { ok: true, score: null, costUsd: 0 };
  }
}

/* ── Refinement critic ────────────────────────────────────────────────────────
 * `critiqueShapeRecognizability` answers one question — does this read as the real subject — and
 * that is the right gate for REFUSING a board. It is the wrong input for IMPROVING one, for two
 * reasons measured here: it only fills `issue` when it rejects, so a 3/5 board yields no guidance
 * at all; and "recognizable" is a low bar, so a board with a messy annotation cluster scored 5/5
 * while visibly falling short of the reference standard.
 *
 * This scores against what actually separates a reference-quality board — internal structure,
 * labels joined to their parts, the drawing filling its box, nothing clipped — and always returns
 * defects, so the refiner has something concrete to act on even at 4/5.
 */
export type BoardDefect = { what: string; where: string; fix: string };
export type RefinementCritique = { score: number | null; defects: BoardDefect[]; costUsd: number };

const REFINE_SYSTEM_PROMPT = `You review a teaching whiteboard illustration and list what to fix. Output ONLY JSON:
{ "score": 1-5, "defects": [ { "what": string, "where": string, "fix": string } ] }

Score against a TEXTBOOK-QUALITY reference, not against "can I tell what it is":
5 = internal structure is drawn (cartilage rings, lobes, branching, chambers, layers), every label
    is joined by a leader line to a dot ON the part it names, the drawing fills its area, nothing
    is clipped or overlapping, and the annotation is clean.
4 = one clear shortcoming.
3 = recognizable but essentially an outline: the named internal parts are missing.
2 = generic shapes standing in for the subject (plain ovals, circles, bare lines).
1 = unrecognizable.

A board with NO internal structure cannot score above 3, however tidy it looks.

"defects": up to 4, most damaging first. Be specific and positional — "the leader dot for Axon sits
in blank space to the right of the drawing, not on the axon" and "the trachea is a plain tube with
no cartilage rings", never "labels are wrong" or "add more detail". "fix" must name the concrete
change to make. Return [] only when the board genuinely deserves 5.`;

export async function critiqueForRefinement(
  client: OpenAI,
  beat: Beat,
  code: string,
  subject: string,
  assetRuntime?: string,
): Promise<RefinementCritique> {
  // Same fail-open discipline as the other critics: "could not look" must never read as "perfect",
  // so a null score tells the loop to stop rather than to declare success.
  if (!ENABLED) return { score: null, defects: [], costUsd: 0 };
  const svg = await renderStaticFrame(code, assetRuntime);
  if (!svg) return { score: null, defects: [], costUsd: 0 };
  const png = await rasterize(svg);
  if (!png) return { score: null, defects: [], costUsd: 0 };

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: REFINE_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: `Beat: "${beat.title}". This board must depict: ${subject}.` },
            { type: "image_url", image_url: { url: png, detail: "high" } },
          ],
        },
      ],
      max_tokens: 700,
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
    const score = typeof parsed.score === "number" ? parsed.score : null;
    const defects = (Array.isArray(parsed.defects) ? parsed.defects : [])
      .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
      .map((d) => ({
        what: String(d.what ?? "").slice(0, 300),
        where: String(d.where ?? "").slice(0, 200),
        fix: String(d.fix ?? "").slice(0, 300),
      }))
      .filter((d) => d.what && d.fix)
      .slice(0, 4);
    return { score, defects, costUsd: costUsd(completion.usage) };
  } catch {
    return { score: null, defects: [], costUsd: 0 };
  }
}
