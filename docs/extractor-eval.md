# Extractor eval log

Live runs of `pnpm eval:extractor --json` (one API request per fixture). The
raw reports are in `fixtures/extractor/.results/` (gitignored). Tracking issue:
#19 (blueprint fragments and Silver Coin amounts).

## 2026-09-22 — rarity is part of identity: bordered references, decoys, border rule

The owner uploaded a real guild bank-log screenshot on the live site: "It got
the veltryn, that's it", and "it got blue veltryn and not the purple rarity —
we only care about the purple rarity". Two failures behind that: the model
matched artwork only (the references were bare codex PNGs with no border, so
a blue-liquid, blue-bordered Bright Veltryn passed for the tracked Purified
Veltryn), and nearly every other row was wrong on a real screenshot while the
synthetic fixtures scored 17/17. The screenshot itself is not a fixture yet
(requested); this round is what could be done without it, on branch
`feat/rarity-matching`, model `claude-opus-5`, effort unset, upscale on
(1568px).

### What changed

- **In-game border palette** in the catalog (`RARITY_BORDER`,
  `rarityBorderHex`), see the table below; the synthetic fixtures are redrawn
  with it (Silver Coin borderless, as in the log).
- **Bordered reference icons** (`public/icons/ref/<id>.png`, `pnpm icons:ref`):
  the art on a dark slot with a 3px rarity border at 96px, replacing the bare
  PNGs in the prompt.
- **Decoys**: five codex items that share art with a tracked item and carry a
  different rarity, sent after the tracked references as "NOT tracked — same
  art, different border: <name> (<rarity>, <colour> border)". Cache breakpoint
  on the last decoy.
- **Prompt**: an item's identity is its artwork *and* its border colour, with
  the colour legend; the same art with another border is `unknown`.
- **Two output fields** per row before `itemId`: `borderColorWord` and
  `borderColor` (common..mythic / none / unclear).
- **Normalize rule**: a reported rarity whose border colour differs from the
  chosen item's turns the row into `unknown` at <= 0.5; none / unclear caps at
  0.7; Silver Coin exempt; rarities sharing a colour never contradict.
- **Eval**: `synthetic-rarity-decoys` fixture, a "decoy rejection" line,
  `real-*` fixtures with `--real-only`, and the extracted rows plus a border
  tally in every report.

### Rarity -> border colour

| Rarity | Border | Hex | Evidence |
| --- | --- | --- | --- |
| common | green | `#5bb661` | in-game: ingots on the owner's screenshots |
| uncommon | blue | `#4c99f8` | assumed (next rung of the usual ladder; on two decoys, no tracked item) |
| rare | purple | `#c277f5` | the owner's word for Purified Veltryn's border |
| epic | orange | `#fcb442` | assumed (usual ladder; on nothing tracked or decoy) |
| legendary | purple | `#c277f5` | in-game: Nyxium on the owner's screenshots |
| mythic | red | `#f93f4e` | in-game: blueprint fragments on the owner's screenshots |
| (currency) | none | — | in-game: Silver Coin rows have no border |

The Quinfall Codex stylesheet (`--r-*` in `0.FHPm1DP_.css`, fetched
2026-09-22) says common `#e6ecf2` (near-white), uncommon `#5bb661`, rare
`#4c99f8`, epic `#c277f5`, legendary `#fcb442`, mythic `#f93f4e`. That is the
fan site's palette, not the game's: it disagrees with the screenshots for
common (near-white vs green) and legendary (orange vs purple), so the in-game
evidence wins and the codex only lends hex values for the hues. A second fan
site (quinfallcrafting.com, `.rarity-0..6`) uses grey, green, blue, purple,
orange, red, gold, which fits green / blue / purple for the first three rungs
and is where the uncommon and epic guesses come from. Rare and legendary are
both "purple" until a real screenshot shows two shades; `sameBorderColor`
makes the normalize rule compare colours, not rarity names, so a purple
Nyxium reported as "rare" is never demoted. If the crafting site's ladder is
the game's, the codex may label Nyxium and the fragments one rung above their
in-game tier; only the real screenshot can settle it.

### Decoys (codex, 2026-09-22)

No codex item shares an icon *file* with a tracked item; "same art" was
judged by eye on the downloaded PNGs.

