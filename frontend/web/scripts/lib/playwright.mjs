/**
 * Resolve Playwright from this package or the repo root. The figure tools used to import a
 * machine-absolute path (`/Users/hassanahmed/ai-tutor/node_modules/...`) which breaks every other checkout.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function playwrightRoot(from = fileURLToPath(import.meta.url)) {
  return path.resolve(path.dirname(from), "../..");
}

export function loadPlaywright(webRoot = playwrightRoot()) {
  const tried = [];
  for (const pkg of [path.join(webRoot, "package.json"), path.join(webRoot, "..", "..", "package.json")]) {
    tried.push(pkg);
    try {
      return createRequire(pkg)("playwright");
    } catch {
      // Walk to the next root.
    }
  }
  throw new Error(`playwright is not installed (looked next to ${tried.join(" and ")})`);
}
