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
const out = path.resolve(new URL(".", import.meta.url).pathname, "../public/ort");
fs.mkdirSync(out, { recursive: true });
let copied = 0;
for (const name of fs.readdirSync(dist)) {
  // This onnxruntime-web build loads the .jsep variant even for the plain wasm backend (measured:
  // a request for ort-wasm-simd-threaded.jsep.mjs), so both the plain and the jsep files ship.
  if (/^ort-wasm-simd-threaded(\.jsep)?\.(wasm|mjs)$/.test(name)) {
    fs.copyFileSync(path.join(dist, name), path.join(out, name));
    copied += 1;
  }
}
const version = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).version;
fs.writeFileSync(path.join(out, "VERSION"), version);
console.log(`[copy-ort] ${copied} file(s) from onnxruntime-web@${version} → public/ort`);
if (copied === 0) process.exit(1);