| Decoy | Rarity | Looks like | Differs |
| --- | --- | --- | --- |
| Faded Veltryn (13351) | common | Purified Veltryn | same corked bottle, black liquid with orange wisps instead of red |
| Bright Veltryn (13352) | uncommon | Purified Veltryn | same bottle, blue liquid instead of red (the "blue veltryn") |
| Mithril Ingot (13141) | common | Mithrilium | same starry bar, silver-teal instead of purple |
| Adamantite Ingot (13140) | common | Mithrilium | purple starry bar, near-identical art |
| Obsidian Alloy (13156) | uncommon | Gold / Copper Ingot | amber-brown bar with black pits |

Checked and left out: Steel-Mithril Alloy (rare, same rarity as Mithrilium, so
no border would separate them), Obsidian Fragment, Silver Ore, Mithril Ore
(common like Obsidian / the ingots, and different art). Ruby and Nyxium have
no codex variant.

### Runs

All fixtures are synthetic. One sample per run except where noted.

| Run | Code | References | Fixtures | Rows matched | Fragment item-id | Silver quantity | Decoys unknown | Item-id (all rows) | Row boxes |
| --- | ---- | ---------- | -------- | ------------ | ---------------- | --------------- | -------------- | ------------------ | --------- |
| a. baseline | 363887e (old prompt, schema, normalize) | bare PNGs, no decoys | `synthetic-rarity-decoys` only | 11 / 12 | 1 / 1 | 1 / 1 | **4 / 4** | 11 / 12 (91.7%) | 12 / 12 |
| b. new | 97fae12 | bordered + 5 decoys, border rule | all 7 | 61 / 63 | **18 / 18** | **10 / 10** | **4 / 4** | 61 / 63 (96.8%) | 34 / 34 |
| c. new, 2nd sample | 94e3f0a (b + per-row report) | bordered + 5 decoys, border rule | all 7 | 61 / 63 | **18 / 18** | **10 / 10** | **4 / 4** | 61 / 63 (96.8%) | 34 / 34 |

Every miss, by run:

- a, b, c: the Iron Ingot row read as Silver Ingot, in `synthetic-rarity-decoys`
  (a, b, c) and `synthetic-money-heavy` (b, c). That is the same miss as every
  run on 2026-09-20: nine of nine now. Both ingots are common, so a border
  cannot separate them and this round was never going to.
- Nothing else, in any run.

Border colours the model reported (run c, the first with the tally). Every
fixture's tally is exactly the rows drawn: `synthetic-all-items` legendary 1,
common 7, rare 2, mythic 4, none 1; `synthetic-rarity-decoys` rare 2,
uncommon 2, legendary 1, common 5, mythic 1, none 1; `synthetic-money-heavy`
none 6, common 2. So green is read as common, blue as uncommon, purple as
rare or legendary (the art picks which), red as mythic, and the Silver Coin
slot as no border: 63 of 63 rows, the legend as intended. The border rule
demoted no row in b or c. The decoy rows' own descriptions show the border
doing its job: Adamantite Ingot came back `unknown` as "a rectangular bar
with a purple starry speckled texture, in a slot with a green border", the
same art as Mithrilium ("...purple border") told apart by the border alone;
Bright Veltryn as "a corked glass bottle holding glowing blue liquid, in a
slot with a blue border", `unknown`, confidence 0.92.

Token usage and cost (at $5 / $25 per MTok in / out, cache write 1.25x, cache
read 0.1x):

| Run | Requests | Input | Output | Cache write | Cache read | About |
| --- | -------- | ----- | ------ | ----------- | ---------- | ----- |
| a | 1 | 2,902 | 2,858 | 4,889 | 0 | $0.12 |
| b | 7 | 16,210 | 14,562 | 5,182 | 31,092 | $0.49 |
| c | 7 | 16,210 | 14,751 | 0 | 36,274 | $0.47 |

The cached prefix grew from 4,889 to 5,182 tokens with the longer system
prompt and five more references: a 96px icon is 16 image tokens, so the
decoys cost about 80 tokens plus their labels. The first request of a run
writes the cache and every later one reads it (cache read 5,182 on requests
2-7 of run b; run c, started within the cache's lifetime, read it on all
seven). Output tokens are unchanged by the two new fields (14,562 and 14,751
over seven fixtures, against 11,025 over six on 2026-09-20).

