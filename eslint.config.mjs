import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Node preload scripts must be CommonJS (`node --require`).
    files: ["scripts/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // The Extractor is the only module allowed to talk to the Claude API.
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,tsx}"],
    ignores: ["src/modules/extractor/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@anthropic-ai/sdk",
              message: "Only src/modules/extractor may import the Anthropic SDK. Call extract() instead.",
            },
          ],
          patterns: [
            {
              group: ["@anthropic-ai/sdk/*"],
              message: "Only src/modules/extractor may import the Anthropic SDK. Call extract() instead.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "drizzle/**",
    ".pglite/**",
    ".scratch/**",
  ]),
]);
