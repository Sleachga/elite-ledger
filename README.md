# elite-ledger

Public, verifiable ledger of who deposits Elite-craft materials into a Quinfall
guild bank. Architecture and every locked decision live in [CLAUDE.md](CLAUDE.md).

## Local setup

```sh
pnpm install          # Node 22+, pnpm 10
pnpm db:seed          # creates ./.pglite (embedded Postgres), applies migrations, seeds catalog + recipes
pnpm dev              # http://localhost:3000
```

No Postgres server, Docker, or `.env` is needed. Copy `.env.example` to `.env`
only to point at a real Postgres (`DATABASE_URL`) or set the guild name
(`NEXT_PUBLIC_GUILD_NAME`).

## Scripts

| Script              | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `pnpm dev`          | Next.js dev server (Turbopack)                                      |
| `pnpm build` / `start` | Production build (Turbopack) / serve                             |
| `pnpm dev:webpack` / `build:webpack` | Same, with webpack — needed on FAT32 checkouts (see below) |
| `pnpm lint`         | ESLint (`eslint-config-next`)                                       |
| `pnpm typecheck`    | `tsc --noEmit`                                                      |
| `pnpm test`         | Vitest (progress module + an in-memory PGlite migrate/seed test)    |
| `pnpm db:generate`  | `drizzle-kit generate`: write a new SQL migration from `src/db/schema.ts` into `drizzle/` |
| `pnpm db:migrate`   | Apply committed migrations to the configured database               |
| `pnpm db:seed`      | Migrate, then upsert the catalog and recipes (idempotent)           |

## Database: PGlite vs `DATABASE_URL`

`src/db/index.ts` is the only place a driver is chosen:

- `DATABASE_URL` **unset** (default): [PGlite](https://pglite.dev) — Postgres
  compiled to WASM, persisted in `./.pglite/` (gitignored). Run `pnpm db:seed`
  before `pnpm dev`; do not run both against the same directory at once.
- `DATABASE_URL` **set**: [postgres-js](https://github.com/porsager/postgres)
  against that server (Supabase in production). Migrations are the same files.
- Tests use `createDb({ memory: true })`, an in-memory PGlite.
- Windows note: on FAT32 volumes PGlite's NodeFS fails to start because the
  volume rejects pre-1980 file times (`utimes` -> EINVAL). `src/db/index.ts`
  wraps NodeFS to drop that timestamp write; everything else is stock PGlite.

## FAT32 checkouts (Windows)

If the repo lives on a FAT32 volume (no symlink/junction support), Turbopack
cannot start: it materialises `serverExternalPackages` as junction points under
`.next/node_modules`. Use the webpack variants instead — `pnpm dev:webpack` and
`pnpm build:webpack`. They run Next through `scripts/next-fat32.cjs`, which
preloads `scripts/fat32-readlink-shim.cjs` (FAT32 answers `readlink()` on a
plain file with `EISDIR`; the shim reports the `EINVAL` that webpack and Next's
build tracing expect), and `next.config.ts` sets `resolve.symlinks = false`.
On NTFS, macOS, Linux and Vercel use the default Turbopack scripts.
Reformatting the drive to NTFS (or cloning to one) removes the need entirely.

Schema changes: edit `src/db/schema.ts`, run `pnpm db:generate`, commit the
new file under `drizzle/`, then `pnpm db:migrate` (or `db:seed`).

## Catalog and icons

`src/catalog/catalog.json` lists the tracked items (name, rarity, aliases,
icon file) and `src/catalog/recipes.json` the four Elite recipes from
CLAUDE.md decision 7. Both are seeded into `items` / `recipes` / `recipe_items`.

Icons are vendored once in `public/icons/` (one copy: served by Next.js at
`/icons/<file>` and readable from disk for the extraction prompt later).
Rarity-to-color mapping lives in `src/catalog/index.ts`.

**Provenance.** Names, rarities and icons were pulled on 2026-09-20 from the
[Quinfall Codex items page](https://thequinfall-codex.com/items), which showed
"Game data: patch 1.0.0.32 · updated 2026-05-31". Icon files keep the codex
names (`material_icon1_<id>.png`). Item data and icon art are the property of
Vawraek (The Quinfall); the codex serves them under community fair use.

Naming choices, where CLAUDE.md and the codex differ:

- **Mithrilium** — CLAUDE.md says "Mithrilium Ingot". The codex has
  "Mithrilium" (rare) and a separate, cheaper "Mithril Ingot" (common). The
  codex's Nyxium recipe uses Mithrilium ×25, which matches the 2,500-per-Elite
  figure (100 Nyxium × 25), so the catalog item is **Mithrilium** with
  "Mithrilium Ingot" as an alias.
- **Purified Veltryn** — CLAUDE.md says "Veltryn". The codex has Faded /
  Bright / Purified Veltryn; the Nyxium recipe uses **Purified Veltryn** ×25
  (again 2,500 per Elite). "Veltryn" is kept as an alias.
- **Silver Coin** is currency and is not on the codex. Its icon is a locally
  drawn placeholder (`public/icons/silver_coin_placeholder.png`); swap in a
  real one when we have a bank-log crop.

## Layout

- `src/catalog/` vendored catalog + recipes (pure data)
- `src/db/` Drizzle schema, driver switch, queries, seed
- `src/modules/progress/` pure `computeProgress()` with tests
- `src/components/` Radix Themes UI (`ItemChip`, shell, progress bars)
- `src/app/` Next.js App Router pages (`/` is Progress; other routes are placeholders)
- `drizzle/` generated SQL migrations (committed)
- `scripts/` `tsx` entry points for migrate / seed
