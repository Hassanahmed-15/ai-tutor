import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored third-party UMD builds for the sandboxed React-animation iframe — not app
    // source, never authored or edited here. See components/sketch/ReactAnimationSandbox.tsx.
    "public/sandbox/**",
    // pdfjs-dist's own minified worker script, copied into public/ at dev/build time by
    // scripts/copy-pdf-worker.mjs — a vendored build artifact, not source written here, and
    // also gitignored for the same reason (see .gitignore).
    "public/pdf.worker.min.mjs",
  ]),
]);

export default eslintConfig;
