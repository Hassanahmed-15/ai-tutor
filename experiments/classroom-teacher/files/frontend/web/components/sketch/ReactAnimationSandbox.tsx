"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { keepContentLabels } from "@/lib/board/contentLabels";
import { registerSandboxText } from "@/lib/board/sandboxBridge";
import { ANIM_SANDBOX_RUNTIME } from "../../lib/anim/sandboxRuntime";
import { SANDBOX_LAYOUT_CORE, SANDBOX_LAYOUT_HOST } from "../../lib/anim/sandboxLayout";
import { isMotionBoard, motionBoardSentenceCount, MOTION_MODULE_NAMES, PEN_WRITER_SOURCE, SANDBOX_MOTION_RUNTIME, SANDBOX_MOTION_URL } from "../../lib/anim/sandboxMotion";
import { escapeStrayLessThan, type ParseLoc } from "../../lib/jsxRepair";
import { BOARD_FONT_FACES, BOARD_FONT_FAMILY, BOARD_FONT_STACK } from "../../lib/anim/boardFont";
import { illustrationIdOf } from "../../lib/anim/illustratedLayout";
import { PEN_HOLD_EVENT, PEN_TIP_EVENT, TEACHER_PRESENT_EVENT, isTeacherPresent } from "@/lib/classroom/penTip";

/**
 * Renders an LLM-generated React component (a `reactAnimation` DrawOp's `code` string) live,
 * inside a sandboxed <iframe>. This is the highest-risk piece of the animation pipeline: the
 * code is real JavaScript authored by gpt-4o and must be treated as untrusted, even though
 * lib/drawSanitize.ts already ran it through banned-pattern/size checks before it ever reached
 * the client.
 *
 * Threat model & mitigations (see plan doc for full reasoning):
 *  - `sandbox="allow-scripts"` with NO `allow-same-origin` is the real boundary: it forces the
 *    iframe's origin to be opaque/null, so same-origin-policy blocks cookie/localStorage/parent-
 *    DOM access no matter what the generated code attempts.
 *  - No allow-forms/allow-popups/allow-top-navigation/allow-modals — no redirects, popups, or
 *    forms even for social engineering.
 *  - Content is inlined via `srcDoc`, never fetched from a URL.
 *  - A CSP meta tag inside the sandboxed document blocks fetch/XHR/websocket as a second,
 *    independent layer (different failure mode than the sandbox attribute).
 *  - Only `{type, value|message}` ever crosses the postMessage boundary — no secrets either way.
 *  - A `message`-source-identity check (not origin, which is moot for an opaque-origin iframe)
 *    guards the parent's listener against unrelated iframes/frames spoofing messages in.
 *
 * Props mirror LiveSketch's `{ script, progress }` contract so callers can swap renderers with
 * a one-line conditional (see components/LessonPlayer.tsx's VisualDirector).
 */

const READY_TIMEOUT_MS = 8000;
const INITIAL_REVEAL_PROGRESS = 0.005;

type MarkerState = { x: number; y: number; rotate: number; visible: boolean };

// Transpiled-output cache, keyed by the raw source string's identity — repeated renders of the
// same beat (or re-mounts) skip re-invoking Babel entirely.
const transpileCache = new Map<string, string>();

