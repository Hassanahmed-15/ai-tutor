/**
 * Installs the worker's module-resolution hook, then gets out of the way.
 *
 * Separate from worker-loader.mjs because `module.register` runs the hook on its own thread: this
 * file executes on the main thread and only points at the hook. See worker-loader.mjs for why the
 * hook exists at all.
 */
import { createRequire } from "node:module";
import Module from "node:module";
import path from "node:path";
import { register } from "node:module";

register("./worker-loader.mjs", import.meta.url);

/*
 * The CommonJS half of the same fix.
 *
 * The ESM hook above only sees `import` specifiers. tsx transpiles the worker's TypeScript to
 * CommonJS, so `import "server-only"` becomes a `require("server-only")` that never reaches the
 * ESM resolver — and the package's index.js throws on sight. Patching `Module._resolveFilename` is
 * the CJS equivalent of the loader hook: the same redirect, on the path tsx actually takes.
 *
 * Both are needed. Dropping either one puts the worker back to choosing between a vision critic
 * that cannot render and a process that will not start.
 */
const require = createRequire(import.meta.url);
const EMPTY = path.join(path.dirname(require.resolve("server-only")), "empty.js");
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return EMPTY;
  return resolveFilename.call(this, request, ...rest);
};
