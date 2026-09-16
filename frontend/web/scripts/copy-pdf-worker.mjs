#!/usr/bin/env node
/**
 * Copies pdfjs-dist's worker script into public/ before every build.
 *
 * WHY A COPY AND NOT A CHECKED-IN FILE. The worker is a build artifact of the pdfjs-dist package
 * bundled at a specific version, so a copy committed to the repo would silently drift the moment
 * `pdfjs-dist` is bumped — the app would load a worker from a different version than the client
 * bundle expects, which pdf.js detects and refuses to run. Copying at build time from whatever
 * version is actually installed makes that impossible: the worker and the library are always the
 * same version, because they come from the same install.
 *
 * WHY A STATIC PUBLIC FILE AND NOT A BUNDLED WORKER URL. Turbopack can resolve
 * `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`, but the standalone Docker
 * output only copies what Next's tracer sees statically referenced, and a worker path pdf.js
 * constructs at runtime (see the existing outputFileTracingIncludes comment in next.config.ts for
 * the same trap with the Python pipeline) is exactly the kind of reference the tracer cannot see. A
 * plain file under public/ is unconditionally copied into the standalone build and served as a
 * static asset with no bundler involvement at all — the same reason document thumbnails are data
 * URIs rather than files needing their own serving path.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");

const workerSource = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
const workerDest = path.join(publicDir, "pdf.worker.min.mjs");

await mkdir(publicDir, { recursive: true });
await copyFile(workerSource, workerDest);
console.log(`[copy-pdf-worker] ${workerSource} -> ${workerDest}`);
