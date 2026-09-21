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
| `pnpm test`         | Vitest (progress, extractor with a fake client, playground route with the extractor mocked, in-memory PGlite migrate/seed) |
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
// { looksLikeBankLog, rows, characters, warnings, model, usage, upscale }
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

**Upscaling.** A log icon is about 48px and the part that tells the four
blueprint fragments apart about 30px, so small screenshots are enlarged before
they are sent (`sharp`, Lanczos, re-encoded as PNG): `scale = min(2, 1568 /
longEdge)`, applied only when that is at least 1.15, never downscaling. If the
enlarged PNG would pass 4.5 MB it tries half the enlargement, then sends the
upload as it is; the same happens if the image cannot be read or `sharp` cannot
load, so upscaling never fails an extraction. `result.upscale` says what was
sent (`{ applied, scale, width, height, reason? }`). 1568px is the long edge
every model takes unresized; `claude-opus-5` accepts 2576px, which
`EXTRACTOR_UPSCALE_MAX_EDGE=2576` allows (not measured yet, see
`docs/extractor-eval.md`).

**Two more fields per row**, both optional in the type because answers recorded
before they existed still parse:

- `quantityText`: the amount exactly as displayed, separators included
  (`"500,000,000"`, `"1000"`, `""` when the row shows no number). `quantity`
  stays the digit string to store.
- `box`: `{ top, bottom }`, the row's vertical extent as fractions 0-1 of the
  image height. They are fractions, so they fit the uploaded image whatever
  size was sent to the model. A box that makes no sense (not numbers, outside
  the image, `top >= bottom`) is dropped; when every row has one, rows are
  sorted top to bottom.

**Amounts are read twice.** The model copies the printed amount
(`quantityText`) and also writes it as digits (`quantity`). A printed amount
with separators must be in groups of three (`^\d{1,3}([,.\s]\d{3})*$`, with
apostrophe and underscore accepted as separators too), which is where a dropped
or doubled digit shows. If the grouping is broken the row's
confidence is capped at 0.5 and the reason says the amount looked malformed; if
both readings are well-formed but differ, the printed digits are kept and the
row is flagged the same way.

**Always double-checked.** Blueprint-fragment rows and Silver Coin rows never
come back with a confidence above 0.8, whatever the model said, and their
`lowConfidenceReason` ends with "Blueprint fragments are always
double-checked." or "Money amounts are always double-checked.". A wrong fragment
or a wrong magnitude is too costly to wave through, so the verify screen always
asks a human about these rows. The prompt also carries one line per fragment on
what its jewelry looks like (the paper badge they share is to be ignored) and
asks for the icon description before the item id.

