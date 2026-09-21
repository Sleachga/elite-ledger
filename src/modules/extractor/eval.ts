/**
 * Eval harness: run every fixture through `extract()` and score the rows.
 *
 * A fixture is a directory with
 *   screenshot.png|jpg|jpeg|webp   the image
 *   expected.json                  { looksLikeBankLog, rows: [{ itemId, quantity, gameTimestamp, character, box? }] }
 *                                  (deposit rows only: what should reach the verify screen;
 *                                  `box` = the row's { top, bottom } as fractions of the image height)
 *   mock-response.json             optional canned *model* output; `mock: true` feeds it through
 *                                  a fake client, so the extractor's own rules still run
 *
 * Rows are compared order-insensitively as multisets of
 * (itemId, quantity, gameTimestamp, character): identical rows are separate
 * deposits and each has to be found.
 *
 * Two categories get their own numbers because a mistake there costs the most
 * (issue #19): item-id accuracy over blueprint-fragment rows, and quantity
 * accuracy over Silver Coin rows.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { catalog as vendoredCatalog, type CatalogItem } from "@/catalog";
import {
  ExtractorError,
  extract,
  type ExtractDeps,
  type ImageMediaType,
  type UpscaleReport,
} from "./index";
import { fakeClient, fakeMessage } from "./testing";

const boxSchema = z.object({ top: z.number(), bottom: z.number() });
const expectedRowSchema = z.object({
  itemId: z.string(),
  quantity: z.string().regex(/^\d+$/),
  gameTimestamp: z.string(),
  character: z.string(),
  /** Where the row is, as fractions of the image height. Not part of row matching. */
  box: boxSchema.optional(),
});
const expectedSchema = z.object({
  looksLikeBankLog: z.boolean(),
  rows: z.array(expectedRowSchema),
});

export type ExpectedRow = z.infer<typeof expectedRowSchema>;
export type FixtureExpected = z.infer<typeof expectedSchema>;

/** right / total over one category of expected rows. */
export interface CategoryCount {
  correct: number;
  total: number;
}

const SCREENSHOT_TYPES: Record<string, ImageMediaType> = {
  "screenshot.png": "image/png",
  "screenshot.jpg": "image/jpeg",
  "screenshot.jpeg": "image/jpeg",
  "screenshot.webp": "image/webp",
};

export interface FixtureResult {
  name: string;
  expected: number;
  extracted: number;
  /** Rows equal on all four fields. */
  matched: number;
  /** Expected rows with no exact match. */
  missing: number;
  /** Extracted rows with no exact match. */
  extra: number;
  /** Expected rows whose item id was right (exact matches plus best-effort pairs). */
  itemIdCorrect: number;
  /** Expected rows whose quantity was right. */
  quantityCorrect: number;
  /** Blueprint-fragment rows: how many got the right item id. */
  fragmentItemId: CategoryCount;
  /** Silver Coin rows: how many got the right quantity. */
  silverQuantity: CategoryCount;
  /** Expected rows that carry a `box`: how many extracted boxes have their centre inside it. */
  boxes: CategoryCount;
  looksLikeBankLog: { expected: boolean; actual: boolean | null };
  missingRows: ExpectedRow[];
  extraRows: ExpectedRow[];
  warnings: string[];
  /** Set when `extract()` threw; every expected row then counts as missing. */
  error?: { kind: string; message: string };
  model?: string;
  /** What was done to the screenshot before it was sent. */
  upscale?: UpscaleReport;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
}

export interface EvalTotals {
  fixtures: number;
  expected: number;
  extracted: number;
  matched: number;
  missing: number;
  extra: number;
  /** matched / (matched + missing + extra): 1 only when nothing is missing and nothing is invented. */
  rowAccuracy: number;
  /** Share of expected rows with the right item id. */
  itemIdAccuracy: number;
  /** Share of expected rows with the right quantity. */
  quantityAccuracy: number;
  fragmentItemId: CategoryCount;
  /** Share of blueprint-fragment rows with the right item id (1 when there are none). */
  fragmentItemIdAccuracy: number;
  silverQuantity: CategoryCount;
  /** Share of Silver Coin rows with the right quantity (1 when there are none). */
  silverQuantityAccuracy: number;
  boxes: CategoryCount;
  /** Share of expected boxes that contain the extracted box's centre (1 when there are none). */
  boxAccuracy: number;
  /** Share of fixtures where looksLikeBankLog was right. */
  bankLogFlagAccuracy: number;
  errors: number;
}

export interface EvalReport {
  mode: "mock" | "live";
  fixturesDir: string;
  fixtures: FixtureResult[];
  totals: EvalTotals;
}

export interface EvalOptions {
  fixturesDir?: string;
  /** Use each fixture's `mock-response.json` through a fake client (no network, no key). */
  mock?: boolean;
  /** Only run fixtures whose directory name is listed. */
  only?: string[];
  /** Passed through to `extract()` in live mode (model, effort, client, upscale, ...). */
  deps?: ExtractDeps;
  /** Called after each fixture, for progress output. */
  onFixture?: (result: FixtureResult) => void;
}

