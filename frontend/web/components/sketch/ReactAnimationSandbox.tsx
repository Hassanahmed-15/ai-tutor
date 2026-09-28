"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { keepContentLabels } from "@/lib/board/contentLabels";
import { registerSandboxText } from "@/lib/board/sandboxBridge";
import { ANIM_SANDBOX_RUNTIME } from "../../lib/anim/sandboxRuntime";
import { SANDBOX_LAYOUT_CORE, SANDBOX_LAYOUT_HOST } from "../../lib/anim/sandboxLayout";
import { escapeStrayLessThan, type ParseLoc } from "../../lib/jsxRepair";

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
let reactRuntimePromise: Promise<{ react: string; reactDom: string }> | null = null;
function loadReactRuntime(): Promise<{ react: string; reactDom: string }> {
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
    ])
      .then(([react, reactDom]) => ({ react, reactDom }))
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
 * Playpen Sans (SIL OFL 1.1 — public/fonts/PlaypenSans-OFL.txt), a handwriting face designed for
 * legibility in education, subset to Latin, Latin-1/Extended-A, Greek and the science symbols, as
 * two static weights: SemiBold for body text and labels, ExtraBold for headings. The .woff2 files
 * feed this document; the matching .ttf files are for server-side measurement and rasterising
 * (resvg reads TTF), so the critic measures the very glyphs the student sees.
 *
 * Fetched once per page and cached as CSS text, in parallel with the React runtime and warmed by
 * warmSandbox(), so no board waits on it. A failed fetch resolves to "" and the board falls back to
 * the system handwriting stack — a font must never be the reason a board does not appear. Not
 * memoised on failure, for the same reason as the runtime above.
 */
const BOARD_FONT_FACES = [
  { url: "/fonts/PlaypenSans-SemiBold.woff2", weight: "100 650" },
  { url: "/fonts/PlaypenSans-ExtraBold.woff2", weight: "651 1000" },
];
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
        return `@font-face{font-family:"Playpen Sans";src:url(${dataUrl}) format("woff2");font-weight:${face.weight};font-style:normal;font-display:block;}`;
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
  runtime: { react: string; reactDom: string },
  /**
   * Defines <Asset/> and the artwork it can place. Injected AFTER the motion runtime and BEFORE
   * the component, and it must match what lib/reactAnimationVisionCritic.ts prepends server-side —
   * a critic that scores a board without its artwork is scoring a picture nobody sees.
   */
  assetRuntime = "",
  /** The board font's @font-face rules (data: URIs), or "" to fall back to system handwriting. */
  fontCss = "",
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
/*
 * NO LABELS. Animated boards carry no labels (the prompt forbids them — NO_LABELS_RULE in
 * lib/drawPrompt.ts); this hides any a board still has, including every board generated before the
 * rule, so a lesson never shows one. Hidden elements take no part in the fit-to-ink layout.
 */
[data-teach-kind="label"]{display:none!important;}
/*
 * ONE FONT, EVERYWHERE. The board used to name "Chalkboard SE" — a macOS font — so Windows students
 * got Comic Sans, Linux got a sans, and every width the layout was planned against was wrong
 * somewhere. Playpen Sans (OFL, public/fonts) ships inside the document, so the glyphs, and every
 * measurement taken from them, are identical on every machine and in the server-side critic.
 * Weight is the author's, mapped onto the two shipped faces: body text SemiBold, headings ExtraBold.
 */
svg text{
  font-family:"Playpen Sans","Chalkboard SE","Marker Felt","Comic Sans MS","Trebuchet MS",sans-serif!important;
  letter-spacing:0!important;
  font-kerning:normal;
  transition:opacity 80ms linear!important;
}
[data-teach-order]{opacity:0;}
/* A border drawn around the authored 1000x560 box means nothing once the board is fitted to its pane. */
svg[data-host-fitted] [data-host-frame]{stroke-opacity:0!important;}
</style>
</head>
<body>
<div id="root"></div>
<script>${runtime.react}<\/script>
<script>${runtime.reactDom}<\/script>
<script>
(function () {
  var root = null;
  var Animation = null;
  var hasErrored = false;
  var timelineFrame = 0;
  // Last progress value actually committed through React, quantised to 1%. Lets render() skip
  // reconciliation on the ~60/sec messages that would produce an identical tree. See render().
  var lastRenderedProgress = null;

  // Easing/composition helpers, declared before the generated component runs so it can call
  // them by name. Function declarations hoist, so they are in scope inside the try block below.
${ANIM_SANDBOX_RUNTIME}
${assetRuntime}

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
    if (!lastArgs) return;
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
      var needsRender = lastRenderedProgress === null || quantised !== lastRenderedProgress;

      if (!needsRender) {
        cancelAnimationFrame(timelineFrame);
        applyTeachingTimeline(progress, sentenceIndex, sentenceProgress, sentenceTotal, settleMode); postTextMap();
        return;
      }
      lastRenderedProgress = quantised;

      root.render(React.createElement(Animation, { progress: progress }));
      cancelAnimationFrame(timelineFrame);
      // DOUBLE rAF, deliberately. root.render() is asynchronous, so on a single frame the
      // timeline can run BEFORE React commits: it styles the old nodes, React then swaps in new
      // ones, and those keep the stylesheet default of opacity 0. The board renders completely
      // blank with no error, and it does so intermittently — the more elements the board has, the
      // slower the commit and the likelier the miss, which is why small boards looked fine and
      // detailed ones never appeared. Waiting a second frame puts this after commit and paint.
      timelineFrame = requestAnimationFrame(function () {
        timelineFrame = requestAnimationFrame(function () {
          applyTeachingTimeline(progress, sentenceIndex, sentenceProgress, sentenceTotal, settleMode); postTextMap();
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
          document.fonts.load('600 24px "Playpen Sans"'),
          document.fonts.load('800 24px "Playpen Sans"')
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
      prepareBoardLayout(function (p) {
        ReactDOM.flushSync(function () { root.render(React.createElement(Animation, { progress: p })); });
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
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "snapshot") { postSnapshot(data.id); return; }
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
    Promise.all([transpile(code), loadReactRuntime(), loadAssetRuntime(assetIds), loadBoardFont()])
      .then(([out, runtime, assets, fontCss]) => {
        if (!cancelled) setSrcDoc(buildSrcDoc(out, runtime, assets, fontCss));
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
      {/* The marker is gone deliberately — a teal stylus used to hover here, following the writing.
          The board is what the student reads, and a hand drawn over it competes with exactly the
          thing it is meant to be helping them read. The ink reveal is untouched: text still writes
          on word by word, strokes still draw. Only the hand is removed.

          The iframe still POSTS marker positions; ignoring them here is cheaper than changing the
          sandbox contract, and leaves the position available if a surface ever wants a cursor. */}
    </div>
  );
}
