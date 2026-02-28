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
  serverExternalPackages: ["better-sqlite3"],
  // Mitigate Next.js 15.1 dev server memory leak (known regression)
  experimental: {
    webpackMemoryOptimizations: true,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // unsafe-inline for theme script, unsafe-eval for Next.js dev
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https://lh3.googleusercontent.com https://*.googleusercontent.com https://*.fbsbx.com https://*.fbcdn.net",
              "connect-src 'self' https://accounts.google.com https://api.axiom.co https://generativelanguage.googleapis.com https://*.cloudflarestorage.com https://lh3.googleusercontent.com",
              "frame-src 'self' https://accounts.google.com",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      { source: '/guide', destination: '/guia' },
    ];
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