### What the numbers do and do not say

- **The synthetic decoy fixture does not reproduce the real failure.** At
  baseline, with bare references and no decoys, the model already answered
  `unknown` for all four decoy rows ("potion bottles that are not among the
  tracked reference items"): at 48px the drawn liquids (blue, orange-black,
  red) differ visibly. On the owner's screenshot they did not, whether from
  compression, in-game rendering or the model looking at the bottle shape
  only. The bordered references and the rule are built for that case, and
  only a real fixture can score them.
- **Nothing got worse, twice.** Runs b and c are both 61/63 over all seven
  fixtures with the same single kind of miss as before; fragments 18/18 and
  silver 10/10 in both (the 2026-09-20 run c was 17/17 and 9/9 over six
  fixtures). No tracked row was demoted by the border rule in either run.
- **The model reads borders the way the legend says**, 63 of 63 rows in
  run c, including purple as rare *or* legendary settled by the art. That is
  what decides whether the rule can misfire on a real screenshot: with the
  synthetic palette it does not. Whether the game's actual purples, greens
  and blues read the same way is the open question below.
- **The border already separates same-art items** on the synthetic fixture
  (Adamantite vs Mithrilium, both purple starry bars). That is the mechanism
  the owner's Veltryn failure needs; only a real fixture shows whether it
  holds on the game's rendering.
- **Cheap.** The whole change is under 300 cached tokens per request and no
  extra output tokens.

### Open after this round

- **A real fixture.** `fixtures/extractor/real-<name>/` with the owner's
  screenshot and a hand-checked `expected.json` (README, "Extractor > Eval");
  `pnpm eval:extractor --json --real-only`. Expected `unknown` rows for the
  Bright / Faded Veltryn deposits, tagged `"decoy"`. This is the first run
  that will say anything about the real failure.
- **The palette is half evidence, half ladder.** Uncommon (blue) and epic
  (orange) are unseen; rare and legendary share one purple. The first real
  screenshot with a Bright Veltryn or an Obsidian Alloy row settles uncommon;
  a purple Nyxium beside a purple Purified Veltryn settles whether the two
  shades differ. Update `RARITY_BORDER`, re-run `pnpm icons:ref` and
  `pnpm fixtures:extractor`, and the prompt legend follows.
- **Iron vs Silver Ingot** is unchanged (seven of seven wrong). Same rarity,
  so this round could not touch it; still the hue hint or in-distribution
  crops from the 2026-09-20 notes.
- Everything from 2026-09-20 below still stands (long-edge limit, full-screen
  screenshots not enlarged).

## 2026-09-20 — upscaling, `quantityText` / `box`, prompt hints

Model `claude-opus-5` (no fallback served any request), effort unset (API
default), branch `feat/extractor-accuracy`. All fixtures are synthetic: drawn by
`scripts/make-synthetic-fixtures.ts` from the codex icons. Four runs, one
sample each.

| Run | Code | Upscale | Fixtures | Rows matched | Fragment item-id | Silver quantity | Item-id (all rows) | Quantity (all rows) | Row boxes |
| --- | ---- | ------- | -------- | ------------ | ---------------- | --------------- | ------------------ | ------------------- | --------- |
| a. baseline | prompt and schema as on `main` (00ff21c) | off (did not exist) | the 2 new | 21 / 22 | **12 / 12** | **6 / 6** | 21 / 22 (95.5%) | 22 / 22 | n/a |
| b. new prompt | f228327 | off | all 6 | 48 / 51 | **15 / 17** (88.2%) | **9 / 9** | 48 / 51 (94.1%) | 51 / 51 | 22 / 22 |
| c. new prompt + upscale | f228327 | on (1568px) | all 6 | 50 / 51 | **17 / 17** | **9 / 9** | 50 / 51 (98.0%) | 51 / 51 | 22 / 22 |
| d. c + iron/silver ingot hints | f228327 + two label hints (not kept) | on (1568px) | all 6 | 50 / 51 | **17 / 17** | **9 / 9** | 50 / 51 (98.0%) | 51 / 51 | 22 / 22 |

The same numbers over the two new fixtures only (`synthetic-fragments-heavy`,
`synthetic-money-heavy`), to compare with run a:

