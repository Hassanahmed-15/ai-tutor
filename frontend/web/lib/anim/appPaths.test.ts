import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { appPath, appRoot } from "../appPaths";

/**
 * These pin the production bug that made PDF uploads fail only when deployed.
 *
 * `process.cwd()` is `frontend/web` under `npm run dev` but `/app` in the container, because the
 * Dockerfile's CMD is `node frontend/web/server.js` from WORKDIR /app. Every cwd-relative path to
 * a bundled file therefore pointed one directory too high in production — and failed silently,
 * because the PDF pipeline caught the spawn error and degraded rather than reporting it.
 */

test("resolves the Python pipeline script to a file that exists", () => {
  const script = appPath("scripts", "pdf_pipeline.py");
  assert.ok(existsSync(script), `pdf_pipeline.py not found at ${script}`);
});

test("resolves the artwork catalogue index to a file that exists", () => {
  // Silently missing artwork does not break a lecture; it just makes every generated board worse,
  // with nothing in the log connecting cause to effect. Worth asserting for that reason.
  const index = appPath("assets", "index.json");
  assert.ok(existsSync(index), `asset catalogue not found at ${index}`);
});

test("the resolved root is the app directory, not the repo root", () => {
  // The distinguishing marker: scripts/ ships in every deployment and is not produced by a build.
  assert.ok(existsSync(appPath("scripts")), "app root has no scripts/ directory");
  assert.ok(!appRoot().endsWith("/ai-tutor"), "resolved the repo root instead of frontend/web");
});

test("appPath joins segments beneath a single root", () => {
  // Built with path.join, not a "/" template, because appPath itself uses path.join — on Windows
  // that yields "root\a\b" and this assertion demanded "root/a/b", so the suite failed on every
  // Windows checkout while passing on macOS and CI. A test that only holds on the author's OS
  // reports the platform, not the behaviour.
  assert.equal(appPath("a", "b"), path.join(appRoot(), "a", "b"));
});
