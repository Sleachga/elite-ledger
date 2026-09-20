import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/WASM database drivers must not be bundled (bundling PGlite breaks
  // its wasm loading); they are required from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],

  // Turbopack (the default) needs no options. Declaring the key keeps Next
  // from refusing to start because a `webpack` hook is also present.
  turbopack: {},

  // Only used with `next dev --webpack` / `next build --webpack`, the FAT32
  // fallback described in the README. node_modules is hoisted, so skipping
  // symlink probing during module resolution loses nothing.
  webpack(config) {
    config.resolve = { ...config.resolve, symlinks: false };
    return config;
  },
};

export default nextConfig;
