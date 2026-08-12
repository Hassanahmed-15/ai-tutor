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
  outputFileTracingIncludes: {
    "/api/parse-pdf": ["./scripts/pdf_pipeline.py"],
  },
};

export default nextConfig;