// React/ReactDOM UMD source, fetched once and INLINED into the sandbox document. They cannot be
// loaded via <script src="/sandbox/..."> from inside the iframe: the iframe is sandboxed WITHOUT
// allow-same-origin, so its origin is opaque/null and the document's CSP `script-src 'self'`
// matches nothing external — external script tags are blocked, React never loads, and every
// animation "fails to run safely". Inlining the source (allowed by `script-src 'unsafe-inline'`)
// is the only way to get React into an opaque-origin sandbox with a locked-down CSP.
type SandboxRuntime = { react: string; reactDom: string; motion: string };
let reactRuntimePromise: Promise<SandboxRuntime> | null = null;
function loadReactRuntime(): Promise<SandboxRuntime> {
  if (!reactRuntimePromise) {
    /**
     * `res.ok` is checked, and a failure is NEVER memoised — both matter.
     *
     * Without the status check a missing file returns Next's 404 HTML page, `.text()` happily
     * yields it, and that HTML is inlined into the sandbox document as if it were JavaScript: the
     * board renders blank with no error anyone can act on. And because the rejected promise used
     * to be cached, the first failure poisoned every subsequent beat for the life of the page.
     */
    const get = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} returned ${res.status} — the sandbox React runtime is missing from public/sandbox/`);
      return res.text();
    };
    reactRuntimePromise = Promise.all([
      get("/sandbox/react.production.min.js"),
      get("/sandbox/react-dom.production.min.js"),
      // Motion is optional: without it the sandbox's static stand-in renders every motion element
      // settled at its target (lib/anim/sandboxMotion.ts), so a missing file costs the glide, never
      // the board.
      get(SANDBOX_MOTION_URL).catch(() => ""),
    ])
      .then(([react, reactDom, motion]) => ({ react, reactDom, motion }))
      .catch((err) => {
        reactRuntimePromise = null;
        throw err;
      });
  }
  return reactRuntimePromise;
}

/**
 * The `<Asset/>` runtime for a board, fetched by id.
 *
 * Cached per id-set because consecutive beats on the same subject usually request the same
 * artwork. A failure resolves to empty rather than rejecting: a board that cannot load its
 * illustration should still render its labels and motion, not disappear.
 */
const assetRuntimeCache = new Map<string, Promise<string>>();
function loadAssetRuntime(assetIds?: string[]): Promise<string> {
  if (!assetIds?.length) return Promise.resolve("");
  const key = assetIds.join(",");
  let pending = assetRuntimeCache.get(key);
  if (!pending) {
    pending = fetch(`/api/animation-assets?ids=${encodeURIComponent(key)}`)
      .then((res) => (res.ok ? res.text() : ""))
      .catch(() => "");
    assetRuntimeCache.set(key, pending);
  }
  return pending;
}

/**
 * THE BOARD FONT, inlined into every sandbox document.
 *
 * Nunito SemiBold for text and labels, Outfit ExtraBold for headings — both under one family name
 * (lib/anim/boardFont.ts). The same TTFs feed the server-side rasteriser and width tables, so the
 * critic measures the very glyphs the student sees.
 *
 * Fetched once per page and cached as CSS text, in parallel with the React runtime and warmed by
 * warmSandbox(), so no board waits on it. A failed fetch resolves to "" and the board falls back to
 * the system sans stack — a font must never be the reason a board does not appear. Not
 * memoised on failure, for the same reason as the runtime above.
 */
/**
 * An illustrated board's picture (lib/anim/illustratedLayout.ts), as a data URL — the only image
 * source the sandbox's CSP admits. Cached per id; a failure is not memoised, and rejects, because a
 * labelled board with no picture under its labels is worse than the player's fallback board.
 */
const illustrationCache = new Map<string, Promise<string>>();
function loadIllustration(code: string): Promise<string> {
  const id = illustrationIdOf(code);
  if (!id) return Promise.resolve("");
  let pending = illustrationCache.get(id);
  if (!pending) {
    pending = fetch(`/api/board-illustrations/${id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`illustration ${id} returned ${res.status}`);
        return blobToDataUrl(await res.blob());
      })
      .catch((err) => {
        illustrationCache.delete(id);
        throw err;
      });
    illustrationCache.set(id, pending);
  }
  return pending;
}

let boardFontPromise: Promise<string> | null = null;
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("could not read the board font"));
    reader.readAsDataURL(blob);
  });
}
function loadBoardFont(): Promise<string> {
  if (!boardFontPromise) {
    boardFontPromise = Promise.all(
      BOARD_FONT_FACES.map(async (face) => {
        const res = await fetch(face.url);
        if (!res.ok) throw new Error(`${face.url} returned ${res.status}`);
        const dataUrl = await blobToDataUrl(await res.blob());
        if (!/^data:[^,]*;base64,/.test(dataUrl)) throw new Error(`${face.url} did not read as a data URL`);
        return `@font-face{font-family:"${BOARD_FONT_FAMILY}";src:url(${dataUrl}) format("truetype");font-weight:${face.weight};font-style:normal;font-display:block;}`;
      }),
    )
      .then((rules) => rules.join("\n"))
      .catch(() => {
        boardFontPromise = null;
        return "";
      });
  }
  return boardFontPromise;
}

/**
 * WHERE THE DRAWING IS INSIDE EACH SANDBOX. The board now fits its viewBox to its pane (see
 * fitBoardToPane in lib/anim/sandboxLayout.ts), so the parent can no longer assume the authored
 * 1000x560 is letterboxed into the iframe. Each sandbox reports its live viewBox; the student's
 * marks (components/board/AnnotationLayer.tsx) map through it so ink stays on the part it was drawn
 * over at any pane shape.
 */
export interface SandboxViewport {
  viewBox: { x: number; y: number; width: number; height: number };
  /** The board's own authored frame (normally 0 0 1000 560) — what board space is a fraction of. */
  authored: { x: number; y: number; width: number; height: number };
  /** The svg's size in the iframe, in CSS px (the whole iframe: the board fills it). */
  width: number;
  height: number;
}
const viewportRegistry = new WeakMap<HTMLIFrameElement, SandboxViewport>();
/** Fired on window whenever any sandbox reports a new viewport, so overlays can repaint. */
export const SANDBOX_VIEWPORT_EVENT = "board-sandbox-viewport";
export function sandboxViewport(iframe: HTMLIFrameElement | null | undefined): SandboxViewport | null {
  if (!iframe || !iframe.isConnected) return null;
  return viewportRegistry.get(iframe) ?? null;
}

/**
 * Pay the sandbox's fixed costs before the first animated beat needs them.
 *
 * The first board of a lecture was paying for `import("@babel/standalone")` (a multi-megabyte
 * chunk) plus two runtime fetches before it could transpile a line, and every millisecond of that
 * was a title card over a board that did not exist yet. Both are memoised, so warming them at
 * lecture start moves that cost to a moment nobody is waiting on. Failures are swallowed: this is
 * an optimisation, and the real load path still reports its own errors.
 */
