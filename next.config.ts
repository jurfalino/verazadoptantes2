import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { nextRuntime }) => {
    if (nextRuntime === 'edge') {
      config.externals = [...(config.externals || []), 'better-sqlite3'];
      config.resolve.fallback = {
        ...config.resolve.fallback,
        "better-sqlite3": false,
        fs: false,
        path: false,
      };
    }
    return config;
  },
};

export default nextConfig;
