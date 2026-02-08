import type { NextConfig } from "next";
import path from "path";

// Enable local Cloudflare D1 development
// Guard against repeated calls during HMR config re-evaluation
if (process.env.NODE_ENV === 'development') {
  const g = globalThis as any;
  if (!g.__cfDevPlatformSetup) {
    g.__cfDevPlatformSetup = true;
    import('@cloudflare/next-on-pages/next-dev').then(({ setupDevPlatform }) => {
      setupDevPlatform();
    });
  }
}

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  serverExternalPackages: ["better-sqlite3"],
  // Mitigate Next.js 15.1 dev server memory leak (known regression)
  experimental: {
    webpackMemoryOptimizations: true,
  },
  webpack: (config, { nextRuntime }) => {
    // Prevent HMR loop: D1 queries write to .wrangler/ SQLite files,
    // which triggers webpack rebuild if not ignored
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/.wrangler/**', '**/node_modules/**'],
    };
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

