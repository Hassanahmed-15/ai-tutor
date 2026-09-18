/**
 * Lets the lecture worker run WITHOUT `--conditions=react-server`.
 *
 * THE BIND THIS SOLVES. The worker's dependency graph needs two things that the react-server
 * condition cannot both satisfy:
 *
 *   with    --conditions=react-server   `server-only` resolves to a no-op (good), but
 *                                       `react-dom/server` resolves to the RSC build, which throws
 *                                       "react-dom/server is not supported in React Server
 *                                       Components" the moment it is imported.
 *   without --conditions=react-server   `react-dom/server` works, but `server-only` throws
 *                                       "This module cannot be imported from a Client Component".
 *
 * The flag was added for the second reason and silently broke the first: every beat logged
 * `[anim-vision] render failed: react-dom/server is not supported in React Server Components`
 * followed by `[anim-refine] final=-1/5`, meaning the vision critic never scored a single
 * animation and every beat shipped unrefined. The lectures still generated, which is why it went
 * unnoticed — they were just worse.
 *
 * `server-only` is a marker package with no runtime behaviour at all (its whole job is to make a
 * bundler fail loudly if a module is imported from the client). The worker is a plain Node process
 * with no client bundle, so the marker has nothing to protect and resolving it to an empty module
 * is exactly what the react-server condition was doing anyway — just without dragging
 * `react-dom/server` down with it.
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

/*
 * Resolved to a real file URL, not the "server-only/empty.js" subpath.
 *
 * The package's `exports` map only declares ".", so the subpath form is refused with "Package
 * subpath './empty.js' is not defined by exports" — even though the file is shipped and is exactly
 * what the map's own "react-server" branch points at. Locating the package's main file and taking
 * its sibling sidesteps the map without hardcoding a node_modules path (this repo hoists to the
 * workspace root, so the package is not under frontend/web).
 */
const require = createRequire(import.meta.url);
const EMPTY_URL = pathToFileURL(
  path.join(path.dirname(require.resolve("server-only")), "empty.js"),
).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: EMPTY_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
