import OpenAI from "openai";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appPath } from "./appPaths";
import * as ReactModule from "react";
import { createElement, Fragment, type ReactNode } from "react";
import type { Beat } from "./lessonContent";
import { ANIM_SANDBOX_RUNTIME } from "./anim/sandboxRuntime";
import { BOARD_LABELS_SOURCE, FINISHED_BOARD_PROPS, MOTION_MODULE_NAMES, STATIC_MOTION_SOURCE } from "./anim/sandboxMotion";
import { BOARD_FONT_FACES, BOARD_HEADING_WEIGHT } from "./anim/boardFont";
import { costFor } from "./modelPricing";
import { labelIsGrounded, sourceVocabulary, ungroundedTerms, type BeatSourceGrounding } from "./sourceGrounding";
import {
  arrowheadOnLabelIssue,
  connectorCrossingIssue,
  connectorEndIssues,
  readBoardGeometry,
  strokeSegments,
  textBoxesInBoardSpace,
} from "./boardConnectorGeometry";

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
 * The vision critics degrade to "not scored" when THIS SERVER cannot look (no rasterizer, a failed
 * vision call) — that never blocks a beat. What no longer degrades silently is a board whose own
 * code throws: the render now has the whole of React (fragments, hooks), so a throw here is a throw
 * in the student's sandbox too, and critiqueLayout reports it as a fault (`unmeasured: "component"`)
 * instead of the old `{ ok: true }`. The shape critic only ever REJECTS a shape it judged
 * unrecognizable (or could not score and did not call recognizable), feeding a concrete revision
 * instruction back into reactAnimationGen.ts.
 *
 * Env: REACT_ANIMATION_VISION_CRITIC=1 (default on). OPENAI_VISION_MODEL (default gpt-4o).
 */

const ENABLED = process.env.REACT_ANIMATION_VISION_CRITIC !== "0";
const MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-4o";
const REJECT_BELOW = Number(process.env.REACT_ANIMATION_VISION_MIN_SCORE ?? 3); // 1-5 scale

export function reactAnimationVisionCriticEnabled(): boolean {
  return ENABLED;
}