Settings (`.env`): `ANTHROPIC_API_KEY`; `EXTRACTOR_MODEL` (default
`claude-opus-5`); `EXTRACTOR_EFFORT` (`low`...`max`, unset = API default);
`EXTRACTOR_UPSCALE` (`on`/`off`, default on); `EXTRACTOR_UPSCALE_MAX_EDGE`
(px, default 1568);
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
pnpm eval:extractor --json --upscale off   # same run without the enlargement, to compare
```

It runs each fixture through `extract()`, matches rows order-insensitively on
(item id, quantity, game timestamp, character) and prints matched / expected /
extra per fixture plus totals: row accuracy (`matched / (matched + missing +
extra)`), item-id accuracy, quantity accuracy, and the two categories where a
mistake costs the most: **fragment item-id** accuracy (over blueprint-fragment
rows) and **silver quantity** accuracy (over Silver Coin rows). "row boxes" is
the share of expected boxes that contain the centre of the reported one. Live
runs end with the token totals. It exits non-zero below `--min-accuracy`
(default 0). `--json` writes a report to `fixtures/extractor/.results/`
(gitignored). `--fixtures <dir>` points it at another folder; trailing names
select fixtures. `--upscale on|off` and `--max-edge <px>` override
`EXTRACTOR_UPSCALE` / `EXTRACTOR_UPSCALE_MAX_EDGE`. `EXTRACTOR_MODEL` makes it
the eval for trying a cheaper model. Measured results are logged in
`docs/extractor-eval.md`.

Fixtures live in `fixtures/extractor/<name>/`:

- `screenshot.png` (or `.jpg` / `.webp`)
- `expected.json`: `{ "looksLikeBankLog": true, "rows": [{ "itemId", "quantity", "gameTimestamp", "character", "box"? }] }`, deposit rows only; `box` is optional and not part of row matching
- `mock-response.json` (optional): a canned model answer, withdrawals and
  display formatting included, so `--mock` still exercises the module's rules

The six `synthetic-*` fixtures are drawn by `pnpm fixtures:extractor`
(`scripts/make-synthetic-fixtures.ts`; pass fixture names to redraw only those)
from the real icons and approximate the game's layout from a description.
`synthetic-fragments-heavy` (all four fragments, three rows each, next to gold
and ruby) and `synthetic-money-heavy` (silver from 5,000,000 to 10,000,000,000
in small gold text) draw icons at the in-game 48px. The three older log
fixtures keep mock answers without `quantityText` / `box`, so `--mock` also
covers answers from before those fields. To add a real screenshot, drop it in a
new folder with a hand-checked `expected.json`.

## Playground (`/try`)

`/try` is a throwaway page for testing the Extractor on real screenshots before
login and the ledger exist: drop, paste (Win+Shift+S, then Ctrl+V) or pick PNG /
JPEG / WebP files up to 10 MB each and it shows the parsed deposit rows with
confidence, per-item totals, warnings, characters, and the model, duration and
token usage. **Nothing is saved.**

It takes **several screenshots at once**, up to **20 per batch** (extra files
are ignored with a message, exact duplicates are skipped, and more can be added
while others are still being read). Each image is its own request; a
client-side queue runs **two at a time** (`QUEUE_CONCURRENCY`), so every body
stays under the host's upload cap and every call under `maxDuration`. A bad
file becomes a failed line in the list and never blocks the rest; failed reads
can be retried one by one or all together, and "Clear all" aborts whatever is
in flight. A summary strip on top adds up the finished images: rows, rows to
check, warnings, read time, combined per-item totals and rows per
character. The queue is a pure reducer in `src/modules/playground/queue.ts`;
the batch numbers live in `summary.ts` beside it.

**The rows are a verify step** (the seed of decision 6's verify screen). Every
row has a round check: rows the extractor is weak on start unchecked in amber
and must be tapped one by one — confidence under 85%, an unknown item, any of
the four blueprint fragments, Silver Coin, or a displayed amount
(`quantityText`) that is mis-grouped or disagrees with the quantity; the rest
start auto-accepted, and "Accept all" only ever confirms those. Click the item
for a picker with large icon tiles (fragments first) and, when the extractor
sent the row's position (`box`), an enlarged strip of that row cut from the
screenshot to compare against; click the quantity to type a correction
(`500,000,000`, `500m`, `1.5b`) with a "1.5 billion" sanity line. Rows can be
removed (Undo / "Removed (n)") and added. Hovering a row bands it on the
screenshot; clicking the screenshot finds the row. Totals, counts and the
summary always read the corrected rows. Nothing is saved, so **Copy rows**
puts the batch on the clipboard as TSV and **Download fixture** writes one
image's corrected rows as a `fixtures/extractor/*/expected.json`. The model
is `review.ts` (reducer + needs-a-look rule), `quantity.ts` (parser, compact
reading), `export.ts`, `geometry.ts` and `batch.ts` (queue + review behind one
reducer); `box` and `quantityText` are optional and read through tolerant
accessors. Until the real upload flow lands, the Upload
button and the mobile Upload tab point here (`UPLOAD_HREF` in
`src/components/shell/nav.ts`; set it back to `"/upload"` to revert).

The page posts to `POST /api/try-extract` (multipart field `image`), which
calls `extract()` and returns `{ result, durationMs }` or
`{ error: { kind, message } }`. Every call spends API credits, so:

- **Passcode.** With `TRY_PASSCODE` set, the request must carry it in the
  `x-try-passcode` header (the page asks once and keeps it in
  `sessionStorage`; a 401 pauses the queue, asks again, and resumes the
  remaining images). In production it is always gated: on Vercel (`VERCEL`
  set) with no `TRY_PASSCODE` the route answers 503 "playground disabled".
  Locally with no passcode it is open. Set `TRY_PASSCODE` and
  `ANTHROPIC_API_KEY` in the Vercel project's environment variables.
- **Rate limit.** 60 requests per 10 minutes per IP (room for a few 20-image
  batches plus retries), in memory, best effort. A 429 carries `Retry-After`,
  and the page shows the wait on the failed image.
- `GET /api/try-extract` returns `{ passcodeRequired, enabled }`.

Run it locally with the secrets from 1Password:

```sh
op run --env-file=.env.tpl -- pnpm dev      # then open http://localhost:3000/try
```

On Vercel the reference icons reach the function through
`outputFileTracingIncludes` in `next.config.ts` (`extract()` reads
`<cwd>/public/icons` from disk). Vercel also caps request bodies at about
4.5 MB, below the route's own 10 MB limit; the page warns on any image over
4.5 MB. Crop very large screenshots.

## Layout

- `src/catalog/` vendored catalog + recipes (pure data)
- `src/db/` Drizzle schema, driver switch, queries, seed
- `src/modules/progress/` pure `computeProgress()` with tests
- `src/modules/extractor/` `extract()`: screenshot to deposit rows via the Claude API, plus the eval
- `src/modules/playground/` pure logic for `/try` (upload queue, human-review reducer, quantity parser, TSV / fixture export, totals)
- `fixtures/extractor/` eval fixtures (screenshot + expected rows)
- `src/components/` Radix Themes UI (`ItemChip`, shell, progress bars)
- `src/app/` Next.js App Router pages (`/` is Progress, `/try` the playground, `api/try-extract` its route; other routes are placeholders)
- `drizzle/` generated SQL migrations (committed)
- `scripts/` `tsx` entry points for migrate / seed / extractor eval / fixture drawing

## Secrets

Secrets live in 1Password, never in the repo or in chat. `.env.tpl` holds
`op://` references only.

```sh
op run --env-file=.env.tpl -- pnpm eval:extractor   # run with secrets injected
op inject -i .env.tpl -o .env                        # or write a local .env (gitignored)
```