export function defaultFixturesDir(): string {
  return path.join(process.cwd(), "fixtures", "extractor");
}

const FIELDS = ["itemId", "quantity", "gameTimestamp", "character"] as const;

function keyOf(row: ExpectedRow): string {
  return JSON.stringify(FIELDS.map((field) => row[field]));
}

function pick(row: ExpectedRow): ExpectedRow {
  return {
    itemId: row.itemId,
    quantity: row.quantity,
    gameTimestamp: row.gameTimestamp,
    character: row.character,
  };
}

/** Which item ids count as blueprint fragments / Silver Coin for the category numbers. */
export interface RowCategories {
  fragmentIds: ReadonlySet<string>;
  silverIds: ReadonlySet<string>;
}

export function categoriesOf(catalog: readonly Pick<CatalogItem, "id" | "kind">[]): RowCategories {
  const ids = (kind: CatalogItem["kind"]) =>
    new Set(catalog.filter((item) => item.kind === kind).map((item) => item.id));
  return { fragmentIds: ids("fragment"), silverIds: ids("currency") };
}

export interface RowScore {
  matched: number;
  missingRows: ExpectedRow[];
  extraRows: ExpectedRow[];
  itemIdCorrect: number;
  quantityCorrect: number;
  fragmentItemId: CategoryCount;
  silverQuantity: CategoryCount;
  boxes: CategoryCount;
}

function boxContainsCentre(want: ExpectedRow["box"], got: ExpectedRow["box"]): boolean {
  if (!want || !got) return false;
  const centre = (got.top + got.bottom) / 2;
  return centre >= want.top && centre <= want.bottom;
}