function costUsd(usage: OpenAI.Chat.Completions.ChatCompletion["usage"] | undefined): number {
  return costFor(MODEL, usage);
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

/**
 * Hooks for a ONE-SHOT static render, independent of whichever React instance the bundler hands us.
 *
 * WHY NOT JUST THE REAL HOOKS. The frame is rendered once, at progress=1, and nothing ever updates
 * it — so every hook has a single correct answer that needs no dispatcher: a memo is its factory's
 * value, state is its initial value, an effect never runs (it would not run in a server render
 * either). Using the real hooks would tie this render to the `react` and `react-dom/server` modules
 * being the SAME instance, which a Next.js route bundle does not promise (it may resolve `react` to
 * the react-server build, which does not even export useState). A hook that throws "Invalid hook
 * call" here is exactly the silent fail-open this module exists to stop.
 */
function staticHooks() {
  const noop = () => {};
  let idCounter = 0;
  return {
    useState: <T,>(init: T | (() => T)) => [typeof init === "function" ? (init as () => T)() : init, noop] as const,
    useReducer: <T, A>(_reducer: unknown, initArg: A, init?: (arg: A) => T) => [init ? init(initArg) : initArg, noop] as const,
    useMemo: <T,>(factory: () => T) => factory(),
    useCallback: <T,>(fn: T) => fn,
    useRef: <T,>(initial: T) => ({ current: initial }),
    useEffect: noop,
    useLayoutEffect: noop,
    useInsertionEffect: noop,
    useImperativeHandle: noop,
    useDebugValue: noop,
    useId: () => `r${(idCounter += 1)}`,
    // react-dom/server renders as React's SECONDARY renderer: a Provider's value lives on
    // _currentValue2 (checked against react-dom-server-legacy's own readContext).
    useContext: (context: { _currentValue?: unknown; _currentValue2?: unknown } | null | undefined) =>
      context ? ("_currentValue2" in context ? context._currentValue2 : context._currentValue) : undefined,
    useTransition: () => [false, (fn: () => void) => fn()] as const,
    useDeferredValue: <T,>(value: T) => value,
    useSyncExternalStore: <T,>(_subscribe: unknown, getSnapshot: () => T, getServerSnapshot?: () => T) =>
      (getServerSnapshot ?? getSnapshot)(),
  };
}

/**
 * The React a generated board sees on the server: the real module (Fragment, memo, forwardRef,
 * Children, cloneElement…) with the static hooks above laid over it.
 *
 * THE BUG THIS REPLACES. The render used to receive `{ createElement }` and nothing else, while the
 * student's sandbox has the whole of React. So any board that wrote `<>…</>`, `<React.Fragment>` or
 * `React.useMemo` — ordinary JSX — threw "Element type is invalid" or "useMemo is not a function"
 * HERE, the render returned null, and every rendered-output gate reported ok: the layout check, the
 * label check, both vision critics. Those boards reached students with no overlap, clipping,
 * dangling-arrow or recognisability check at all, and nothing said so.
 */
function serverReact(base: object = ReactModule): Record<string, unknown> {
  const react = base as Record<string, unknown>;
  return {
    ...react,
    createElement: react.createElement ?? createElement,
    Fragment: react.Fragment ?? Fragment,
    // The react-server build Next.js hands a route handler has no createContext at all.
    createContext: react.createContext ?? staticCreateContext,
    ...staticHooks(),
  };
}

/**
 * A context object the server renderer understands, for when the bundled React lacks createContext
 * (React 19 shape: the context is its own Provider; react-dom/server keeps the value on
 * _currentValue2, which staticHooks().useContext reads).
 */
function staticCreateContext<T>(defaultValue: T) {
  const context: Record<string, unknown> = {
    $$typeof: Symbol.for("react.context"),
    _currentValue: defaultValue,
    _currentValue2: defaultValue,
    _threadCount: 0,
  };
  context.Provider = context;
  context.Consumer = { $$typeof: Symbol.for("react.consumer"), _context: context };
  return context;
}

/**
 * The outcome of rendering one board's finished frame.
 *
 * `failure.kind` distinguishes two failures that used to look identical:
 *   - "component": the board itself threw (a ReferenceError, a bad element). It would throw in the
 *     student's sandbox too, so this is a fault in the board, not in the checker.
 *   - "environment": this server could not render at all (Babel unavailable, critics switched off).
 *     That says nothing about the board and must never count against it.
 */
export type RenderedFrame = { svg: string | null; failure?: { kind: "component" | "environment"; message: string } };

/**
 * One render per board, shared by every check that needs it.
 *
 * The layout check, the label-grounding check, the shape critic and the refinement critic all look
 * at the same finished frame of the same code — and each used to transpile and render it again.
 * Caching by content keeps the checks exactly as they were and removes the repeats (the promise is
 * cached, so checks that start together share one render). Small and bounded: a board's candidates
 * and revisions are the only keys that are ever looked up twice.
 */
const FRAME_CACHE_LIMIT = 24;
const frameCache = new Map<string, Promise<RenderedFrame>>();
const pngCache = new Map<string, Promise<string | null>>();

function frameKey(code: string, assetRuntime?: string): string {
  return createHash("sha1").update(code).update("\u0000").update(assetRuntime ?? "").digest("hex");
}

function remember<T>(cache: Map<string, T>, key: string, value: T): T {
  cache.set(key, value);
  while (cache.size > FRAME_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return value;
}

/** The finished frame at progress=1, rendered at most once per (code, artwork) pair. */
export function renderFrame(code: string, assetRuntime?: string): Promise<RenderedFrame> {
  const key = frameKey(code, assetRuntime);
  const hit = frameCache.get(key);
  if (hit) return hit;
  return remember(frameCache, key, renderStaticFrame(code, assetRuntime));
}

/**
 * Compile the generated JSX and execute it server-side to a static SVG string at progress=1 —
 * the same finished-frame a student would see once the narration reaches the end of this beat.
 * Never throws: a failure comes back as `failure`, saying whose fault it was (see RenderedFrame).
 *
 * `base` is the React module the board is given. It is the imported one in production; tests pass
 * the react-server build, because that is what a Next.js route handler actually resolves `react` to
 * (no useState, no useRef, no createContext) — the case that plain Node never exercises.
 */
export async function renderStaticFrame(code: string, assetRuntime?: string, base: object = ReactModule): Promise<RenderedFrame> {
  const Babel = await loadBabel();
  if (!Babel) return { svg: null, failure: { kind: "environment", message: "babel unavailable" } };
  let transpiled: string | null | undefined;
  try {
    transpiled = Babel.transform(code, {
      presets: [["react", { runtime: "classic", pragma: "React.createElement", pragmaFrag: "React.Fragment" }]],
      plugins: ["transform-modules-commonjs"],
      filename: "animation.jsx",
    }).code;
  } catch (err) {
    return { svg: null, failure: { kind: "component", message: `did not parse: ${err instanceof Error ? err.message : "error"}` } };
  }
  if (!transpiled) return { svg: null, failure: { kind: "component", message: "transpiled to nothing" } };
  try {
    const React = serverReact(base);
    // The transpiled source is CommonJS (`exports.default = Animation`); evaluate it with a
    // require() that resolves exactly what the student's sandbox resolves (ReactAnimationSandbox's
    // own require shim): "react", "react-dom", and the jsx runtimes. Anything else throws there,
    // so it throws here.
    // (Named `fakeModule`, not `module` — Next.js flags reassigning/shadowing the real Node
    // `module` binding, even though this scope is a local const, not the actual CJS module object.)
    const fakeModule = { exports: {} as { default?: (props: { progress: number }) => ReactNode } };
    // Motion cannot run here, so each motion element renders settled at its `animate` target — the
    // frame the student's sandbox shows once the glide lands (lib/anim/sandboxMotion.ts).
    const motion = new Function("React", `${STATIC_MOTION_SOURCE}\nreturn staticMotion(React);`)(React);
    const fakeRequire = (name: string) => {
      if (name === "react") return React;
      if (name === "react-dom") return {};
      if (name === "react/jsx-runtime" || name === "react/jsx-dev-runtime") {
        return { jsx: createElement, jsxs: createElement, Fragment };
      }
      if (MOTION_MODULE_NAMES.includes(name)) return { motion };
      throw new Error(`Module not available in the board sandbox: ${name}`);
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
    //
    // The board's own code runs inside a BLOCK, as it does in the sandbox (its `try { … }`): a board
    // that declares its own `const motion` then shadows the library instead of colliding with it.
    const factory = new Function(
      "module",
      "exports",
      "require",
      "React",
      "__boardMotion",
      `${ANIM_SANDBOX_RUNTIME}\n${assetRuntime ?? ""}\nvar motion = __boardMotion;\n${BOARD_LABELS_SOURCE}\n{\n${transpiled}\n}`,
    );
    factory(fakeModule, fakeModule.exports, fakeRequire, React, motion);
    const Animation = fakeModule.exports.default;
    if (typeof Animation !== "function") {
      return { svg: null, failure: { kind: "component", message: "no default-exported Animation component" } };
    }

    // Dynamic import (not a static top-level one): Next.js's build-time analysis special-cases a
    // static `import ... from "react-dom/server"` as if this file were a Server Component about to
    // render one, which it isn't — this is a plain Node utility call inside a route handler. The
    // dynamic form sidesteps that trip-wire while still resolving to the same module at runtime.
    let renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
    try {
      ({ renderToStaticMarkup } = await import("react-dom/server"));
    } catch (err) {
      return { svg: null, failure: { kind: "environment", message: `react-dom/server unavailable: ${err instanceof Error ? err.message : "error"}` } };
    }
    // The finished frame: progress 1 for a timeline board, every sentence revealed for a Motion
    // board (a board ignores the props its contract does not use).
    const element = createElement(Animation as (props: typeof FINISHED_BOARD_PROPS) => ReactNode, FINISHED_BOARD_PROPS);
    return { svg: renderToStaticMarkup(element) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "error";
    console.error(`[anim-vision] render failed (the board itself threw): ${message}`);
    return { svg: null, failure: { kind: "component", message: message.slice(0, 240) } };
  }
}

const SVG_NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

/**
 * The exact document handed to resvg. Exported so tests exercise THIS string rather than one they
 * built themselves — see the comment in rasterize() for why that distinction mattered.
 *
 * renderToStaticMarkup emits a bare `<svg viewBox="...">` with no namespaces at all: browsers do not
 * need them inline, resvg refuses to parse without them.
 */
export function svgForRasterizer(markup: string): string {
  const trimmed = markup.trim();
  if (!/^<svg[\s>]/.test(trimmed)) {
    return `<svg ${SVG_NS} viewBox="0 0 1000 560">${trimmed}</svg>`;
  }
  // A root that already declares the default namespace may still be missing xlink, which is the
  // case that actually broke — so top it up rather than trusting the root wholesale.
  let out = trimmed;
  if (!/^<svg[^>]*\bxmlns\s*=/.test(out)) {
    out = out.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/^<svg[^>]*\bxmlns:xlink\s*=/.test(out)) {
    out = out.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }
  return out;
}

/**
 * The board font, for the rasteriser: the same TTFs the sandbox embeds (lib/anim/boardFont.ts), which
 * resvg can read. Without them resvg drew the critics' picture in whatever system font the server had —
 * on a Linux container, possibly none, so the vision critics judged boards whose labels were missing or
 * in a different face and width from the student's. Empty when the files are absent, in which case the
 * render falls back to system fonts exactly as before.
 */
const [BODY_FACE, HEADING_FACE] = BOARD_FONT_FACES;
let boardFontFiles: string[] | null = null;
export function rasterFontFiles(): string[] {
  if (!boardFontFiles) {
    boardFontFiles = BOARD_FONT_FACES
      .map((face) => appPath("public", "fonts", face.file))
      .filter((file) => existsSync(file));
  }
  return boardFontFiles;
}

/**
 * Every font-family on the frame replaced by the board font — what the sandbox's
 * `svg text { font-family: "Aria Board" … !important }` does in the browser, which resvg has no
 * stylesheet for. resvg cannot alias two families under one name, so each <text> is given the REAL
 * family of the face its weight selects: the heading face above weight 650, the body face otherwise.
 */
export function withBoardFont(svg: string): string {
  const body = BODY_FACE.family;
  return svg
    .replace(/font-family\s*=\s*"[^"]*"/g, `font-family="${body}"`)
    .replace(/font-family:\s*[^;"]+/g, `font-family:${body}`)
    .replace(/<text\b([^>]*)>/g, (tag, attrs: string) =>
      fontWeightOf(attrs) >= BOARD_HEADING_WEIGHT
        ? `<text${attrs.replace(/font-family\s*=\s*"[^"]*"/, "").replace(/font-family:\s*[^;"]+;?/, "")} font-family="${HEADING_FACE.family}">`
        : tag)
    .replace(/^<svg\b(?![^>]*\bfont-family=)/, `<svg font-family="${body}"`);
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
    /**
     * `xmlns:xlink` is declared here for a reason that cost a whole measured run to find.
     *
     * Catalogue artwork (lib/assetCatalogue.ts) legitimately contains `xlink:href`, and resvg's
     * standalone XML parser rejects the WHOLE document over an undeclared prefix:
     *   "SVG data parsing failed cause an unknown namespace prefix 'xlink'".
     * rasterize() then returns null, the critic reports "could not look", and — by design, so a
     * broken rasteriser never rejects good boards — the pipeline ships the board unjudged. So every
     * board that placed real artwork, the ones most worth checking, went out with no quality gate at
     * all and nothing said so. Measured: one of five fixtures scored `-1/5 $0.000`.
     *
     * The unit test did not catch it because it built its OWN wrapper with xmlns:xlink already
     * declared, so it exercised a string this function never produces. A test that vouches for code
     * it does not call is worth very little; it now calls svgForRasterizer directly.
     */
    const wrapped = svgForRasterizer(trimmed);
    const fontFiles = rasterFontFiles();
    const r = fontFiles.length
      ? new resvg.Resvg(withBoardFont(wrapped), {
          fitTo: { mode: "width", value: 1000 },
          font: { fontFiles, loadSystemFonts: true, defaultFontFamily: BODY_FACE.family },
        })
      : new resvg.Resvg(wrapped, { fitTo: { mode: "width", value: 1000 } });
    const png = r.render().asPng();
    return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
  } catch (err) {
    console.error(`[anim-vision] rasterize failed: ${err instanceof Error ? err.message : "error"}`);
    return null;
  }
}

/** The rasteriser, exported for tests: the PNG data URL for an SVG, or null when resvg cannot draw it. */
export function rasterizeForTest(svg: string): Promise<string | null> {
  return rasterize(svg);
}

/**
 * The finished frame as a PNG data URL, rendered and rasterised at most once per board — the shape
 * critic and the refinement critic look at the same picture, and the sub-floor path shows it to
 * both. Null when the frame cannot be rendered or rasterised ("could not look").
 */
async function framePng(code: string, assetRuntime?: string): Promise<{ png: string | null; frame: RenderedFrame }> {
  const frame = await renderFrame(code, assetRuntime);
  if (!frame.svg) return { png: null, frame };
  const key = frameKey(code, assetRuntime);
  const hit = pngCache.get(key);
  const png = await (hit ?? remember(pngCache, key, rasterize(frame.svg)));
  return { png, frame };
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
 * So this measures the ACTUAL rendered frame instead of asking. It reuses renderFrame (the same
 * cached transpile+render the critics use) and measures each <text> with the sandbox font's real
 * glyph widths. Deterministic, free, and — unlike the shape critic — meaningful for abstract
 * boards, which is exactly where it was missing.
 *
 * It flags only unambiguous breakage (a box outside the frame, glyphs that overprint), because a
 * false fault costs a refine round. A fault no longer costs a regeneration: it is handed to the
 * refiner as a concrete defect (lib/reactAnimationGen.ts).
 */
/**
 * The OUTER bound, deliberately not the content bound. The prompt (lib/drawPrompt.ts BOARD_PAGE_BLOCK)
 * gives two bands — the title block at y 30-114 and the content area at x 56-944 / y 128-512 — so
 * checking every text against the content band alone rejected all four boards of a good lecture
 * purely for having a heading. This is the union plus a small tolerance: it still catches the real
 * failure (a line pushed off the bottom edge) without punishing a correctly placed title.
 */
const FRAME = { x0: 54, x1: 946, y0: 26, y1: 508 };

/**
 * A written line on the frame. `y`/`h` span the font's full ink range (capitals to descenders), the
 * box the connector checks in lib/boardConnectorGeometry.ts expect — they shrink it before testing,
 * so it must not collapse for a word with no tall letters. `ink` is this line's OWN extent, used only
 * for text-on-text overlap, where two x-height words can sit closer than two words with descenders.
 */
type TextBox = { text: string; x: number; y: number; w: number; h: number; ink: { y: number; h: number } };

/**
 * MEASURED GLYPH WIDTHS, not a flat 0.62 em per character.
 *
 * The flat estimate came from the prompt and was never checked against the font the student sees;
 * real text runs 80-85% of it. The overstatement did damage in both directions: a source label such
 * as "chloroplast containing chlorophyll" was reported as clipped when it fitted, which pushes the
 * model to shorten or paraphrase the source's own words; and the padding hid real collisions,
 * because a box that big has to overlap a lot before a third of it is covered.
 *
 * The board font is Nunito SemiBold for weights up to 650 and Outfit ExtraBold above (lib/anim/
 * boardFont.ts), so these are THEIR advances — measured in Chromium from public/fonts/*.ttf — in thousandths of
 * an em, printable ASCII from U+0020. The symbols boards use are listed separately; anything else
 * counts as a full em. A 3% allowance covers kerning and hinting. Regenerate if the board font changes
 * (the measuring script renders "H<ch>H" minus "HH" per character with getComputedTextLength).
 */
const SEMIBOLD_ADVANCE = [
  264, 237, 417, 600, 600, 937, 708, 231, 336, 336, 452, 600, 237, 429, 237, 297, 600, 600, 600, 600, 600, 600, 600, 600,
  600, 600, 237, 237, 600, 600, 600, 450, 948, 736, 682, 676, 751, 589, 554, 731, 767, 268, 338, 643, 552, 861, 743, 775,
  642, 775, 677, 622, 611, 733, 700, 1107, 660, 631, 596, 333, 297, 333, 600, 500, 366, 537, 591, 467, 591, 537, 347, 594,
  576, 243, 246, 516, 306, 866, 576, 565, 591, 591, 373, 484, 365, 569, 520, 846, 534, 520, 468, 370, 275, 370, 600,
];
const EXTRABOLD_ADVANCE = [
  185, 297, 471, 673, 613, 698, 658, 254, 315, 315, 489, 571, 287, 463, 304, 420, 671, 390, 576, 569, 613, 568, 579, 530,
  569, 579, 300, 286, 571, 571, 571, 496, 766, 734, 650, 692, 761, 627, 602, 791, 739, 305, 550, 703, 567, 866, 748, 812,
  634, 828, 649, 582, 649, 708, 722, 1012, 710, 670, 617, 352, 376, 352, 474, 517, 338, 603, 603, 501, 603, 554, 452, 588,
  583, 275, 288, 563, 276, 879, 583, 582, 603, 603, 453, 471, 410, 550, 550, 800, 538, 541, 495, 349, 308, 349, 571,
];
const SYMBOL_ADVANCE: Record<string, number> = {
  "→": 1000, "←": 1000, "↑": 723, "↓": 723, "⇌": 1000, "²": 380, "³": 380, "₂": 380, "₆": 380, "·": 237, "°": 375, "–": 500, "—": 1000, "’": 237, "‘": 237, "“": 416, "”": 416, "×": 600, "÷": 600, "≈": 600, "≤": 600, "≥": 600, "µ": 600, "é": 537, "β": 556, "θ": 556, "Σ": 600, "∂": 600, "Δ": 737, "π": 602, "ŷ": 520, "−": 600,
};
const ADVANCE_ALLOWANCE = 1.03;

/** Width in px of one line of text at this font size and weight, from the measured tables above. */
export function measuredTextWidth(text: string, fontSize: number, fontWeight = 400): number {
  const table = fontWeight > 650 ? EXTRABOLD_ADVANCE : SEMIBOLD_ADVANCE;
  let units = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    units += code >= 32 && code < 127 ? table[code - 32] : SYMBOL_ADVANCE[ch] ?? 1000;
  }
  return (units / 1000) * fontSize * ADVANCE_ALLOWANCE;
}

/**
 * The INK above and below the baseline, per line, as fractions of the font size — the part of a line
 * that can actually collide. Measured on the board faces (Nunito / Outfit): capitals, digits and
 * ascenders (b d f h i k l t) reach 0.71-0.74 em, the x-height is 0.49-0.50 em; descenders (g j p q y)
 * drop 0.19-0.22 em, everything else ~0.02 em. A box sized for the tallest and deepest glyphs of every line would call "nucleus" over
 * "vacuole" at a normal line gap a collision; the old box (1.35 em, from 1.05 em above the baseline)
 * missed a 34px title and a 23px subtitle 26 px apart, whose descender and capital DO overprint.
 */
function inkExtent(text: string): { ascent: number; descent: number } {
  return {
    ascent: /[A-Z0-9bdfhijklt'"!?()[\]{}\/\\|#$%&@^*À-ÿ]/.test(text) ? 0.75 : 0.51,
    descent: /[gjpqyQ,;()[\]{}\/|$@_]/.test(text) ? 0.23 : 0.03,
  };
}
/** The tallest and deepest regular glyphs, for boxes that must not depend on the word. */
const FULL_ASCENT = 0.75;
const FULL_DESCENT = 0.23;
/** Ink that overlaps by more than this in BOTH directions is overprinting, not a near miss. */
const INK_OVERLAP_PX = 2;

function fontWeightOf(attrs: string): number {
  const raw = /font-weight\s*=\s*"([^"]+)"/.exec(attrs)?.[1] ?? /font-weight:\s*([^;"]+)/.exec(attrs)?.[1];
  if (!raw) return 400;
  const value = raw.trim().toLowerCase();
  if (value === "bold" || value === "bolder") return 700;
  if (value === "normal" || value === "lighter") return 400;
  const number = Number(value);
  return Number.isFinite(number) ? number : 400;
}

function numberAttr(attrs: string, name: string): number | null {
  // Leading space or start: "x" must not match inside "dx", nor "y" inside "dy".
  const hit = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([-\\d.eE+]+)"`).exec(attrs);
  return hit ? Number(hit[1]) : null;
}

/**
 * The lines one <text> element draws. A wrapped label is ONE <text> whose later lines are <tspan>s
 * with their own x and dy — the form the layout contract (lib/drawPrompt.ts) asks for, so that a
 * verbatim source label such as "chloroplast containing chlorophyll" is never shortened. Measured
 * as one line it would be ~360 px wide and reported as running off the board; measured per line it
 * fits its label column. A tspan without x or y continues the current line.
 */
function textLines(attrs: string, inner: string): Array<{ text: string; x: number; y: number }> {
  const x0 = numberAttr(attrs, "x");
  const y0 = numberAttr(attrs, "y");
  if (x0 === null || y0 === null) return [];
  const lines: Array<{ text: string; x: number; y: number }> = [];
  let current = { text: "", x: x0, y: y0 };
  for (const piece of inner.split(/(<tspan\b[^>]*>)/)) {
    const open = /^<tspan\b([^>]*)>$/.exec(piece);
    if (open) {
      const tx = numberAttr(open[1], "x");
      const ty = numberAttr(open[1], "y");
      const dy = numberAttr(open[1], "dy");
      if (tx !== null || ty !== null || (dy !== null && dy !== 0)) {
        if (current.text.trim()) lines.push(current);
        current = { text: "", x: tx ?? current.x, y: ty ?? current.y + (dy ?? 0) };
      }
      continue;
    }
    current.text += piece.replace(/<[^>]*>/g, "");
  }
  if (current.text.trim()) lines.push(current);
  return lines
    .map((line) => ({ ...line, text: decodeEntities(line.text).replace(/\s+/g, " ").trim() }))
    .filter((line) => line.text);
}

/** Each written line's measured ink box on the finished frame (one per line of a wrapped label). */
export function textBoxes(svg: string): TextBox[] {
  const boxes: TextBox[] = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const attrs = m[1];
    const fs = numberAttr(attrs, "font-size") ?? (/font-size:\s*([\d.]+)/.exec(attrs)?.[1] ? Number(/font-size:\s*([\d.]+)/.exec(attrs)![1]) : 16);
    const anchor = /text-anchor\s*=\s*"(middle|end)"/.exec(attrs)?.[1];
    const weight = fontWeightOf(attrs);
    for (const line of textLines(attrs, m[2])) {
      const w = measuredTextWidth(line.text, fs, weight);
      const ink = inkExtent(line.text);
      // x is the anchor point, not the left edge; y is the baseline, not the top.
      const left = anchor === "middle" ? line.x - w / 2 : anchor === "end" ? line.x - w : line.x;
      boxes.push({
        text: line.text,
        x: left,
        y: line.y - FULL_ASCENT * fs,
        w,
        h: (FULL_ASCENT + FULL_DESCENT) * fs,
        ink: { y: line.y - ink.ascent * fs, h: (ink.ascent + ink.descent) * fs },
      });
    }
  }
  return boxes;
}

/** Every string written on the finished frame, one per <text>, in document order. */
export function frameTexts(svg: string): string[] {
  const out: string[] = [];
  const re = /<text\b[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const content = decodeEntities(m[1].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
    if (content) out.push(content);
  }
  return out;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

/** How far two lines' own ink overprints, per axis; both positive means the glyphs collide. */
function inkOverlap(a: TextBox, b: TextBox): { dx: number; dy: number } {
  return {
    dx: Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
    dy: Math.min(a.ink.y + a.ink.h, b.ink.y + b.ink.h) - Math.max(a.ink.y, b.ink.y),
  };
}

/**
 * What the rendered-layout check found.
 *
 * `measured` is the field that did not exist: "ok" used to mean both "measured and clean" and "could
 * not render, so looked at nothing", and a board that threw on a fragment was indistinguishable from
 * a perfect one. Callers rank a measured-clean board above an unmeasured one, and treat a board whose
 * OWN code threw (`unmeasured: "component"`) as a fault, since it would throw for the student too.
 */
export type LayoutCritique = {
  ok: boolean;
  issue?: string;
  /** Every fault found, most damaging first (issue is the first); for the refiner. */
  issues: string[];
  measured: boolean;
  unmeasured?: "component" | "environment";
  renderError?: string;
  /** Every string written on the finished frame, for the label-grounding check. Empty when unmeasured. */
  texts: string[];
};

/** Measures the rendered frame's text and connector layout. Never throws. */
export async function critiqueLayout(code: string, assetRuntime?: string): Promise<LayoutCritique> {
  if (!ENABLED) return { ok: true, issues: [], measured: false, unmeasured: "environment", texts: [] };
  const frame = await renderFrame(code, assetRuntime);
  if (!frame.svg) {
    const failure = frame.failure ?? { kind: "environment" as const, message: "no frame" };
    if (failure.kind === "environment") {
      // Nothing is known about the board: never a fault, only ranked below a measured board.
      return { ok: true, issues: [], measured: false, unmeasured: "environment", renderError: failure.message, texts: [] };
    }
    const issue =
      `the component throws when it renders (${failure.message}), so the student's board would show an error ` +
      `instead of the drawing. Fix the code so it renders: define every variable before use, return one <svg> root`;
    return { ok: false, issue, issues: [issue], measured: false, unmeasured: "component", renderError: failure.message, texts: [] };
  }
  const svg = frame.svg;
  const texts = frameTexts(svg);
  const issues = layoutIssues(svg);
  return { ok: issues.length === 0, issue: issues[0], issues, measured: true, texts };
}

/**
 * Every layout fault on a rendered frame, one per kind, most damaging first. Pure: exported so the
 * geometry can be tested without a renderer.
 *
 * All of them, not just the first: the refine loop hands these to the model as its defect list, and
 * a revision that fixes the overlap while leaving the clipped heading is a wasted round.
 */
export function layoutIssues(svg: string): string[] {
  /*
   * Every written line in BOARD coordinates. Measured at its own x/y, a label inside
   * <g transform="translate(600 300)"> was tested 600 px from where the student sees it: a part
   * drawn around the origin with its labels at negative x read as "outside the safe frame", and two
   * labels at the same local spot in different groups as printed on top of each other — false faults
   * that each cost a candidate or a refine round.
   */
  const geometry = readBoardGeometry(svg);
  const boxes = textBoxesInBoardSpace(geometry, textBoxes);
  const issues: string[] = [];

  const clipped = boxes.find(
    (b) => b.x < FRAME.x0 - 10 || b.x + b.w > FRAME.x1 + 10 || b.y < FRAME.y0 - 10 || b.y + b.h > FRAME.y1 + 10,
  );
  if (clipped) {
    issues.push(
      `the text "${clipped.text.slice(0, 40)}" is outside the safe frame (measured x ${Math.round(clipped.x)}..${Math.round(clipped.x + clipped.w)}, y ${Math.round(clipped.y)}..${Math.round(clipped.y + clipped.h)}; allowed x ${FRAME.x0}..${FRAME.x1}, y ${FRAME.y0}..${FRAME.y1}), so it renders clipped by the board edge. Keep the words exactly and wrap the line onto two lines, or move it inward`,
    );
  }

  overlap: for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const { dx, dy } = inkOverlap(a, b);
      if (dx > INK_OVERLAP_PX && dy > INK_OVERLAP_PX) {
        issues.push(
          `the labels "${a.text.slice(0, 24)}" and "${b.text.slice(0, 24)}" are printed on top of each other (their ink overlaps by ${Math.round(dx)}x${Math.round(dy)} px near x ${Math.round(Math.max(a.x, b.x))}, y ${Math.round(Math.max(a.ink.y, b.ink.y))}), so they render as unreadable overlapping glyphs. Give each its own row`,
        );
        break overlap;
      }
    }
  }

  /*
   * NOW THE LINES.
   *
   * Everything above measures text against text, which is why a stroke drawn straight through a
   * label was invisible to every check this project has: the deterministic one only knew about
   * `<text>`, one vision critic judges only whether the subject is recognizable, and the other is
   * scored against textbook internal structure. A reinforcement-learning board shipped with its
   * leader line printed across the words "state = position" for exactly that reason.
   *
   * Geometry rather than another vision call, because a line crossing a rectangle is arithmetic —
   * cheaper, faster and more certain than asking a model to look.
   *
   * Read in BOARD coordinates (readBoardGeometry composes every transform and skips <defs>, markers
   * and hidden elements), and against the labels as the student sees them: each <text> is measured
   * with the same glyph widths as above and carried through its own transforms, so a label in a
   * translated group or a rotated axis title is tested where it is drawn.
   *
   * The end check tests only CONNECTORS (leaders, arrows) and only their two real ends, against
   * parts measured by their real edges — never the vertices of an outline, never the frame rect.
   * Those three changes are one change: see the header of lib/boardConnectorGeometry.ts for the leaf
   * outline that any one of them alone would have told the refiner to delete.
   */
  const crossing = connectorCrossingIssue(strokeSegments(geometry), boxes);
  if (crossing) issues.push(crossing);
  issues.push(...connectorEndIssues(geometry, boxes));

  /*
   * The HEAD, separately from the stroke.
   *
   * An arrowhead is a filled triangle, and filled paths are skipped above as artwork. Measured on a
   * generated state diagram, the stroke stopped politely short of the label while the head sat
   * squarely on the words "next state" — the arrow still collided with the text, and every
   * line-based check passed it.
   */
  const heads = arrowheadOnLabelIssue(geometry.arrowheads, boxes);
  if (heads) issues.push(heads);

  return issues;
}

/* ── Label grounding (strict source mode) ────────────────────────────────────
 * Strict mode promises that nothing on the board comes from outside the source. The board model was
 * told so in words; this is the check. Every string the finished frame writes is compared with the
 * source's vocabulary (lib/sourceGrounding.ts: content words, light stemming, CO2 ~ carbon dioxide),
 * and a string with a content word the source never uses is named, with a concrete instruction.
 *
 * Deterministic and free — it reads the frame the layout check already rendered — so it can gate
 * every candidate and every revision without a model call.
 */
export type LabelGroundingFault = { text: string; missing: string[] };

/** The written strings that bring in words the source does not contain. Empty means grounded. */
export function ungroundedBoardTexts(texts: string[], source: BeatSourceGrounding): LabelGroundingFault[] {
  const vocab = sourceVocabulary(source);
  const faults: LabelGroundingFault[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (labelIsGrounded(text, vocab)) continue;
    faults.push({ text, missing: ungroundedTerms(text, vocab) });
  }
  return faults;
}

/** One sentence for the verdict/log, naming the first few offending strings. */
export function labelGroundingIssue(faults: LabelGroundingFault[]): string | null {
  if (faults.length === 0) return null;
  const named = faults.slice(0, 3).map((f) => `"${f.text.slice(0, 40)}" (not in the source: ${f.missing.slice(0, 3).join(", ")})`).join("; ");
  return `the board writes words the source does not contain — ${named}${faults.length > 3 ? `, and ${faults.length - 3} more` : ""}. In strict source mode every word on the board must come from the source`;
}

/**
 * The same faults as refine defects: what is wrong, where, and the exact fix. The fix offers the
 * source's own labels by name, because "use the source's wording" is only actionable when the
 * wording is in front of the model.
 */
export function labelGroundingDefects(faults: LabelGroundingFault[], source: BeatSourceGrounding): BoardDefect[] {
  const suggestions = source.labels.length
    ? ` (the source's labels are: ${source.labels.map((l) => `"${l}"`).join(", ")})`
    : "";
  return faults.slice(0, 4).map((fault) => ({
    what: `"${fault.text.slice(0, 60)}" is not in the source (the source never uses: ${fault.missing.slice(0, 4).join(", ")})`,
    where: `the <text> element reading "${fault.text.slice(0, 60)}"`,
    fix: `replace "${fault.text.slice(0, 60)}" with the source's own wording${suggestions}, or delete it and anything drawn only to illustrate it`,
  }));
}

/**
 * What a strict (source-only) board is judged against, for the critics' prompts. Absent in reference
 * mode, where the critics keep their textbook standard.
 */
export type CriticSource = Pick<BeatSourceGrounding, "text" | "labels" | "caption" | "strict">;

/** The source as a critic reads it: the figure's caption and labels first, then the text, bounded. */
function sourceBrief(source: CriticSource): string {
  const lines: string[] = [];
  if (source.caption) lines.push(`Source figure caption: ${source.caption}`);
  if (source.labels.length) lines.push(`The source figure labels exactly these parts: ${source.labels.map((l) => `"${l}"`).join(", ")}`);
  lines.push(`SOURCE (the only content this board may show):\n${source.text.replace(/\s+/g, " ").trim().slice(0, 1600)}`);
  return lines.join("\n");
}

/**
 * Critique a single generated animation's finished shape. Returns ok=true (never blocks) unless
 * the vision model positively judges the subject unrecognizable, in which case ok=false with a
 * concrete issue to feed the retry loop in reactAnimationGen.ts.
 *
 * DETAIL STAYS "low" DELIBERATELY. At "low" the 1000x560 frame reaches the model at 512 px wide, so
 * a 22 px label is ~11 px — enough to see the subject, not reliably enough to read every label. "high"
 * would read them but costs ~700 more image tokens (about +0.5-1 s) on a call that runs for every
 * candidate while the student waits. Labels are judged elsewhere without that cost: the layout check
 * measures them, the grounding check reads their words, and the refinement critic looks at "high".
 */
export async function critiqueShapeRecognizability(
  client: OpenAI,
  beat: Beat,
  code: string,
  subject: string,
  assetRuntime?: string,
  options: { source?: CriticSource } = {},
): Promise<ShapeCritique> {
  // Every one of these is "could not look", which is NOT the same claim as "looks perfect".
  if (!ENABLED) return { ok: true, score: null, costUsd: 0 };
  const { png } = await framePng(code, assetRuntime);
  if (!png) return { ok: true, score: null, costUsd: 0 }; // couldn't render or rasterise -> skip, don't block

  const strict = options.source?.strict === true;
  const ask = strict
    ? `Beat: "${beat.title}". This diagram redraws a figure from the student's own source.\n${sourceBrief(options.source!)}\n` +
      `Judge only whether the drawing reads as THAT source's subject. A simple drawing that shows only what the source shows is correct: never lower the score for detail the source does not contain.`
    : `Beat: "${beat.title}". This diagram must depict: ${subject}. Judge only shape recognizability.`;
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: ask },
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
    const verdict = shapeVerdict(parsed, subject);
    if (!verdict.ok) console.error(`[anim-vision] beat=${beat.id} score=${verdict.score ?? "missing"} REJECT: ${verdict.issue}`);
    else console.error(`[anim-vision] beat=${beat.id} score=${verdict.score ?? "missing"} OK`);
    return { ...verdict, costUsd: cost };
  } catch (err) {
    console.error(`[anim-vision] beat=${beat.id} critic failed (skipping): ${err instanceof Error ? err.message : "error"}`);
    return { ok: true, score: null, costUsd: 0 };
  }
}

