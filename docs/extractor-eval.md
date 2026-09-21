# Extractor eval log

Live runs of `pnpm eval:extractor --json` (one API request per fixture). The
raw reports are in `fixtures/extractor/.results/` (gitignored). Tracking issue:
#19 (blueprint fragments and Silver Coin amounts).

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