| Run | Rows matched | Fragment item-id | Silver quantity |
| --- | ------------ | ---------------- | --------------- |
| a | 21 / 22 | 12 / 12 | 6 / 6 |
| b | 20 / 22 | 11 / 12 | 6 / 6 |
| c | 21 / 22 | 12 / 12 | 6 / 6 |
| d | 21 / 22 | 12 / 12 | 6 / 6 |

Every miss, by run:

- a, b, c, d: `synthetic-money-heavy`, the Iron Ingot row (5000) read as Silver
  Ingot. Four out of four, with and without upscaling, with and without hints.
- b only: `synthetic-fragments-heavy`, one Ring of Night (stack 12) read as
  Bracelet of Faith; `synthetic-mixed-stacks`, the Ring of Night row answered
  `unknown` ("jewelry art is too small to identify reliably"). Both are the
  ring, both without upscaling. The second is the row the first live eval
  (issue #19) got wrong as Necklace of Starlight.

Token usage and cost (at $5 / $25 per MTok in / out, cache write 1.25x, cache
read 0.1x):

| Run | Requests | Input | Output | Cache write | Cache read | About |
| --- | -------- | ----- | ------ | ----------- | ---------- | ----- |
| a | 2 | 1,716 | 4,538 | 3,845 | 3,845 | $0.15 |
| b | 6 | 4,416 | 14,040 | 4,889 | 24,445 | $0.42 |
| c | 6 | 13,308 | 11,025 | 0 | 29,334 | $0.36 |
| d | 6 | 13,308 | 11,332 | 4,978 | 24,890 | $0.39 |

Upscaling adds roughly 900 to 2,200 input tokens per screenshot (for
example 1,054 to 2,566 on the 780x990 fragment fixture, sent at 1.58x): under
one cent. Output tokens (thinking included) are what a request costs, about 5
to 8 cents per screenshot, and they did not grow with the new fields: the
fragment fixture took 3,154 output tokens at baseline and 3,069 in run c. The
cached prefix grew from 3,845 to 4,889 tokens with the longer system prompt and
labels.

### What the numbers do and do not say

- **Upscaling is what helped.** With the new prompt, fragments went from 15/17
  without it to 17/17 with it, twice (c and d). Both ring misses of run b were
  at native size.
- **The prompt change alone shows no gain.** Baseline was already 12/12 on the
  fragment fixture and run b was 11/12. With one sample per configuration that
  difference is inside the noise; what can be said is that the hints did not
  fix the ring at native size. Their effect on real screenshots is unmeasured.
- **Money never failed here**, not even at baseline with 12px gold text: 6/6
  and 9/9 in every run. The synthetic amounts do not reproduce the magnitude
  errors the owner saw on real screenshots, so the grouping check and the
  always-ask rule are untested against a real failure. They are covered by
  unit tests only.
- **Row boxes** were right for 22 of 22 rows in all three runs that asked for
  them (centre of the reported box inside the true row), upscaled or not.
- **The synthetic fixtures are too easy** to rank these changes properly. The
  metric that matters is fragment item-id and silver quantity on real
  screenshots (#7); the playground's "Download fixture" is the way to get them.

### Open after this round

- Iron Ingot vs Silver Ingot at log size: wrong in four of four runs. Two
  label hints (matte blue-grey vs mirror-like neutral grey) changed nothing in
  run d and were not kept. Zoomed in, the 42px iron icon shows a light,
  blue-tinted top face, so "dark, no highlights" was a poor description; a
  hue-based hint or in-distribution reference crops (issue #19, step 2) are the
  next things to try.
- Long-edge limit. The upscaler stops at 1568px, the limit of the standard
  vision tier. `claude-opus-5` is on the high-resolution tier (2576px long
  edge, 4784 visual tokens), so a tall log could be sent at a full 2x instead
  of 1.5x: `EXTRACTOR_UPSCALE_MAX_EDGE=2576` or `--max-edge 2576`. Not measured:
  at 1568px the synthetic fragments are already 17/17, so only real fixtures
  can show a difference. It costs up to about 2,000 more input tokens per image.
- A full-screen 1920x1080 or 2560x1440 screenshot is not enlarged at all under
  either limit (the rule never downscales and never exceeds the long edge). For
  those, cropping to the log before enlarging would be the equivalent fix.
