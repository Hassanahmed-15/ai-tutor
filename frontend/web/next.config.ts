import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Emit `.next/standalone` — a self-contained server bundle with only the node_modules it
   * actually needs.
   *
   * Required by the Dockerfile's runtime stage, which copies that directory and runs
   * `node frontend/web/server.js`. Without it the build succeeds and the image build then fails at
   * `COPY failed: stat app/frontend/web/.next/standalone: file does not exist` — which is exactly
   * how the first deploy of this branch failed, because the setting existed only on main.
   *
   * No effect on local development; it changes what `next build` writes, nothing else.
   */
  output: "standalone",
  // Pin the workspace root. Next infers it by scanning upward for a lockfile, and a stray empty
  // package-lock.json sits in Ai-lesson/ (the parent of this repo), so it was inferring that as the
  // root — scoping Turbopack's resolution and file watching over every unrelated project in that
  // folder. ai-tutor/ is the real root: it holds the workspaces package.json, the lockfile, and
  // node_modules. Also silences the "inferred your workspace root" startup warning.
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
  // @resvg/resvg-js, @napi-rs/canvas, and pdfjs-dist all ship/require a native .node binary (or,
  // for pdfjs-dist, dynamically `require("@napi-rs/canvas")` at runtime); each must be treated as
  // an external server package so Next/Turbopack doesn't try to bundle the native addon into the
  // route handler (which makes the runtime import/require fail). Used by the vision board critic
  // (lib/boardVisionCritic.ts), the PDF export route, and the PDF upload parser (parse-pdf route).
  serverExternalPackages: ["@resvg/resvg-js", "@napi-rs/canvas", "pdfjs-dist"],
  /**
   * Cache the voice model and its runtime.
   *
   * Next serves everything under public/ with `cache-control: public, max-age=0`, so the browser
   * revalidates on every load and the 14MB ONNX runtime plus the 2.3MB model are fetched again
   * each time. Measured on the deployed app: 52 seconds before the neural VAD was ready, during
   * which the voice gate silently runs on the weaker acoustic heuristic — long enough to cover a
   * whole first exchange.
   *
   * These are safe to cache hard because neither is edited in place: the runtime is copied out of
   * the installed package by scripts/copy-ort.mjs and changes only when the package version does,
   * and the model is a fixed release artefact.
   *
   * Scoped to those two, deliberately. The rest of public/voice/ is our own source — capture-
   * worklet.js is edited between deploys, and freezing it for a year would pin every returning
   * student to a stale worklet with no way to bust it short of renaming the file.
   */
  async headers() {
    const immutable = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];
    return [
      { source: "/ort/:file*", headers: immutable },
      { source: "/voice/silero_vad.onnx", headers: immutable },
    ];
  },
  outputFileTracingIncludes: {
    /**
     * pdf.worker.mjs is loaded by pdfjs at RUNTIME via a path it computes itself, so Next's
     * static tracing never sees the import and drops it from the standalone bundle. The route
     * then failed in production with "Cannot find module … pdf.worker.mjs" while working locally,
     * where the full node_modules is on disk.
     *
     * The route also disables the worker (see parse-pdf), but tracing it in costs nothing and
     * means a future pdfjs version that ignores that option still finds its file.
     */
    "/api/parse-pdf": [
      "./scripts/pdf_pipeline.py",
      "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
    /*
     * These two routes run the SAME Python renderer, and needed tracing of their own.
     *
     * Tracing is per-route, so listing the script under parse-pdf put it in that route's bundle
     * only. `document-pages` has always shelled out to it for thumbnails, and `parse-pptx` now does
     * too on every parse — it renders the real slides so the lecture can look at them, where before
     * it only did so when a region had been dragged. Without an entry here both fail in the
     * standalone build with a missing script, while working locally where the repo is on disk —
     * the same trap the pdf.worker.mjs comment below describes.
     */
    "/api/document-pages": ["./scripts/pdf_pipeline.py"],
    "/api/parse-pptx": ["./scripts/pdf_pipeline.py"],
  },
};

export default nextConfig;
