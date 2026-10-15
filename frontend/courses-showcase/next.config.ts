import type { NextConfig } from "next";

// A static site: HTML + JS + the course JSON in public/data. No server, no API routes, no keys.
const nextConfig: NextConfig = {
  output: "export",
  env: { NEXT_PUBLIC_COURSES_SHOWCASE: "1" },
};

export default nextConfig;
