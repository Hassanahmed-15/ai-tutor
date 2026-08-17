import path from "node:path";
import { existsSync } from "node:fs";

/**
 * Resolve files that ship alongside the app, correctly in BOTH local dev and the container.
 *
 * THE BUG THIS EXISTS TO KILL. Modules resolved bundled files with
 * `path.join(process.cwd(), "scripts", …)`, which quietly means two different directories:
 *
 *   local dev   `npm run dev` runs inside frontend/web  → cwd = …/frontend/web  ✓ resolves
 *   container   CMD is `node frontend/web/server.js`
 *               with WORKDIR /app                        → cwd = /app          ✗ missing
 *
 * Next's standalone output keeps the app under `frontend/web/`, and the Dockerfile copies
 * `scripts/` and `public/` to `/app/frontend/web/…`, but the server process starts at `/app`. So
 * every cwd-relative path pointed one directory too high in production and nowhere else.
 *
 * It failed silently, which is what made it expensive: the PDF pipeline caught the spawn error and
 * fell back to a degraded path, and the asset catalogue returned an empty list rather than
 * throwing — so uploads "worked" and boards were simply worse, with nothing in the log tying the
 * two together.
 *
 * Rather than hardcode either layout, this probes for the directory that actually exists. That
 * keeps one code path for dev, `next start`, the standalone server, and tests, none of which agree
 * on cwd.
 */

/** Candidate roots, most specific first. */
function resolveAppRoot(): string {
  const cwd = process.cwd();
  const candidates = [
    cwd, // local dev, `next start`, tests — already inside frontend/web
    path.join(cwd, "frontend", "web"), // container: cwd is /app, app lives one level down
  ];
  // `scripts/` ships in every deployment and is not created by a build, so its presence is a
  // reliable marker for "this is the app root" — unlike .next, which exists in both places.
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "scripts"))) return candidate;
  }
  // Nothing matched: fall back to cwd so behaviour is unchanged from before rather than throwing
  // at module load and taking the whole server down.
  return cwd;
}

const APP_ROOT = resolveAppRoot();

/** Absolute path to a file or directory shipped with the app. */
export function appPath(...segments: string[]): string {
  return path.join(APP_ROOT, ...segments);
}

/** Exposed for diagnostics — the health route reports it so a wrong root is visible immediately. */
export function appRoot(): string {
  return APP_ROOT;
}
