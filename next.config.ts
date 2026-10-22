import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // The dev server pipes its log to ./dev.log and content lands in ./media — both live inside the
  // watched project root. Without these ignores Turbopack invalidates and recompiles on every
  // request (log writes) and watches tens of thousands of content files, which can exhaust memory.
  turbopack: {
    watchOptions: {
      ignored: [
        "dev.log",
        "server.log",
        "realtime.log",
        "**/*.log",
        "worklog.md",
        ".zscripts/**",
        "tool-results/**",
        "download/**",
        "upload/**",
        "media/**",
        "db/**",
        "repos/**",
      ],
    },
  },
};

export default nextConfig;
