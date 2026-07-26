import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @resvg/resvg-js ships a native .node binary; it must be treated as an external server package
  // so Next/Turbopack doesn't try to bundle the native addon into the route handler (which makes
  // the runtime import fail). Used by the vision board critic (lib/boardVisionCritic.ts) and the
  // PDF export route.
  serverExternalPackages: ["@resvg/resvg-js"],
};

export default nextConfig;
