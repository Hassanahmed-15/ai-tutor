/**
 * Self-host the ONNX Runtime WASM next to the app, at build time.
 *
 * Loading it from a CDN by version string is fragile: the version the bundler installed and the
 * version in the URL drift apart, and a 404 on the WASM makes the neural VAD silently unavailable
 * — the failure mode that looks healthy. Copying from node_modules means the served binary is,
 * by construction, the one the installed package expects. Runs as `prebuild`, so Vercel does it
 * too; the output is git- and upload-ignored.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
// The package's exports map hides package.json from require.resolve; resolve the entry and walk up.
let pkgDir = path.dirname(require.resolve("onnxruntime-web"));
while (!(fs.existsSync(path.join(pkgDir, "package.json")) && JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).name === "onnxruntime-web")) {
  const parent = path.dirname(pkgDir);
  if (parent === pkgDir) throw new Error("onnxruntime-web package root not found");
  pkgDir = parent;
}
const dist = path.join(pkgDir, "dist");
/*
 * fileURLToPath, not `.pathname`. On Windows a file URL's pathname is "/E:/Vs%20Code%20Folders/…" —
 * a leading slash and percent-escaped spaces — so path.resolve treated it as relative and produced
 * "E:\E:\Vs%20Code%20Folders\…". predev then died on mkdir and `npm run dev` never started at all.
 */
const out = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../public/ort");
fs.mkdirSync(out, { recursive: true });
let copied = 0;
for (const name of fs.readdirSync(dist)) {
  // Only the plain wasm pair. The umbrella `onnxruntime-web` entry point pulls the GPU-capable
  // .jsep binary (28MB against 14MB), but lib/voice/sileroVad.ts imports `onnxruntime-web/wasm`,
  // which requests these two and never touches .jsep — verified by the network log on a
  // production build. Shipping it anyway would double this directory for a file nothing fetches.
  if (/^ort-wasm-simd-threaded\.(wasm|mjs)$/.test(name)) {
    fs.copyFileSync(path.join(dist, name), path.join(out, name));
    copied += 1;
  }
}
const version = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
fs.writeFileSync(path.join(out, "VERSION"), version);
console.log(`[copy-ort] ${copied} file(s) from onnxruntime-web@${version} → public/ort`);
// Both the loader and the binary, or the build fails here rather than shipping an app whose
// neural VAD 404s at runtime and silently degrades to the heuristic — the failure this whole
// script exists to prevent, and one that looks perfectly healthy from the outside.
if (copied !== 2) {
  console.error(`[copy-ort] expected 2 files, copied ${copied}. Did onnxruntime-web rename its wasm build?`);
  process.exit(1);
}
