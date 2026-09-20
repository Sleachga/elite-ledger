/**
 * `node scripts/next-fat32.cjs <next args>` runs the Next.js CLI with the
 * FAT32 readlink shim active in this process and in every worker Next forks
 * (they inherit NODE_OPTIONS). Used by `pnpm dev:webpack` / `pnpm build:webpack`.
 */
const path = require("node:path");

const shim = path.join(__dirname, "fat32-readlink-shim.cjs");
require(shim);

const flag = `--require "${shim.replace(/\\/g, "/")}"`;
process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, flag].filter(Boolean).join(" ");

require("next/dist/bin/next");
