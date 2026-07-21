"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
const INITIAL_REVEAL_PROGRESS = 0.2;

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
    reactRuntimePromise = Promise.all([
      fetch("/sandbox/react.production.min.js").then((r) => r.text()),
      fetch("/sandbox/react-dom.production.min.js").then((r) => r.text()),
    ]).then(([react, reactDom]) => ({ react, reactDom }));
  }
  return reactRuntimePromise;
}

async function transpile(code: string): Promise<string> {
  const cached = transpileCache.get(code);
  if (cached) return cached;
  const Babel = await import("@babel/standalone");
  // The "react" preset alone only strips JSX — it leaves `export default` as real ES module
  // syntax, which a plain (non type="module") <script> tag cannot execute. transform-modules-
  // commonjs rewrites it to `exports.default = Animation`, which the shim below reads after
  // pre-declaring a bare `exports` object for it to assign onto.
  const result = Babel.transform(code, {
    // CLASSIC runtime, not automatic: the automatic runtime emits `require("react/jsx-runtime")`,
    // a bare require the sandbox has no module loader for → "require is not defined" at runtime.
    // Classic compiles JSX to `React.createElement(...)`, referencing the global React UMD that
    // IS present in the sandbox. Explicit pragma keeps it deterministic across Babel versions.
    presets: [["react", { runtime: "classic", pragma: "React.createElement", pragmaFrag: "React.Fragment" }]],
    plugins: ["transform-modules-commonjs"],
    filename: "animation.jsx",
  });
  const out = result.code ?? "";
  transpileCache.set(code, out);
  return out;
}

function buildSrcDoc(transpiledCode: string, runtime: { react: string; reactDom: string }): string {
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

  function render(progress) {
    if (hasErrored || typeof Animation !== "function") return;
    try {
      if (!root) root = ReactDOM.createRoot(document.getElementById("root"));
      root.render(React.createElement(Animation, { progress: progress }));
    } catch (err) {
      reportError(err);
    }
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "progress") render(typeof data.value === "number" ? data.value : 0);
  });

  if (!hasErrored) {
    render(${INITIAL_REVEAL_PROGRESS});
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
  onError,
}: {
  code: string;
  progress?: number;
  onError?: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const erroredRef = useRef(false);
  const readyRef = useRef(false);

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
    Promise.all([transpile(code), loadReactRuntime()])
      .then(([out, runtime]) => {
        if (!cancelled) setSrcDoc(buildSrcDoc(out, runtime));
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
    iframeRef.current?.contentWindow?.postMessage({ type: "progress", value }, "*");
  }, [srcDoc, failed, progress]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "ready") readyRef.current = true;
      if (data.type === "error") reportFailure();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [reportFailure]);

  if (failed || !srcDoc) return null;
  const rawProgress = Math.max(0, Math.min(1, progress ?? 0));
  const visibleProgress = Math.max(INITIAL_REVEAL_PROGRESS, rawProgress);
  const marker = markerPosition(visibleProgress);

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
          transform: `translate(-10%, -88%) rotate(${marker.rotate}deg)`,
          transition: "left 90ms linear, top 90ms linear, transform 90ms linear",
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

function markerPosition(progress: number): { x: number; y: number; rotate: number } {
  const p = Math.max(0, Math.min(1, progress));
  const points = [
    { x: 32, y: 24, rotate: 20 },
    { x: 58, y: 32, rotate: 32 },
    { x: 72, y: 48, rotate: 18 },
    { x: 44, y: 64, rotate: -18 },
    { x: 68, y: 76, rotate: 28 },
  ];
  const scaled = p * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(scaled));
  const t = scaled - i;
  const a = points[i];
  const b = points[i + 1];
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    rotate: a.rotate + (b.rotate - a.rotate) * t,
  };
}
