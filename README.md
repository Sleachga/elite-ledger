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
only to point at a real Postgres (`DATABASE_URL`), set the guild name
(`NEXT_PUBLIC_GUILD_NAME`), or call the Claude API from the Extractor
(`ANTHROPIC_API_KEY`).

## Scripts

| Script              | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `pnpm dev`          | Next.js dev server (Turbopack)                                      |
| `pnpm build` / `start` | Production build (Turbopack) / serve                             |
| `pnpm dev:webpack` / `build:webpack` | Same, with webpack — needed on FAT32 checkouts (see below) |
| `pnpm lint`         | ESLint (`eslint-config-next`)                                       |
| `pnpm typecheck`    | `tsc --noEmit`                                                      |
| `pnpm test`         | Vitest (progress, extractor with a fake client, in-memory PGlite migrate/seed) |
| `pnpm db:generate`  | `drizzle-kit generate`: write a new SQL migration from `src/db/schema.ts` into `drizzle/` |
| `pnpm db:migrate`   | Apply committed migrations to the configured database               |
| `pnpm db:seed`      | Migrate, then upsert the catalog and recipes (idempotent)           |
| `pnpm eval:extractor` | Score the Extractor against `fixtures/extractor/` (`--mock` = no API key) |
| `pnpm fixtures:extractor` | Redraw the synthetic extractor fixtures                       |

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

## Extractor

`src/modules/extractor/` turns a bank-log screenshot into deposit rows. It is
the only code allowed to import `@anthropic-ai/sdk` (ESLint
`no-restricted-imports` enforces it); everything else calls one function:

```ts
import { extract, ExtractorError } from "@/modules/extractor";

const result = await extract({ image, mediaType: "image/png", knownCharacters: ["Leftaltar"] });
// { looksLikeBankLog, rows, characters, warnings, model, usage }
```

One request per screenshot to `claude-opus-5`: the system prompt, then every
tracked item's icon from `public/icons/` with an "id / name / rarity" label
(prompt-cached, so repeat uploads only pay for the screenshot), then the
screenshot. Structured outputs pin the item id to the catalog ids plus
`unknown`. The model reports every row it sees; the module then applies the
rules it owns (CLAUDE.md decision 3): withdrawals and unclear rows are dropped
with a warning, Silver Coin uses the inline amount, quantities stay digit
strings (`"10000000000"` never touches `Number`), no overlay number means 1,
and an image that is not a bank log returns no rows. Each row carries a 0-1
confidence, a reason when it is low, and a short icon description for the
text-only second judge. Every failure is an `ExtractorError` with a `kind`:
`refusal`, `rate_limit`, `api`, `network`, `invalid_output` or `config`.

Settings (`.env`): `ANTHROPIC_API_KEY`; `EXTRACTOR_MODEL` (default
`claude-opus-5`); `EXTRACTOR_EFFORT` (`low`...`max`, unset = API default);
`EXTRACTOR_FALLBACKS` (`on`/`off`). Fallbacks are the API's server-side refusal
fallback (`fallbacks: "default"`, beta): if a safety classifier declines the
request it is re-run on Anthropic's recommended substitute model inside the
same call, and the result carries a warning naming the model that answered. On
by default for `claude-opus-5`, off for any other model.

### Eval

```sh
pnpm eval:extractor --mock                 # canned model output, no key, no network (CI)
pnpm eval:extractor                        # live: one API call per fixture, needs ANTHROPIC_API_KEY
pnpm eval:extractor --json --min-accuracy 0.95 synthetic-all-items
```

It runs each fixture through `extract()`, matches rows order-insensitively on
(item id, quantity, game timestamp, character) and prints matched / expected /
extra per fixture plus totals: row accuracy (`matched / (matched + missing +
extra)`), item-id accuracy, quantity accuracy. It exits non-zero below
`--min-accuracy` (default 0). `--json` writes a report to
`fixtures/extractor/.results/` (gitignored). `--fixtures <dir>` points it at
another folder; trailing names select fixtures. `EXTRACTOR_MODEL` makes it the
eval for trying a cheaper model.

Fixtures live in `fixtures/extractor/<name>/`:

- `screenshot.png` (or `.jpg` / `.webp`)
- `expected.json`: `{ "looksLikeBankLog": true, "rows": [{ "itemId", "quantity", "gameTimestamp", "character" }] }`, deposit rows only
- `mock-response.json` (optional): a canned model answer, withdrawals and
  display formatting included, so `--mock` still exercises the module's rules

The four `synthetic-*` fixtures are drawn by `pnpm fixtures:extractor`
(`scripts/make-synthetic-fixtures.ts`) from the real icons and approximate the
game's layout from a description. To add a real screenshot, drop it in a new
folder with a hand-checked `expected.json`.

## Layout

- `src/catalog/` vendored catalog + recipes (pure data)
- `src/db/` Drizzle schema, driver switch, queries, seed
- `src/modules/progress/` pure `computeProgress()` with tests
- `src/modules/extractor/` `extract()`: screenshot to deposit rows via the Claude API, plus the eval
- `fixtures/extractor/` eval fixtures (screenshot + expected rows)
- `src/components/` Radix Themes UI (`ItemChip`, shell, progress bars)
- `src/app/` Next.js App Router pages (`/` is Progress; other routes are placeholders)
- `drizzle/` generated SQL migrations (committed)
- `scripts/` `tsx` entry points for migrate / seed / extractor eval / fixture drawing
