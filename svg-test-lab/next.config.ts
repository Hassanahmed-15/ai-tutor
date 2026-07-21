import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Isolated test lab lives inside the ai-tutor monorepo, which has its own root
  // lockfile — pin the workspace root here so Turbopack never infers the parent.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
