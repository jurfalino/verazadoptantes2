import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  webpack: (config, { nextRuntime }) => {
    if (nextRuntime === 'edge') {
      config.resolve.alias = {
        ...config.resolve.alias,
        "async_hooks": path.join(process.cwd(), "src/polyfills/async_hooks.js"),
        "node:async_hooks": path.join(process.cwd(), "src/polyfills/async_hooks.js"),
      };
      config.externals = [...(config.externals || []), 'better-sqlite3'];
      config.resolve.fallback = {
        ...config.resolve.fallback,
        "better-sqlite3": false,
        fs: false,
        path: false,
        net: false,
        tls: false,
        child_process: false,
      };
    }
    return config;
  },
};

export default nextConfig;