/**
 * The shape critic's reply as a verdict. Pure, so the rule is testable.
 *
 * A MISSING SCORE IS NOT A PASS. The old reading defaulted an absent score to 5, so a reply that
 * never judged the board at all — `{}`, or a sentence with no number — counted as a perfect score
 * and waved the board through. Now an absent score is "unscored" (null), and without a score the
 * board passes only if the critic said, explicitly, that it is recognizable.
 */
export function shapeVerdict(parsed: Record<string, unknown>, subject: string): Omit<ShapeCritique, "costUsd"> {
  const rawScore = typeof parsed.score === "number" && Number.isFinite(parsed.score) ? parsed.score : null;
  const score = rawScore === null ? null : Math.max(1, Math.min(5, rawScore));
  const issue = typeof parsed.issue === "string" ? parsed.issue.trim() : "";
  const ok = score === null ? parsed.recognizable === true : parsed.recognizable !== false && score >= REJECT_BELOW;
  return {
    ok,
    score,
    issue: ok
      ? undefined
      : issue || (score === null
        ? `the critic could not confirm that the ${subject} is recognizable; make the subject's defining shape unmistakable`
        : `the ${subject} does not read as recognizable; rebuild its silhouette to match the real subject`),
  };
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

const CONNECTOR_RUBRIC = `CONNECTORS ARE SCORED AS HARD AS CONTENT. Report each of these as a defect when present:
- a line, arrow or leader drawn through a label, so the words and the stroke overprint;
- an arrow whose direction contradicts the relation it is meant to show;
- an arrow, curve or leader that ends in blank space, joins nothing, or merely duplicates another;
- a node or element left with no relation drawn to anything, when the board is about relations.

KEY NOTES AND FEW LABELS. A board writes 2-4 short key notes in its left column and labels at most
three parts, and only when naming the parts is the slide's point — most boards carry none. The host
places labels in the right column with leaders ending ON their parts. A label whose dot is not on the
part it names is a defect (fix: move its point inside that part). More than three labels, or labels on
a slide about a process, is a defect whose fix is to DELETE them. Never ask for a label to be added.`;

const REFINE_SYSTEM_PROMPT = `You review a teaching whiteboard illustration and list what to fix. Output ONLY JSON:
{ "score": 1-5, "defects": [ { "what": string, "where": string, "fix": string } ] }

Score against a TEXTBOOK-QUALITY reference, not against "can I tell what it is":
5 = internal structure is drawn (cartilage rings, lobes, branching, chambers, layers), each part
    is recognisable WITHOUT a label, the drawing fills its area, and nothing is clipped or
    overlapping. Key notes are written beside it; labels (at most three, usually none) — never ask for more.
4 = one clear shortcoming.
3 = recognizable but essentially an outline: the named internal parts are missing.
2 = generic shapes standing in for the subject (plain ovals, circles, bare lines).
1 = unrecognizable.

A board with NO internal structure cannot score above 3, however tidy it looks.

JUDGE THE SUBJECT ON ITS OWN TERMS. "Internal structure" means the named parts of a drawn THING
(cartilage rings, lobes, chambers). When the subject IS a set of relationships — a state machine,
a cycle, a pipeline, a hierarchy — it has no internal parts to draw, and scoring it as though it
does measures the wrong thing entirely. For that kind of board, the equivalent of internal
structure is the relationships themselves: are they the RIGHT ones, does every connection carry a
meaning, and can each be read without tracing it through something else.

${CONNECTOR_RUBRIC}

"defects": up to 4, most damaging first. Be specific and positional — "the leader dot for Axon sits
in blank space to the right of the drawing, not on the axon" and "the trachea is a plain tube with
no cartilage rings", never "labels are wrong" or "add more detail". "fix" must name the concrete
change to make. Return [] only when the board genuinely deserves 5.`;

/**
 * The rubric for a STRICT board: judged against the student's source, never against a textbook.
 *
 * The reference rubric above demands internal structure ("a board with NO internal structure cannot
 * score above 3") and asks for parts by name. On a strict lesson that is an instruction to invent:
 * the source figure of a palisade cell labels six parts, and a critic holding the board to a textbook
 * cell asks for mitochondria the source never mentions — which the refiner then dutifully draws.
 * Here the only standard is the source: its parts, its words, nothing more, and deletion is the fix
 * for anything extra.
 */
const STRICT_REFINE_SYSTEM_PROMPT = `You review a teaching whiteboard that must show ONE source's content faithfully — nothing more. Output ONLY JSON:
{ "score": 1-5, "defects": [ { "what": string, "where": string, "fix": string } ] }

You are given SOURCE (the only content the board may show) and, when the source has a figure, the
parts that figure labels. Score against the SOURCE, not against a textbook:
5 = every part the source figure shows is drawn where the source places it, recognisable without a
    label (the board carries none by design; the narration names them); nothing appears that the
    source does not contain; nothing is clipped, cut off or overlapping.
4 = one clear shortcoming.
3 = recognizably the source's subject, but a part the source shows is missing or misplaced.
2 = the board shows parts, words, numbers or scenes the source does not contain, or generic shapes.
1 = unrelated to the source.

A sparse board that shows only what the source shows deserves 5. NEVER ask for internal structure,
parts, labels, molecules, arrows, examples, numbers or facts that SOURCE does not contain — that is
the one defect you must never create. When the board shows something SOURCE lacks, the fix is to
DELETE it, or to replace its words with the source's own words.

${CONNECTOR_RUBRIC}

"defects": up to 4, most damaging first. Be specific and positional ("the label 'Sunlight' at the
top left is not in the source", "the leader dot for 'vacuole' sits outside the cell"). "fix" must name
the concrete change. Return [] only when the board genuinely deserves 5.`;

/** Quoted strings a fix asks to write — the only part of a fix that can be checked for invention. */
function quotedStrings(text: string): string[] {
  // A quote opens after a space or bracket and closes before one, so a possessive apostrophe
  // ("the plant's leaves") never pairs with the next one into a fake quotation.
  return [...text.matchAll(/(?:^|[\s(:])["“'‘]([^"”'’]{2,80})["”'’](?=$|[\s.,;:)!?])/g)].map((m) => m[1]);
}

/**
 * Drops strict-mode defects that ask the refiner to ADD words the source does not have.
 *
 * The strict rubric tells the critic never to do this; this makes it so. Only an additive fix
 * ("add", "label", "write", "draw", "include", "show") whose quoted text leaves the source is
 * dropped — a fix that deletes or moves something is always kept, whatever it quotes.
 */
export function withoutInventedAdditions(defects: BoardDefect[], source: CriticSource): BoardDefect[] {
  const vocab = sourceVocabulary(source as BeatSourceGrounding);
  return defects.filter((defect) => {
    if (!/\b(add|adds|adding|label|write|draw|include|insert|show|introduce)\b/i.test(defect.fix)) return true;
    if (/\b(delete|remove|drop|erase)\b/i.test(defect.fix)) return true;
    return quotedStrings(defect.fix).every((quoted) => labelIsGrounded(quoted, vocab));
  });
}

export async function critiqueForRefinement(
  client: OpenAI,
  beat: Beat,
  code: string,
  subject: string,
  assetRuntime?: string,
  options: { source?: CriticSource } = {},
): Promise<RefinementCritique> {
  // Same fail-open discipline as the other critics: "could not look" must never read as "perfect",
  // so a null score tells the loop to stop rather than to declare success.
  if (!ENABLED) return { score: null, defects: [], costUsd: 0 };
  const { png } = await framePng(code, assetRuntime);
  if (!png) return { score: null, defects: [], costUsd: 0 };

  const strict = options.source?.strict === true;
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: strict ? STRICT_REFINE_SYSTEM_PROMPT : REFINE_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: strict
                ? `Beat: "${beat.title}".\n${sourceBrief(options.source!)}`
                : `Beat: "${beat.title}". This board must depict: ${subject}.`,
            },
            { type: "image_url", image_url: { url: png, detail: "high" } },
          ],
        },
      ],
      // Scores decide whether a revision is kept. At the default temperature the same board could
      // score 3 and then 4, and the loop accepted or rejected revisions on that noise.
      temperature: 0,
      max_tokens: 700,
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
    const score = typeof parsed.score === "number" && Number.isFinite(parsed.score) ? Math.max(1, Math.min(5, parsed.score)) : null;
    const defects = (Array.isArray(parsed.defects) ? parsed.defects : [])
      .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
      .map((d) => ({
        what: String(d.what ?? "").slice(0, 300),
        where: String(d.where ?? "").slice(0, 200),
        fix: String(d.fix ?? "").slice(0, 300),
      }))
      .filter((d) => d.what && d.fix)
      .slice(0, 4);
    return { score, defects: strict ? withoutInventedAdditions(defects, options.source!) : defects, costUsd: costUsd(completion.usage) };
  } catch {
    return { score: null, defects: [], costUsd: 0 };
  }
}