export function warmSandbox(): void {
  void import("@babel/standalone").catch(() => undefined);
  void loadReactRuntime().catch(() => undefined);
  void loadBoardFont();
}

/** How many stray `<` characters we are willing to fix before concluding the source is just broken. */
const MAX_JSX_REPAIRS = 6;

async function transpile(code: string): Promise<string> {
  const cached = transpileCache.get(code);
  if (cached) return cached;
  const Babel = await import("@babel/standalone");

  const compile = (source: string) =>
    // The "react" preset alone only strips JSX — it leaves `export default` as real ES module
    // syntax, which a plain (non type="module") <script> tag cannot execute. transform-modules-
    // commonjs rewrites it to `exports.default = Animation`, which the shim below reads after
    // pre-declaring a bare `exports` object for it to assign onto.
    Babel.transform(source, {
      // CLASSIC runtime, not automatic: the automatic runtime emits `require("react/jsx-runtime")`,
      // a bare require the sandbox has no module loader for → "require is not defined" at runtime.
      // Classic compiles JSX to `React.createElement(...)`, referencing the global React UMD that
      // IS present in the sandbox. Explicit pragma keeps it deterministic across Babel versions.
      presets: [["react", { runtime: "classic", pragma: "React.createElement", pragmaFrag: "React.Fragment" }]],
      plugins: ["transform-modules-commonjs"],
      filename: "animation.jsx",
    });

  /**
   * Compile-guided repair of stray `<` in JSX text.
   *
   * `<text>BST Property: Left < Root < Right</text>` is a hard syntax error that fails the WHOLE
   * board — a comparison operator in a caption costs the entire beat its diagram. Babel names the
   * exact position, so each pass fixes that one character and asks again. Nothing is rewritten
   * speculatively, which matters: a blanket regex would also rewrite `{progress < 0.5 ? … : …}`,
   * which is in almost every generated component and is perfectly valid. A source that fails for
   * any other reason reports its ORIGINAL error rather than a confusing downstream one.
   */
  // A node's value tagged "label" would be hidden with the real labels (lib/board/contentLabels).
  let source = keepContentLabels(code);
  let firstError: unknown = null;
  for (let attempt = 0; attempt <= MAX_JSX_REPAIRS; attempt++) {
    try {
      const out = compile(source).code ?? "";
      transpileCache.set(code, out);
      return out;
    } catch (err) {
      if (!firstError) firstError = err;
      const loc = (err as { loc?: ParseLoc }).loc;
      const repaired = loc ? escapeStrayLessThan(source, loc) : null;
      if (!repaired) throw firstError;
      source = repaired;
    }
  }
  throw firstError;
}

