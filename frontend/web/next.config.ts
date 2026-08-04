import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
