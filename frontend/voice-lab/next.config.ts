import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The lab is a test bench: nothing here is cached at the edge, so every deploy is what you see.
  headers: async () => [{ source: "/(.*)", headers: [{ key: "Cache-Control", value: "no-store" }] }],
};

export default nextConfig;