function buildSrcDoc(
  transpiledCode: string,
  runtime: SandboxRuntime,
  /**
   * Defines <Asset/> and the artwork it can place. Injected AFTER the motion runtime and BEFORE
   * the component, and it must match what lib/reactAnimationVisionCritic.ts prepends server-side —
   * a critic that scores a board without its artwork is scoring a picture nobody sees.
   */
  assetRuntime = "",
  /** The board font's @font-face rules (data: URIs), or "" to fall back to system handwriting. */
  fontCss = "",
  /**
   * A MOTION BOARD (lib/anim/sandboxMotion.ts) reveals and animates itself from the sentence clock,
   * so it is rendered with that clock and the host's teaching timeline — handwriting, stroke
   * tracing, data-teach-* reveal — does not run on it. False for boards saved before, which the
   * timeline reveals exactly as before.
   */
  motionBoard = false,
  /** How many sentences a Motion board's reveals are keyed to (motionBoardSentenceCount). */
  boardSentences = 1,
  /** An illustrated board's picture as a data URL, exposed to the board as BOARD_ILLUSTRATION. */
  illustration = "",
): string {
  // React/ReactDOM are UMD builds pinned at React 18, INLINED (not <script src>) because the
  // opaque-origin sandbox + strict CSP blocks external script tags — see loadReactRuntime above.
  // This is an isolated realm — the sandboxed component never interacts with the app's real
  // React 19 tree outside the iframe, so the version mismatch has no consequence.
  //
  // `font-src data:` admits exactly one thing: the board font below, inlined. Nothing is fetched.
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:;" />
<style>
${fontCss}
html,body{margin:0;padding:0;background:#fbfbf8;width:100%;height:100%;overflow:hidden;}
#root{width:100%;height:100%;box-sizing:border-box;padding:0;background:#fbfbf8;}
#root>*{width:100%;height:100%;box-sizing:border-box;display:block;}
svg{max-width:100%;max-height:100%;overflow:visible;}
/* The pulsing orange ring picture boards drew on a part until 2026-09-29 (removed from the composer);
   hidden here so lectures saved before that lose it too. Matches only that exact ring. */
circle[stroke="#f59e0b"][stroke-width="3.5"][fill="none"]{display:none!important;}
/*
 * NO LABELS ON TIMELINE BOARDS. Boards from the timeline era carried no labels (NO_LABELS_RULE in
 * lib/drawPrompt.ts); this hides any such a board still has. Motion boards carry a few labels by
 * design (FEW_LABELS_RULE) and reveal everything themselves, so neither hide rule applies to them.
 * Hidden elements take no part in the fit-to-ink layout.
 */
${motionBoard ? "" : '[data-teach-kind="label"]{display:none!important;}'}
/*
 * ONE FONT, EVERYWHERE. The board used to name "Chalkboard SE" — a macOS font — so Windows students
 * got Comic Sans, Linux got a sans, and every width the layout was planned against was wrong
 * somewhere. The board font (lib/anim/boardFont.ts, OFL) ships inside the document, so the glyphs, and every
 * measurement taken from them, are identical on every machine and in the server-side critic.
 * Weight is the author's, mapped onto the two shipped faces: body text SemiBold, headings ExtraBold.
 */
svg text{
  font-family:${BOARD_FONT_STACK}!important;
  letter-spacing:0!important;
  font-kerning:normal;
  transition:opacity 80ms linear!important;
}
${motionBoard ? "" : "[data-teach-order]{opacity:0;}"}
/* A border drawn around the authored 1000x560 box means nothing once the board is fitted to its pane. */
svg[data-host-fitted] [data-host-frame]{stroke-opacity:0!important;}
</style>
</head>
<body>
<div id="root"></div>
<script>${runtime.react}<\/script>
<script>${runtime.reactDom}<\/script>
<script>${runtime.motion}<\/script>
<script>
(function () {
  var root = null;
  var Animation = null;
  var hasErrored = false;
  var timelineFrame = 0;
  // Last progress value actually committed through React, quantised to 1%. Lets render() skip
  // reconciliation on the ~60/sec messages that would produce an identical tree. See render().
  var lastRenderedProgress = null;
  var MOTION_BOARD = ${motionBoard ? "true" : "false"};
  var BOARD_SENTENCES = ${Math.max(1, Math.floor(boardSentences))};
  /*
   * What the component is rendered with. A timeline board gets progress alone, as it always has. A
   * Motion board gets the narration clock — and two guarantees that do not depend on the caller:
   *  - A caller with no clock (a follow-up answer's board sends sentence 0 of 1) would hold the board
   *    on its first sentence and never reach steps keyed to sentence 2+. The board's own sentences
   *    are run across progress instead.
   *  - Finished means EVERY step the board defines is on screen, even if the caller counted fewer
   *    sentences than the board was keyed to.
   */
  function boardProps(progress, sentenceIndex, sentenceProgress, sentenceTotal) {
    if (!MOTION_BOARD) return { progress: progress };
    var total = sentenceTotal, index = sentenceIndex, within = sentenceProgress;
    if (!(total > 1) && BOARD_SENTENCES > 1) {
      var scaled = Math.min(progress, 0.999999) * BOARD_SENTENCES;
      total = BOARD_SENTENCES;
      index = Math.floor(scaled);
      within = scaled - index;
    }
    var finished = progress >= 1;
    var all = Math.max(total, BOARD_SENTENCES);
    return {
      progress: progress,
      sentence: finished ? all : index,
      sentenceProgress: finished ? 1 : within,
      sentenceTotal: all
    };
  }

  // Easing/composition helpers, declared before the generated component runs so it can call
  // them by name. Function declarations hoist, so they are in scope inside the try block below.
${ANIM_SANDBOX_RUNTIME}
${SANDBOX_MOTION_RUNTIME}
${motionBoard ? PEN_WRITER_SOURCE : ""}
${assetRuntime}
  var BOARD_ILLUSTRATION = ${JSON.stringify(illustration)};

  function postToParent(msg) {
    try { window.parent.postMessage(msg, "*"); } catch (e) {}
  }

  /*
   * WHAT THE BOARD SAYS, FOR THE PARENT. The parent document cannot see into this sandbox, so a
   * pen stroke over a word here reads as a stroke over an <iframe>. Every visible text element is
   * reported with its box, whenever the visible set changes, so the pen can name what it covered
   * and the tutor can be told what is written on the board.
   */
  var lastTextMapKey = "";
  function postTextMap() {
    try {
      var svg = document.querySelector("#root svg");
      if (!svg) return;
      var nodes = Array.prototype.slice.call(svg.querySelectorAll("text"));
      var items = [];
      for (var i = 0; i < nodes.length && items.length < 80; i++) {
        var node = nodes[i];
        var text = (node.textContent || "").replace(/\\s+/g, " ").trim();
        if (!text) continue;
        var visible = true;
        var probe = node;
        while (probe && probe !== svg) {
          if (probe.style && probe.style.opacity === "0") { visible = false; break; }
          probe = probe.parentNode;
        }
        if (!visible) continue;
        var box = node.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) continue;
        items.push({ text: text, x: box.left, y: box.top, w: box.width, h: box.height });
      }
      var key = items.map(function (item) { return item.text; }).join("|");
      if (key === lastTextMapKey) return;
      lastTextMapKey = key;
      postToParent({ type: "textmap", items: items });
    } catch (e) {}
  }

  /* The picture, for "Explain this": the SVG with computed styles inlined so it renders outside. */
  function inlineComputedStyles(source, clone) {
    var computed = getComputedStyle(source);
    // stroke-opacity/fill-opacity/stroke-dasharray: the host's own stylesheet hides the authored
    // frame on a fitted board and the reveal writes fill settling; without them the picture sent
    // for "Explain this" showed a border floating mid-board and dashed guides drawn solid.
    var keys = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity",
      "stroke-opacity", "fill-opacity", "stroke-dasharray",
      "font-family", "font-size", "font-weight", "font-style", "letter-spacing",
      "text-anchor", "dominant-baseline", "display", "visibility", "transform"];
    var style = keys.map(function (key) { return key + ":" + computed.getPropertyValue(key); }).join(";");
    clone.setAttribute("style", (clone.getAttribute("style") || "") + ";" + style);
    var sourceChildren = source.children, cloneChildren = clone.children;
    for (var i = 0; i < sourceChildren.length; i++) {
      if (cloneChildren[i]) inlineComputedStyles(sourceChildren[i], cloneChildren[i]);
    }
  }
  function postSnapshot(id) {
    try {
      var svg = document.querySelector("#root svg");
      if (!svg) { postToParent({ type: "snapshot", id: id, svg: "" }); return; }
      var clone = svg.cloneNode(true);
      inlineComputedStyles(svg, clone);
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      var box = svg.getBoundingClientRect();
      var vb = svg.viewBox && svg.viewBox.baseVal;
      postToParent({
        type: "snapshot",
        id: id,
        svg: new XMLSerializer().serializeToString(clone),
        rect: { left: box.left, top: box.top, width: box.width, height: box.height },
        viewBox: vb && vb.width > 0 ? { x: vb.x, y: vb.y, width: vb.width, height: vb.height } : { x: 0, y: 0, width: box.width, height: box.height },
      });
    } catch (e) {
      postToParent({ type: "snapshot", id: id, svg: "" });
    }
  }

  function reportError(err) {
    if (hasErrored) return; // report once — no retry loop, avoids flicker
    hasErrored = true;
    postToParent({ type: "error", message: err && err.message ? String(err.message) : String(err) });
  }

  window.onerror = function (message) { reportError(message); return true; };

  /*
   * A require() SHIM, so a stray import does not silently blank the board.
   *
   * The prompt says "No imports. React is already in scope." Models write an import of React from
   * "react" anyway — measured on four of six models in one bench sweep. Babel's commonjs transform
   * turns that into a require("react") call, and with no require defined the whole module threw
   * before exports.default was ever assigned. The failure was invisible in the worst way:
   * the code was perfectly good, every static check passed, and the student got a blank board with
   * the generic "could not render" fallback.
   *
   * Resolving the handful of names that are genuinely in scope costs nothing and turns a total
   * failure into a working board. Anything else still throws — an unknown module is a real
   * problem, and pretending otherwise would hide it.
   */
  function require(name) {
    if (name === "react") return React;
    if (name === "react-dom") return ReactDOM;
    if (name === "react/jsx-runtime" || name === "react/jsx-dev-runtime") {
      return { jsx: React.createElement, jsxs: React.createElement, Fragment: React.Fragment };
    }
    if (${JSON.stringify(MOTION_MODULE_NAMES)}.indexOf(name) >= 0) return { motion: motion };
    throw new Error("Module not available in the board sandbox: " + name);
  }

  try {
    var exports = {}; // transform-modules-commonjs output assigns onto this
    ${transpiledCode}
    Animation = exports.default;
  } catch (err) {
    reportError(err);
  }

  function numberAttr(node, name, fallback) {
    var value = Number(node.getAttribute(name));
    return Number.isFinite(value) ? value : fallback;
  }

  // Host layout and the teaching timeline: measured text fitting, leaders that move with their
  // labels, the heading stack, word-true handwriting, arrow holds and the pane fit. Source text
  // from lib/anim/sandboxLayout.ts (its pure half is unit-tested there).
${SANDBOX_LAYOUT_CORE}
${SANDBOX_LAYOUT_HOST}

  /*
   * SETTLING. The hand stops when the clock stops: a pause, an interruption, a gap before the next
   * sentence's audio, or a clock that ended a hair short of 1. A board frozen mid-word read "chlo"
   * for as long as the student looked at it. So a quiet clock (no new progress for a moment)
   * finishes the word in progress, and an explicit settle from the player finishes the line.
   * Neither is ever taken back when the clock resumes (see the high-water marks in the timeline).
   */
  var SETTLE_AFTER_MS = 240;
  var settleTimer = 0;
  var settleMode = null;
  var lastArgs = null;
  function applyWithSettle() {
    if (!lastArgs || MOTION_BOARD) return;
    try {
      applyTeachingTimeline(lastArgs[0], lastArgs[1], lastArgs[2], lastArgs[3], settleMode);
      postTextMap();
    } catch (e) {}
  }
  function armSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(function () {
      if (settleMode !== "line") settleMode = "word";
      applyWithSettle();
    }, SETTLE_AFTER_MS);
  }

  function render(progress, sentenceIndex, sentenceProgress, sentenceTotal) {
    if (hasErrored || typeof Animation !== "function") return;
    var changed = !lastArgs || lastArgs[0] !== progress || lastArgs[1] !== sentenceIndex || lastArgs[2] !== sentenceProgress || lastArgs[3] !== sentenceTotal;
    lastArgs = [progress, sentenceIndex, sentenceProgress, sentenceTotal];
    if (changed) settleMode = null;
    armSettle();
    try {
      if (!root) root = ReactDOM.createRoot(document.getElementById("root"));

      /**
       * Re-render the component only when its output can actually differ, and let the teaching
       * timeline run on every message.
       *
       * The player drives progress from the audio clock, so this handler fires ~60x/sec. Each call
       * used to run a full React reconciliation of the whole board — 130+ SVG nodes — and then wait
       * two animation frames before styling anything. That is far more work than a frame budget
       * allows on a detailed board, so the drawing advanced in visible jumps rather than smoothly.
       *
       * Almost none of that work changed anything. Generated components read progress at coarse
       * granularity (phase thresholds, step indices), while the SMOOTH part of the motion is the
       * timeline below, which is plain attribute/style writes and costs a fraction as much. So the
       * React pass is quantised to ~1% steps: visually identical, roughly 100 reconciliations
       * across a beat instead of thousands.
       *
       * The double-rAF path is preserved exactly for the frames that do re-render, because it is
       * load-bearing — see the comment below. Frames that skip the re-render need no such wait:
       * the committed DOM is already on screen, so the timeline can style it immediately, which is
       * also what makes the in-between frames cheap.
       */
      var quantised = Math.round(progress * 100) / 100;
      // A Motion board also re-renders the moment a new sentence starts, so its reveal is on time.
      var renderKey = MOTION_BOARD ? quantised + "|" + boardProps(progress, sentenceIndex, sentenceProgress, sentenceTotal).sentence : quantised;
      var needsRender = lastRenderedProgress === null || renderKey !== lastRenderedProgress;

      if (!needsRender) {
        cancelAnimationFrame(timelineFrame);
        if (!MOTION_BOARD) applyTeachingTimeline(progress, sentenceIndex, sentenceProgress, sentenceTotal, settleMode);
        postTextMap();
        return;
      }
      lastRenderedProgress = renderKey;

      root.render(React.createElement(Animation, boardProps(progress, sentenceIndex, sentenceProgress, sentenceTotal)));
      cancelAnimationFrame(timelineFrame);
      // DOUBLE rAF, deliberately. root.render() is asynchronous, so on a single frame the
      // timeline can run BEFORE React commits: it styles the old nodes, React then swaps in new
      // ones, and those keep the stylesheet default of opacity 0. The board renders completely
      // blank with no error, and it does so intermittently — the more elements the board has, the
      // slower the commit and the likelier the miss, which is why small boards looked fine and
      // detailed ones never appeared. Waiting a second frame puts this after commit and paint.
      timelineFrame = requestAnimationFrame(function () {
        timelineFrame = requestAnimationFrame(function () {
          if (!MOTION_BOARD) applyTeachingTimeline(progress, sentenceIndex, sentenceProgress, sentenceTotal, settleMode);
          postTextMap();
        });
      });
    } catch (err) {
      reportError(err);
    }
  }

  /*
   * BOOT. The board font is a data: URI, so it decodes in milliseconds, but text measured before it
   * lands would be laid out in the fallback font and then reflow. Wait for it (bounded — a font
   * problem must never hold a board back), lay the finished board out once, then start.
   */
  var booted = false;
  var pendingArgs = null;
  function whenFontsReady(done) {
    var finished = false;
    function finish() { if (!finished) { finished = true; done(); } }
    setTimeout(finish, 700);
    try {
      if (document.fonts && document.fonts.load) {
        Promise.all([
          document.fonts.load('600 24px "${BOARD_FONT_FAMILY}"'),
          document.fonts.load('800 24px "${BOARD_FONT_FAMILY}"')
        ]).then(finish, finish);
      } else {
        finish();
      }
    } catch (e) { finish(); }
  }

  function boot() {
    if (hasErrored || typeof Animation !== "function") return;
    try {
      root = ReactDOM.createRoot(document.getElementById("root"));
      // Motion jumps, not glides, until the first real frame has landed (see setMotionInstant).
      setMotionInstant(true);
      prepareBoardLayout(function (p) {
        // Laid out from the finished board: a Motion board is measured with every step revealed.
        ReactDOM.flushSync(function () { root.render(React.createElement(Animation, boardProps(p, 999, 1, 999))); });
      });
    } catch (err) {
      reportError(err);
      return;
    }
    booted = true;
    lastRenderedProgress = null;
    var args = pendingArgs || [${INITIAL_REVEAL_PROGRESS}, 0, 0, 1];
    render(args[0], args[1], args[2], args[3]);
    postToParent({ type: "ready" });
    postTextMap();
    // The first frame commits and styles over two animation frames (render's double rAF); Motion
    // starts its animations just after commit. Glides begin only once that frame is on screen.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        setTimeout(function () {
          setMotionInstant(false);
          // The pen starts on the first real frame, never on the layout pass's finished board.
          if (MOTION_BOARD) PEN.start(args[1], args[2]);
        }, 120);
      });
    });
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "snapshot") { postSnapshot(data.id); return; }
    if (data.type === "pen") {
      if (MOTION_BOARD) { PEN.pause(data.paused === true); PEN.glyph(data.glyph !== false); }
      return;
    }
    if (data.type === "annotate") {
      if (MOTION_BOARD) PEN.annotate({ marks: Array.isArray(data.marks) ? data.marks : [], note: typeof data.note === "string" ? data.note.slice(0, 40) : "" });
      return;
    }
    if (data.type === "settle") {
      settleMode = data.scope === "word" ? "word" : "line";
      if (booted) applyWithSettle();
      return;
    }
    if (data.type === "progress") {
      var args = [
        typeof data.value === "number" ? data.value : 0,
        typeof data.sentenceIndex === "number" ? data.sentenceIndex : 0,
        typeof data.sentenceProgress === "number" ? data.sentenceProgress : 0,
        typeof data.sentenceTotal === "number" ? data.sentenceTotal : 1
      ];
      if (!booted) { pendingArgs = args; return; }
      render(args[0], args[1], args[2], args[3]);
    }
  });

  // The pane can change shape (window resize, the chat dock opening); refit from the ink measured
  // at mount — no re-render needed, the viewBox is the only thing that changes.
  window.addEventListener("resize", function () {
    try { fitBoardToPane(document.querySelector("#root > svg")); } catch (e) {}
  });

  if (!hasErrored) whenFontsReady(boot);
})();
<\/script>
</body>
</html>`;
}

export function ReactAnimationSandbox({
  code,
  progress,
  sentenceIndex = 0,
  sentenceProgress = 0,
  sentenceTotal = 1,
  assetIds,
  settled = false,
  onError,
  onReady,
}: {
  code: string;
  progress?: number;
  sentenceIndex?: number;
  sentenceProgress?: number;
  sentenceTotal?: number;
  /** Catalogue artwork this board places; resolved to markup via /api/animation-assets. */
  assetIds?: string[];
  /**
   * The narration is paused or interrupted. The sandbox finishes the word and line being written
   * and any stroke in progress, so a stopped board never reads "chlo". The sandbox also settles on
   * its own when the clock goes quiet; this makes a deliberate pause immediate and complete.
   */
  settled?: boolean;
  onError?: () => void;
  /**
   * The sandboxed document has run its script and is listening for progress.
   *
   * Until this fires the board is NOT on screen: the component returns null while Babel and the
   * React runtime load and the code transpiles, and the iframe then shows only the component's
   * static background until it acknowledges. The player's title card needs this moment — "code
   * exists" was being read as "board is visible", which put a blank board on screen for seconds.
   */
  onReady?: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [marker, setMarker] = useState<MarkerState>({ x: 50, y: 25, rotate: 18, visible: false });
  const erroredRef = useRef(false);
  const readyRef = useRef(false);
  // Both a ref and state: the ref is read by the watchdog without re-rendering, the state is what
  // makes the progress effect re-run once the sandbox is listening (see its dependency list).
  const [ready, setReady] = useState(false);

  const reportFailure = useMemo(
    () => () => {
      if (erroredRef.current) return;
      erroredRef.current = true;
      setFailed(true);
      onError?.();
    },
    [onError]
  );

  // Transpile once on mount. The caller always mounts a fresh instance per beat (key={beat.id}
  // in components/LessonPlayer.tsx's VisualDirector), so `code` is effectively fixed for this
  // component's whole lifetime — no need to react to it changing after mount.
  useEffect(() => {
    let cancelled = false;
    Promise.all([transpile(code), loadReactRuntime(), loadAssetRuntime(assetIds), loadBoardFont(), loadIllustration(code)])
      .then(([out, runtime, assets, fontCss, illustration]) => {
        if (!cancelled) setSrcDoc(buildSrcDoc(out, runtime, assets, fontCss, isMotionBoard(code), motionBoardSentenceCount(code), illustration));
      })
      .catch(() => {
        if (!cancelled) reportFailure();
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately mount-once, see comment above
  }, []);

  // Watchdog: if the sandboxed document never acknowledges "ready" (hung script, infinite loop
  // on mount, transpile output that throws before reaching the ready postMessage), treat it as
  // failed so the caller falls back to LiveSketch rather than showing a blank board forever.
  useEffect(() => {
    if (!srcDoc || failed) return;
    const timer = window.setTimeout(() => {
      if (!readyRef.current) reportFailure();
    }, READY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [srcDoc, failed, reportFailure]);

  // Relay progress into the sandbox. Target origin "*" is fine: the iframe has an opaque origin
  // and nothing secret to leak to, so there's no confidentiality requirement on the target check.
  useEffect(() => {
    if (!srcDoc || failed) return;
    const value = Math.max(INITIAL_REVEAL_PROGRESS, Math.max(0, Math.min(1, progress ?? 0)));
    iframeRef.current?.contentWindow?.postMessage({
      type: "progress",
      value,
      sentenceIndex,
      sentenceProgress,
      sentenceTotal,
    }, "*");
    // `ready` is in the dependency list so this RE-POSTS once the sandbox is actually listening.
    // The first post fires as soon as `srcDoc` exists, which is before the iframe has parsed its
    // script and registered its message handler, so that one is dropped on the floor. Narration
    // usually masks it here — progress ticks continuously and the next post lands milliseconds
    // later — but a paused beat or a static board has nothing to follow up with, and then the
    // board sits at opacity 0 forever with no error.
  }, [srcDoc, failed, ready, progress, sentenceIndex, sentenceProgress, sentenceTotal]);

  useEffect(() => {
    if (!srcDoc || failed || !ready || !settled) return;
    iframeRef.current?.contentWindow?.postMessage({ type: "settle", scope: "line" }, "*");
  }, [srcDoc, failed, ready, settled, progress, sentenceIndex, sentenceProgress]);

  // The board's pen (Motion boards) stops when the student pauses and goes on when they resume; in the
  // classroom it also waits while the teacher walks to it (lib/classroom/penTip.ts).
  const [teacherHold, setTeacherHold] = useState(false);
  const [teacherHere, setTeacherHere] = useState(isTeacherPresent);
  useEffect(() => {
    const onHold = (e: Event) => setTeacherHold((e as CustomEvent<boolean>).detail === true);
    const onPresent = (e: Event) => setTeacherHere((e as CustomEvent<boolean>).detail === true);
    window.addEventListener(PEN_HOLD_EVENT, onHold);
    window.addEventListener(TEACHER_PRESENT_EVENT, onPresent);
    return () => {
      window.removeEventListener(PEN_HOLD_EVENT, onHold);
      window.removeEventListener(TEACHER_PRESENT_EVENT, onPresent);
    };
  }, []);
  useEffect(() => {
    if (!srcDoc || failed || !ready) return;
    iframeRef.current?.contentWindow?.postMessage({ type: "pen", paused: settled || teacherHold, glyph: !teacherHere }, "*");
  }, [srcDoc, failed, ready, settled, teacherHold, teacherHere]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "ready") {
        readyRef.current = true;
        setReady(true);
        onReady?.();
      }
      if (data.type === "viewport" && iframeRef.current) {
        const vb = data.viewBox;
        const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
        if (vb && finite(vb.x) && finite(vb.y) && finite(vb.width) && finite(vb.height) && vb.width > 0 && vb.height > 0 && finite(data.width) && finite(data.height)) {
          const au = data.authored;
          const authoredOk = au && finite(au.x) && finite(au.y) && finite(au.width) && finite(au.height) && au.width > 0 && au.height > 0;
          viewportRegistry.set(iframeRef.current, {
            viewBox: { x: vb.x, y: vb.y, width: vb.width, height: vb.height },
            authored: authoredOk ? { x: au.x, y: au.y, width: au.width, height: au.height } : { x: 0, y: 0, width: 1000, height: 560 },
            width: data.width,
            height: data.height,
          });
          window.dispatchEvent(new Event(SANDBOX_VIEWPORT_EVENT));
        }
      }
      if (data.type === "textmap" && Array.isArray(data.items) && iframeRef.current) {
        registerSandboxText(iframeRef.current, data.items.filter((item: unknown) => item && typeof item === "object"));
      }
      // The pen's tip, in page pixels, for anything that wants to follow the writing (the classroom teacher).
      if (data.type === "pen-tip" && iframeRef.current) {
        const r = iframeRef.current.getBoundingClientRect();
        const detail = data.on === true && Number.isFinite(data.x) && Number.isFinite(data.y)
          ? { on: true, x: r.left + data.x * r.width, y: r.top + data.y * r.height }
          : { on: false };
        window.dispatchEvent(new CustomEvent(PEN_TIP_EVENT, { detail }));
      }
      if (data.type === "marker") {
        setMarker({
          x: Number.isFinite(data.x) ? data.x : 50,
          y: Number.isFinite(data.y) ? data.y : 25,
          rotate: Number.isFinite(data.rotate) ? data.rotate : 18,
          visible: data.visible === true,
        });
      }
      if (data.type === "error") reportFailure();
    }
    window.addEventListener("message", onMessage);
    /*
     * No unregister here. This effect re-runs on every render (`reportFailure` wraps an inline
     * callback from the caller), and a cleanup that dropped the registration was emptying the
     * text map sixty times a second while the iframe only ever posts it once. A detached iframe is
     * pruned by the lookup itself (`isConnected`), which is the only unregistration needed.
     */
    return () => window.removeEventListener("message", onMessage);
  }, [reportFailure, onReady]);

  if (failed || !srcDoc) return null;
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#fbfbf8]">
      <iframe
        ref={iframeRef}
        title="Generated animation"
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        className="h-full w-full border-0"
      />
      {/* No host marker. A teal stylus used to hover here, following the writing a beat behind it,
          and competed with what the student reads. A Motion board now carries its own small pen
          INSIDE the board (PEN_WRITER_SOURCE, lib/anim/sandboxMotion.ts), drawn at the edge of the
          ink on the same frame, so it can never lag the text; it fades out when it has nothing to
          write. The iframe still POSTS legacy marker positions; they are ignored. */}
    </div>
  );
}