/** Multiset comparison of expected vs extracted rows. Pure. */
export function scoreRows(
  expected: ExpectedRow[],
  actual: ExpectedRow[],
  categories: RowCategories = categoriesOf(vendoredCatalog),
): RowScore {
  // Each expected row is paired with at most one extracted row: first an exact
  // match, then (for near misses) the unused row that agrees on the most
  // fields. Identical rows are interchangeable, so they are paired by position
  // first (the one whose box fits), then in order.
  const unused = [...actual];
  const take = (want: ExpectedRow, candidates: number[]): ExpectedRow | undefined => {
    if (candidates.length === 0) return undefined;
    const fitting = candidates.find((index) => boxContainsCentre(want.box, unused[index].box));
    return unused.splice(fitting ?? candidates[0], 1)[0];
  };
  const sameKey = (want: ExpectedRow) => {
    const key = keyOf(want);
    return unused.flatMap((row, index) => (keyOf(row) === key ? [index] : []));
  };

  const pairs: { want: ExpectedRow; got?: ExpectedRow; exact: boolean }[] = expected.map(
    (want) => ({ want, exact: false }),
  );
  for (const pair of pairs) {
    const fitting = sameKey(pair.want).filter((index) =>
      boxContainsCentre(pair.want.box, unused[index].box),
    );
    pair.got = take(pair.want, fitting);
  }
  for (const pair of pairs) {
    pair.got ??= take(pair.want, sameKey(pair.want));
    pair.exact = pair.got !== undefined;
  }

  for (const pair of pairs) {
    if (pair.got) continue;
    let bestScore = 0;
    let best: number[] = [];
    unused.forEach((row, index) => {
      const score = FIELDS.filter((field) => row[field] === pair.want[field]).length;
      if (score > bestScore) {
        bestScore = score;
        best = [index];
      } else if (score === bestScore && score > 0) {
        best.push(index);
      }
    });
    pair.got = take(pair.want, best);
  }

  const count = (rows: typeof pairs, correct: (pair: (typeof pairs)[number]) => boolean) => ({
    correct: rows.filter(correct).length,
    total: rows.length,
  });
  const sameItem = (pair: (typeof pairs)[number]) => pair.got?.itemId === pair.want.itemId;
  const sameQuantity = (pair: (typeof pairs)[number]) => pair.got?.quantity === pair.want.quantity;
  const missing = pairs.filter((pair) => !pair.exact);

  return {
    matched: pairs.length - missing.length,
    missingRows: missing.map((pair) => pick(pair.want)),
    // Near-miss partners and leftovers alike: extracted rows with no exact match.
    extraRows: [...missing.flatMap((pair) => (pair.got ? [pair.got] : [])), ...unused].map(pick),
    itemIdCorrect: pairs.filter(sameItem).length,
    quantityCorrect: pairs.filter(sameQuantity).length,
    fragmentItemId: count(
      pairs.filter((pair) => categories.fragmentIds.has(pair.want.itemId)),
      sameItem,
    ),
    silverQuantity: count(
      pairs.filter((pair) => categories.silverIds.has(pair.want.itemId)),
      sameQuantity,
    ),
    boxes: count(
      pairs.filter((pair) => pair.want.box !== undefined),
      (pair) => boxContainsCentre(pair.want.box, pair.got?.box),
    ),
  };
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

async function runFixture(dir: string, name: string, options: EvalOptions): Promise<FixtureResult> {
  const expected = expectedSchema.parse(await readJson(path.join(dir, "expected.json")));
  const files = await readdir(dir);
  const screenshot = files.find((file) => file.toLowerCase() in SCREENSHOT_TYPES);
  if (!screenshot) throw new Error(`fixture "${name}" has no screenshot.png/jpg/jpeg/webp`);

  let deps: ExtractDeps = options.deps ?? {};
  if (options.mock) {
    if (!files.includes("mock-response.json")) {
      throw new Error(`fixture "${name}" has no mock-response.json, so it cannot run with --mock`);
    }
    const canned = await readJson(path.join(dir, "mock-response.json"));
    deps = { ...deps, client: fakeClient(fakeMessage(canned)) };
  }

  const base = {
    name,
    expected: expected.rows.length,
    looksLikeBankLog: { expected: expected.looksLikeBankLog, actual: null },
  };
  const categories = categoriesOf(deps.catalog ?? vendoredCatalog);

  try {
    const result = await extract(
      {
        image: await readFile(path.join(dir, screenshot)),
        mediaType: SCREENSHOT_TYPES[screenshot.toLowerCase()],
      },
      deps,
    );
    const score = scoreRows(expected.rows, result.rows, categories);
    return {
      ...base,
      extracted: result.rows.length,
      matched: score.matched,
      missing: score.missingRows.length,
      extra: score.extraRows.length,
      itemIdCorrect: score.itemIdCorrect,
      quantityCorrect: score.quantityCorrect,
      fragmentItemId: score.fragmentItemId,
      silverQuantity: score.silverQuantity,
      boxes: score.boxes,
      looksLikeBankLog: { expected: expected.looksLikeBankLog, actual: result.looksLikeBankLog },
      missingRows: score.missingRows,
      extraRows: score.extraRows,
      warnings: result.warnings,
      model: result.model,
      upscale: result.upscale,
      usage: result.usage,
    };
  } catch (error) {
    if (!(error instanceof ExtractorError)) throw error;
    // Nothing came back: every expected row is wrong in every category.
    const score = scoreRows(expected.rows, [], categories);
    return {
      ...base,
      extracted: 0,
      matched: 0,
      missing: expected.rows.length,
      extra: 0,
      itemIdCorrect: 0,
      quantityCorrect: 0,
      fragmentItemId: score.fragmentItemId,
      silverQuantity: score.silverQuantity,
      boxes: score.boxes,
      missingRows: expected.rows.map(pick),
      extraRows: [],
      warnings: [],
      error: { kind: error.kind, message: error.message },
    };
  }
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

export function totalsOf(fixtures: FixtureResult[]): EvalTotals {
  const sum = (field: (result: FixtureResult) => number) =>
    fixtures.reduce((total, result) => total + field(result), 0);
  const sumCategory = (field: (result: FixtureResult) => CategoryCount): CategoryCount => ({
    correct: sum((r) => field(r).correct),
    total: sum((r) => field(r).total),
  });
  const expected = sum((r) => r.expected);
  const matched = sum((r) => r.matched);
  const missing = sum((r) => r.missing);
  const extra = sum((r) => r.extra);
  const fragmentItemId = sumCategory((r) => r.fragmentItemId);
  const silverQuantity = sumCategory((r) => r.silverQuantity);
  const boxes = sumCategory((r) => r.boxes);
  return {
    fixtures: fixtures.length,
    expected,
    extracted: sum((r) => r.extracted),
    matched,
    missing,
    extra,
    rowAccuracy: ratio(matched, matched + missing + extra),
    itemIdAccuracy: ratio(sum((r) => r.itemIdCorrect), expected),
    quantityAccuracy: ratio(sum((r) => r.quantityCorrect), expected),
    fragmentItemId,
    fragmentItemIdAccuracy: ratio(fragmentItemId.correct, fragmentItemId.total),
    silverQuantity,
    silverQuantityAccuracy: ratio(silverQuantity.correct, silverQuantity.total),
    boxes,
    boxAccuracy: ratio(boxes.correct, boxes.total),
    bankLogFlagAccuracy: ratio(
      fixtures.filter((r) => r.looksLikeBankLog.actual === r.looksLikeBankLog.expected).length,
      fixtures.length,
    ),
    errors: fixtures.filter((r) => r.error).length,
  };
}

export async function runEval(options: EvalOptions = {}): Promise<EvalReport> {
  const fixturesDir = options.fixturesDir ?? defaultFixturesDir();
  const entries = await readdir(fixturesDir, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .filter((name) => !options.only?.length || options.only.includes(name))
    .sort();
  if (names.length === 0) throw new Error(`no fixtures found in ${fixturesDir}`);

  // One at a time: in live mode the first request writes the prompt cache
  // (system + reference icons) and the rest read it.
  const fixtures: FixtureResult[] = [];
  for (const name of names) {
    const result = await runFixture(path.join(fixturesDir, name), name, options);
    fixtures.push(result);
    options.onFixture?.(result);
  }
  return {
    mode: options.mock ? "mock" : "live",
    fixturesDir,
    fixtures,
    totals: totalsOf(fixtures),
  };
}
