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
| `pnpm test`         | Vitest (progress, extractor with a fake client, playground and admin routes with the extractor mocked, settings + migrate/seed on in-memory PGlite) |
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
`/icons/<file>` for ItemChip and readable from disk for the extraction
prompt). `src/catalog/index.ts` holds both colour mappings: rarity → Radix
colour for the site's chrome (`RARITY_COLOR`), and rarity → **in-game border
colour** (`RARITY_BORDER` / `rarityBorderHex`, with the evidence behind each
rung) for the extractor. The in-game palette is what the owner's screenshots
show (common green, legendary purple, mythic red, Silver Coin borderless; the
owner calls Purified Veltryn's rare border purple); the codex's own palette
disagrees and only lends hex values. Uncommon (blue) and epic (orange) are
not yet seen in-game.

**Decoys.** `catalog.json` also lists *decoys*: codex items that are not
tracked but share their art with a tracked item and carry a different rarity,
so only the border (and a detail of the art) tells them apart: Faded and
Bright Veltryn beside Purified Veltryn, Mithril and Adamantite Ingot beside
Mithrilium, Obsidian Alloy beside the gold and copper ingots. Their bare icons
live in `public/icons/` too. The extractor shows them to the model as "NOT
tracked" references (see below); nothing else uses them.

**Reference icons.** `pnpm icons:ref` (`scripts/make-reference-icons.ts`)
draws `public/icons/ref/<id>.png` for every tracked item and decoy: the art on
a dark slot with a 3px border in its in-game rarity colour, at 96px (twice the
~48px log slot; Silver Coin without a border, as in the log). They are
committed and traced into the extraction route. Re-run it after changing an
icon, a rarity, the palette or the decoy list; `reference-icons.test.ts`
fails when they are stale.

**Provenance.** Names, rarities and icons were pulled on 2026-09-20 from the
[Quinfall Codex items page](https://thequinfall-codex.com/items), which showed
"Game data: patch 1.0.0.32 · updated 2026-05-31"; the decoys the same way on
2026-09-22. Icon files keep the codex names (`material_icon1_<id>.png`). Item
data and icon art are the property of Vawraek (The Quinfall); the codex serves
them under community fair use.

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

One request per screenshot to `claude-opus-5`: the system prompt, then the
bordered reference icons from `public/icons/ref/` (every tracked item with an
"id / name / rarity (colour border)" label, then every decoy labelled "NOT
tracked — same art, different border: <name> (<rarity>, <colour> border)"),
prompt-cached so repeat uploads only pay for the screenshot, then the
screenshot. Structured outputs pin the item id to the catalog ids plus
`unknown` (never a decoy id). The model reports every row it sees; the module then applies the
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

**Identity is art and border.** The game draws one piece of artwork on several
items that differ only in rarity (Bright Veltryn is the blue-bordered bottle,
Purified Veltryn the purple-bordered one), and the log shows that border
around the icon. So the prompt says an item's identity is its artwork *and*
its border colour, gives the colour legend (`green = common, blue = uncommon,
purple = rare or legendary, orange = epic, red = mythic`, generated from
`RARITY_BORDER`), shows the decoys as "NOT tracked" references, and asks for
two more fields per row before `itemId`: `borderColorWord` (the colour as the
model saw it, `""` for none) and `borderColor` (the rarity that colour stands
for, or `none` / `unclear`). `normalize.ts` then applies the rule: a reported
rarity whose border colour differs from the chosen item's turns the row into
`unknown` at confidence ≤ 0.5 with the reason "Border color X does not match
<item> (<rarity>, <colour> border)"; `none` / `unclear` keeps the pick but caps
it at 0.7. Silver Coin has no border in the log and is left out, and rarities
that share a colour (rare and legendary are both purple until a real
screenshot shows two shades) never contradict each other. Both fields are
carried on `ParsedRow` (optional: older answers parse without them) so the
verify screen can show them.

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
pnpm eval:extractor --json --real-only     # only the real-* fixtures (real screenshots)
```

It runs each fixture through `extract()`, matches rows order-insensitively on
(item id, quantity, game timestamp, character) and prints matched / expected /
extra per fixture plus totals: row accuracy (`matched / (matched + missing +
extra)`), item-id accuracy, quantity accuracy, and the three categories where
a mistake costs the most: **fragment item-id** accuracy (over blueprint-fragment
rows), **silver quantity** accuracy (over Silver Coin rows) and **decoy
rejection** (rows drawn from an untracked lookalike that came back `unknown`,
over all such rows). "row boxes" is the share of expected boxes that contain
the centre of the reported one. Live runs end with the token totals. It exits
non-zero below `--min-accuracy` (default 0). `--json` writes a report to
`fixtures/extractor/.results/` (gitignored). `--fixtures <dir>` points it at
another folder; trailing names select fixtures; `--real-only` keeps only the
`real-*` ones. `--upscale on|off` and `--max-edge <px>` override
`EXTRACTOR_UPSCALE` / `EXTRACTOR_UPSCALE_MAX_EDGE`. `EXTRACTOR_MODEL` makes it
the eval for trying a cheaper model. Measured results are logged in
`docs/extractor-eval.md`.

Fixtures live in `fixtures/extractor/<name>/`:

- `screenshot.png` (or `.jpg` / `.webp`)
- `expected.json`: `{ "looksLikeBankLog": true, "rows": [{ "itemId", "quantity", "gameTimestamp", "character", "box"?, "decoy"? }] }`, deposit rows only; `box` is optional and not part of row matching; `decoy` names the untracked lookalike a row was drawn from, whose `itemId` is then `"unknown"`
- `mock-response.json` (optional): a canned model answer, withdrawals and
  display formatting included, so `--mock` still exercises the module's rules;
  a fixture without one is skipped by `--mock`, not failed

The seven `synthetic-*` fixtures are drawn by `pnpm fixtures:extractor`
(`scripts/make-synthetic-fixtures.ts`; pass fixture names to redraw only those)
from the real icons, with the in-game border palette, and approximate the
game's layout from a description. `synthetic-fragments-heavy` (all four
fragments, three rows each, next to gold and ruby), `synthetic-money-heavy`
(silver from 5,000,000 to 10,000,000,000 in small gold text) and
`synthetic-rarity-decoys` (tracked items with their real borders next to
Bright and Faded Veltryn and Adamantite Ingot, all expected `unknown`) draw
icons at the in-game 48px. The three older log fixtures keep mock answers
without `quantityText` / `box` / `borderColor`, so `--mock` also covers answers
from before those fields.

**Real screenshots** go in `fixtures/extractor/real-<name>/` (say
`real-sandy-2026-09-22/`). On `/upload`, "Download fixture" saves the reviewed
rows as `<image name>.expected.json`; rename it to `expected.json`, put it in
the folder next to the screenshot itself, named `screenshot.png` (or `.jpg` /
`.webp`), check the rows by hand
(item ids, quantities as plain digits, timestamps and names exactly as shown;
mark a lookalike row `"itemId": "unknown"` with `"decoy": "<id>"`), and commit
both. Every `real-*` folder is picked up automatically; `--real-only` runs just
those, and `--mock` skips them. These are the numbers that matter: the
synthetic fixtures are drawn from the same icons the prompt uses and are
easier than the game.

## Upload page (`/upload`)

`/upload` started as a throwaway page for testing the Extractor on real screenshots before
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

- **Passcode (optional).** With `TRY_PASSCODE` set, the request must carry it
  in the `x-try-passcode` header (the page asks once and keeps it in
  `sessionStorage`; a 401 pauses the queue, asks again, and resumes the
  remaining images). Unset, the page is open to anyone — the owner accepts
  the cost; the rate limit and the admin AI switch still apply. Production
  currently runs without a passcode.
- **Rate limit.** 60 requests per 10 minutes per IP (room for a few 20-image
  batches plus retries), in memory, best effort. A 429 carries `Retry-After`,
  and the page shows the wait on the failed image.
- `GET /api/try-extract` returns `{ passcodeRequired, enabled, aiEnabled, defaultMode }`
  (the last two are the admin settings below).

Run it locally with the secrets from 1Password:

```sh
op run --env-file=.env.tpl -- pnpm dev      # then open http://localhost:3000/upload
```

On Vercel the reference icons reach the function through
`outputFileTracingIncludes` in `next.config.ts` (`extract()` reads
`<cwd>/public/icons` from disk). Vercel also caps request bodies at about
4.5 MB, below the route's own 10 MB limit; the page warns on any image over
4.5 MB. Crop very large screenshots.

## Upload modes & admin settings

`/upload` offers two ways to get rows in, picked with a segmented control on top
of the page (issue #22):

- **AI-assisted** — the flow described above: each screenshot goes to the
  Extractor and the member checks and corrects the rows.
- **Manual** — screenshots are added the same way (drop / pick / paste, same
  batch rules) but **nothing is sent to the server**: each image becomes an
  entry that is ready at once with no rows, and the member adds them with the
  same item picker and quantity editor (`500m`, `1.5b`). "Add rows without a
  screenshot" makes one entry named "Manual entry". The add-row form stays
  open: picking the item moves the focus to the quantity, Enter saves, and a
  fresh form takes the focus with the same game time and character. Rows typed
  by hand start checked. Totals, per-character counts, Copy rows and Download
  fixture read them like any corrected row. No passcode is asked for.

The member's choice is remembered per browser (`localStorage`); switching mode
mid-batch only affects images added afterwards. A read that failed (or was
canceled) can be handed over with "Add rows by hand". The model is in
`src/modules/playground/`: `mode.ts` (which modes are on offer, which one is
active) and a `manual` entry kind in `queue.ts` (`enqueue` with `mode`,
`addBlank`, `toManual`; `pickStartable` never returns a manual entry).

Which modes exist, and the default, are **admin settings** in the database:

| Setting               | Default | Effect |
| --------------------- | ------- | ------ |
| `aiExtractionEnabled` | `true`  | Off: the control is hidden with a one-line note, `POST /api/try-extract` answers **403 `ai_disabled`** before the rate limiter or the Extractor is touched, and the page never calls it. No API credits can be spent. |
| `defaultUploadMode`   | `"ai"`  | The mode a member starts in until they pick one (`"manual"` or `"ai"`). |

They live in the `settings` table (`key` → `jsonb` value, `updated_at`,
`updated_by`; migration `drizzle/0001_common_northstar.sql`) behind
`src/modules/settings/`: `getSettings()` fills in defaults for missing or
malformed rows and never throws (a bad value, or an unreachable database, is
logged once and reads as the default, so AI stays on); `updateSettings(patch,
{ updatedBy })` upserts known keys only. Reads are cached in-process for 15 s
and a save drops the cache, so the upload screen follows a change within
seconds, without a redeploy (each serverless instance has its own cache, hence
"within 15 s" rather than "at once"). If a read is already in flight when AI is
switched off, the 403 flips the page to Manual and the waiting images become
manual entries.

**Admin → Settings** (`/admin/settings`, listed on `/admin`; linked from the
right of the desktop top bar and from the mobile More page) edits both, asks
for "Your name" (stored in `updated_by`) and shows who changed them last.
Until Discord login (#4) exists the admin area has its own passcode:

- `GET` / `PUT /api/admin/settings` need the `x-admin-passcode` header to match
  **`ADMIN_PASSCODE`** (constant-time compare; separate from `TRY_PASSCODE`) →
  401 otherwise. On Vercel with no `ADMIN_PASSCODE` they answer 503 "admin
  disabled"; locally with none set they are open. The page keeps the passcode in
  `sessionStorage`.
- 30 requests per 10 minutes per IP, counted before the passcode check.
- `PUT` takes `{ patch: { aiExtractionEnabled?, defaultUploadMode? }, updatedBy }`
  and rejects unknown keys and wrong types with 400.

Run `pnpm db:migrate` (or `db:seed`) once so the table exists; set
`ADMIN_PASSCODE` in the Vercel project's environment variables. Once #4 lands
this moves behind the admin allowlist and every change goes through Audit (#11).

## Layout

- `src/catalog/` vendored catalog + recipes (pure data)
- `src/db/` Drizzle schema, driver switch, queries, seed
- `src/modules/settings/` admin settings: typed get/update over the `settings` table, defaults, 15 s cache
- `src/modules/progress/` pure `computeProgress()` with tests
- `src/modules/extractor/` `extract()`: screenshot to deposit rows via the Claude API, plus the eval
- `src/modules/playground/` pure logic for `/upload` (upload queue, human-review reducer, quantity parser, TSV / fixture export, totals)
- `fixtures/extractor/` eval fixtures (screenshot + expected rows)
- `src/components/` Radix Themes UI (`ItemChip`, shell, progress bars)
- `src/app/` Next.js App Router pages (`/` is Progress, `/try` the playground, `api/try-extract` its route, `/admin` + `api/admin/settings` the admin settings; other routes are placeholders)
- `drizzle/` generated SQL migrations (committed)
- `scripts/` `tsx` entry points for migrate / seed / extractor eval / fixture drawing

## Secrets

Secrets live in 1Password, never in the repo or in chat. `.env.tpl` holds
`op://` references only.

```sh
op run --env-file=.env.tpl -- pnpm eval:extractor   # run with secrets injected
op inject -i .env.tpl -o .env                        # or write a local .env (gitignored)
```
