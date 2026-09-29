import path from "node:path";
import type { NextConfig } from "next";

/**
 * The React-sandbox column is the PRODUCTION pipeline, not a copy: boards come from the main app's
 * dev-only /api/sandbox-board and render through its own ReactAnimationSandbox component (imported
 * read-only via the `@/*` path in tsconfig). That component fetches its React runtime, board font
 * and asset artwork from its own origin, so those three paths are proxied to the running main app.
 */
const MAIN_APP_URL = process.env.MAIN_APP_URL ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  // The dev badge sits on top of the bottom-left board in every screenshot.
  devIndicators: false,
  // Widened to the repo root so Turbopack may resolve ../frontend/web (the production renderer)
  // and the hoisted next/react in ../node_modules — one React for every engine on the page.
  turbopack: { root: path.resolve(process.cwd(), "..") },
  async rewrites() {
    return [
      { source: "/sandbox/:path*", destination: `${MAIN_APP_URL}/sandbox/:path*` },
      { source: "/fonts/:path*", destination: `${MAIN_APP_URL}/fonts/:path*` },
      { source: "/api/animation-assets", destination: `${MAIN_APP_URL}/api/animation-assets` },
      { source: "/api/board-illustrations/:id", destination: `${MAIN_APP_URL}/api/board-illustrations/:id` },
    ];
  },
};

export default nextConfig;
