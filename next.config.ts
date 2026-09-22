import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/WASM database drivers must not be bundled (bundling PGlite breaks
  // its wasm loading); they are required from node_modules at runtime.
  // `sharp` (the Extractor's upscaler) is on Next's built-in external list, so
  // it needs no entry here; its native binary is traced into /api/try-extract.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],

  // extract() reads the reference icons from disk at request time
  // (`<cwd>/public/icons/ref`, drawn by `pnpm icons:ref`), which build-time
  // tracing cannot see. Ship them with the one serverless function that calls
  // it. Globs are relative to the project root, which is also the function's
  // cwd on Vercel. `public/icons/**` already covers `ref/`; it is listed on
  // its own so nobody trims the parent glob and takes the prompt's icons away.
  outputFileTracingIncludes: {
    "/api/try-extract": [
      "./public/icons/**/*",
      "./public/icons/ref/**/*",
      "./src/catalog/**/*.json",
    ],
  },

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
