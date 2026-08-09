"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ANIM_SANDBOX_RUNTIME } from "../../lib/anim/sandboxRuntime";
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
  let source = code;
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
): string {
  // React/ReactDOM are UMD builds pinned at React 18, INLINED (not <script src>) because the
  // opaque-origin sandbox + strict CSP blocks external script tags — see loadReactRuntime above.
  // This is an isolated realm — the sandboxed component never interacts with the app's real
  // React 19 tree outside the iframe, so the version mismatch has no consequence.
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;" />
<style>
html,body{margin:0;padding:0;background:#fbfbf8;width:100%;height:100%;overflow:hidden;}
#root{width:100%;height:100%;box-sizing:border-box;padding:18px;background:#fbfbf8;}
#root>*{width:100%;height:100%;box-sizing:border-box;}
svg{max-width:100%;max-height:100%;overflow:visible;}
svg text{
  font-family:"Chalkboard SE","Marker Felt","Bradley Hand","Comic Sans MS","Trebuchet MS",sans-serif!important;
  font-weight:650!important;
  letter-spacing:0!important;
  transition:opacity 80ms linear!important;
}
[data-teach-order]{opacity:0;}
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

  // Easing/composition helpers, declared before the generated component runs so it can call
  // them by name. Function declarations hoist, so they are in scope inside the try block below.
${ANIM_SANDBOX_RUNTIME}
${assetRuntime}

  function postToParent(msg) {
    try { window.parent.postMessage(msg, "*"); } catch (e) {}
  }

  function reportError(err) {
    if (hasErrored) return; // report once — no retry loop, avoids flicker
    hasErrored = true;
    postToParent({ type: "error", message: err && err.message ? String(err.message) : String(err) });
  }

  window.onerror = function (message) { reportError(message); return true; };

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

  function wordWritingProgress(text, local) {
    var words = String(text || "").trim().split(/\\s+/).filter(Boolean);
    if (!words.length) return local;
    var weights = words.map(function (word, index) {
      var writing = Math.max(0.8, Math.min(2.8, word.length * 0.28));
      var variation = 0.92 + ((word.length * 17 + index * 11) % 19) / 100;
      var pause = /[.!?]$/.test(word) ? 0.7 : /[,;:]$/.test(word) ? 0.3 : 0.1;
      return writing * variation + pause;
    });
    var total = weights.reduce(function (sum, weight) { return sum + weight; }, 0);
    var target = Math.max(0, Math.min(1, local)) * total;
    var consumed = 0;
    for (var i = 0; i < weights.length; i += 1) {
      var word = words[i];
      var slot = weights[i];
      if (target <= consumed + slot) {
        var pauseRatio = /[.!?]$/.test(word) ? 0.24 : /[,;:]$/.test(word) ? 0.13 : 0.06;
        var written = Math.min(1, Math.max(0, (target - consumed) / (slot * (1 - pauseRatio))));
        return (i + written) / words.length;
      }
      consumed += slot;
    }
    return 1;
  }

  function boxFor(node) {
    try {
      var box = node.getBBox();
      if (box && Number.isFinite(box.x)) return box;
    } catch (e) {}
    return { x: numberAttr(node, "x", 500), y: numberAttr(node, "y", 280), width: 1, height: 1 };
  }

  function keepTextInsideBoard(svg) {
    if (svg.getAttribute("data-host-text-safe") === "1") return;
    var viewBox = svg.viewBox && svg.viewBox.baseVal;
    var width = viewBox && viewBox.width ? viewBox.width : 1000;
    var height = viewBox && viewBox.height ? viewBox.height : 560;
    var margin = 42;
    Array.prototype.slice.call(svg.querySelectorAll("text")).forEach(function (node) {
      var box = boxFor(node);
      var dx = 0;
      var dy = 0;
      if (box.x < margin) dx = margin - box.x;
      if (box.x + box.width > width - margin) dx = width - margin - box.x - box.width;
      if (box.y < margin) dy = margin - box.y;
      if (box.y + box.height > height - margin) dy = height - margin - box.y - box.height;
      if (!dx && !dy) return;
      var base = node.getAttribute("transform") || "";
      node.setAttribute("transform", (base + " translate(" + dx + " " + dy + ")").trim());
    });
    svg.setAttribute("data-host-text-safe", "1");
  }

  function setStrokeProgress(node, local) {
    var shapes = node.matches("path,line,polyline,polygon,circle,ellipse,rect")
      ? [node]
      : Array.prototype.slice.call(node.querySelectorAll("path,line,polyline,polygon,circle,ellipse,rect"));
    shapes.forEach(function (shape) {
      shape.setAttribute("pathLength", "1");
      shape.style.strokeDasharray = "1";
      shape.style.strokeDashoffset = String(1 - local);
      shape.style.opacity = local <= 0 ? "0" : "1";
      var originalFill = shape.getAttribute("fill");
      if (originalFill && originalFill !== "none") shape.style.fillOpacity = String(Math.max(0, (local - 0.46) / 0.54));
    });
  }

  function applyTeachingTimeline(progress, sentenceIndex, sentenceProgress, sentenceTotal) {
    var svg = document.querySelector("#root svg");
    if (!svg) return;
    keepTextInsideBoard(svg);
    var steps = Array.prototype.slice.call(svg.querySelectorAll("[data-teach-order]"));
    if (!steps.length) {
      postToParent({ type: "marker", x: 50, y: 28, rotate: 18, visible: false });
      return;
    }
    steps.sort(function (a, b) { return numberAttr(a, "data-teach-order", 0) - numberAttr(b, "data-teach-order", 0); });
    var weights = steps.map(function (step) { return Math.max(0.35, numberAttr(step, "data-teach-weight", 1)); });
    var active = null;
    var activeLocal = 0;
    var sentenceRanges = new Map();
    var sentenceTimed = Number.isFinite(sentenceIndex) && Number.isFinite(sentenceProgress) && steps.every(function (step) {
      return Number.isFinite(Number(step.getAttribute("data-teach-sentence")));
    });
    if (sentenceTimed) {
      var grouped = new Map();
      steps.forEach(function (step, index) {
        var sentence = Math.max(0, Math.min(Math.max(0, sentenceTotal - 1), numberAttr(step, "data-teach-sentence", 0)));
        var list = grouped.get(sentence) || [];
        list.push({ step: step, weight: weights[index] });
        grouped.set(sentence, list);
      });
      grouped.forEach(function (list) {
        var sentenceWeight = list.reduce(function (sum, entry) { return sum + entry.weight; }, 0);
        var sentenceCursor = 0;
        list.forEach(function (entry) {
          sentenceRanges.set(entry.step, { start: sentenceCursor / sentenceWeight, end: (sentenceCursor + entry.weight) / sentenceWeight });
          sentenceCursor += entry.weight;
        });
      });
    }

    var weightedRanges = successionRanges(weights);

    steps.forEach(function (step, index) {
      var kind = step.getAttribute("data-teach-kind") || "diagram";
      // Drawn contours ease (Manim's default on Create) so a stroke accelerates out of rest
      // and settles. Handwriting does NOT: a hand writes a line at a fairly even pace, and
      // easing a whole text line makes the middle words visibly sprint. Previously everything
      // was raw linear, which is why traced contours read like a progress bar dragging a line.
      var ease = kind === "write" || kind === "label" ? null : smooth;
      var local = 0;
      if (sentenceTimed) {
        var stepSentence = Math.max(0, Math.min(Math.max(0, sentenceTotal - 1), numberAttr(step, "data-teach-sentence", 0)));
        var range = sentenceRanges.get(step) || { start: 0, end: 1 };
        local = sentenceIndex > stepSentence
          ? 1
          : sentenceIndex < stepSentence
            ? 0
            : phase(sentenceProgress, range.start, range.end, ease || clamp01);
      } else {
        var timelineRange = weightedRanges[index] || { start: 0, end: 1 };
        local = phase(progress, timelineRange.start, timelineRange.end, ease || clamp01);
      }
      step.style.opacity = local <= 0 ? "0" : "1";
      step.style.transition = "none";
      if (kind === "write" || kind === "label") {
        // The marker arrives first; ink appears a fraction later at the nib. This compensates
        // for the parent-frame message hop and prevents text from visibly leading the hand.
        var inkLocal = Math.max(0, local - 0.035);
        var writing = wordWritingProgress(step.textContent, inkLocal);
        var box = boxFor(step);
        // A completed word must be completely unmasked. Keeping an exact-bounds clip attached
        // could shave off antialiasing or a glyph overhang on the final character (for example G).
        if (writing >= 0.97) {
          step.removeAttribute("clip-path");
        } else {
          var clipId = "teacher-clip-" + index;
          var defs = svg.querySelector("defs");
          if (!defs) {
            defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
            svg.insertBefore(defs, svg.firstChild);
          }
          var clip = svg.querySelector("#" + clipId);
          if (!clip) {
            clip = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
            clip.id = clipId;
            var clipRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            clip.appendChild(clipRect);
            defs.appendChild(clip);
          }
          var rect = clip.firstElementChild;
          // Handwritten glyphs commonly overhang their measured advance width. Give the live
          // reveal enough room for the active glyph's full stroke, especially the last letter.
          var overhang = Math.max(14, box.height * 0.55);
          rect.setAttribute("x", String(box.x - overhang * 0.35));
          rect.setAttribute("y", String(box.y - overhang));
          rect.setAttribute("width", String(Math.max(0, box.width * writing + overhang)));
          rect.setAttribute("height", String(box.height + overhang * 2));
          step.setAttribute("clip-path", "url(#" + clipId + ")");
        }
      } else if (kind === "diagram" || kind === "arrow" || kind === "annotate") {
        step.removeAttribute("clip-path");
        setStrokeProgress(step, Math.max(0, local - 0.025));
      } else {
        step.removeAttribute("clip-path");
        step.style.opacity = String(local);
      }
      if (local > 0 && local < 1) {
        active = step;
        activeLocal = local;
      }
    });

    if (!active) {
      postToParent({ type: "marker", x: 50, y: 25, rotate: 18, visible: false });
      return;
    }
    var box = boxFor(active);
    var activeKind = active.getAttribute("data-teach-kind") || "diagram";
    var x = activeKind === "write" || activeKind === "label" ? box.x + box.width * wordWritingProgress(active.textContent, activeLocal) : box.x + box.width * activeLocal;
    var y = activeKind === "write" || activeKind === "label" ? box.y + box.height * 0.72 : box.y + box.height * (0.25 + activeLocal * 0.5);
    var screenX = x;
    var screenY = y;
    try {
      var point = svg.createSVGPoint();
      point.x = x;
      point.y = y;
      var matrix = svg.getScreenCTM();
      if (matrix) {
        var screenPoint = point.matrixTransform(matrix);
        screenX = screenPoint.x;
        screenY = screenPoint.y;
      }
    } catch (e) {}
    var viewportWidth = Math.max(1, document.documentElement.clientWidth);
    var viewportHeight = Math.max(1, document.documentElement.clientHeight);
    postToParent({
      type: "marker",
      x: Math.max(2, Math.min(98, screenX / viewportWidth * 100)),
      y: Math.max(3, Math.min(96, screenY / viewportHeight * 100)),
      rotate: activeKind === "arrow" ? 34 : activeKind === "write" || activeKind === "label" ? 14 : 24,
      visible: true
    });
  }

  function render(progress, sentenceIndex, sentenceProgress, sentenceTotal) {
    if (hasErrored || typeof Animation !== "function") return;
    try {
      if (!root) root = ReactDOM.createRoot(document.getElementById("root"));
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
          applyTeachingTimeline(progress, sentenceIndex, sentenceProgress, sentenceTotal);
        });
      });
    } catch (err) {
      reportError(err);
    }
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "progress") render(
      typeof data.value === "number" ? data.value : 0,
      typeof data.sentenceIndex === "number" ? data.sentenceIndex : 0,
      typeof data.sentenceProgress === "number" ? data.sentenceProgress : 0,
      typeof data.sentenceTotal === "number" ? data.sentenceTotal : 1
    );
  });

  if (!hasErrored) {
    render(${INITIAL_REVEAL_PROGRESS}, 0, 0, 1);
    postToParent({ type: "ready" });
  }
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
  onError,
}: {
  code: string;
  progress?: number;
  sentenceIndex?: number;
  sentenceProgress?: number;
  sentenceTotal?: number;
  /** Catalogue artwork this board places; resolved to markup via /api/animation-assets. */
  assetIds?: string[];
  onError?: () => void;
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
    Promise.all([transpile(code), loadReactRuntime(), loadAssetRuntime(assetIds)])
      .then(([out, runtime, assets]) => {
        if (!cancelled) setSrcDoc(buildSrcDoc(out, runtime, assets));
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
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "ready") {
        readyRef.current = true;
        setReady(true);
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
    return () => window.removeEventListener("message", onMessage);
  }, [reportFailure]);

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
      <div
        className="pointer-events-none absolute z-20 drop-shadow-[0_8px_12px_rgba(20,184,166,0.26)]"
        style={{
          left: `${marker.x}%`,
          top: `${marker.y}%`,
          opacity: marker.visible ? 1 : 0,
          transform: `translate(-10%, -88%) rotate(${marker.rotate}deg)`,
          transition: "left 28ms linear, top 28ms linear, transform 28ms linear, opacity 45ms linear",
        }}
        aria-hidden="true"
      >
        <svg width="48" height="58" viewBox="0 0 48 58">
          <path d="M 12 52 L 24 18 L 38 24 L 19 56 Z" fill="#0f766e" />
          <path d="M 24 18 L 38 24 L 44 10 L 30 4 Z" fill="#5eead4" />
          <circle cx="13" cy="52" r="4" fill="#0f766e" />
        </svg>
      </div>
    </div>
  );
}
