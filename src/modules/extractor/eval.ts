/**
 * Eval harness: run every fixture through `extract()` and score the rows.
 *
 * A fixture is a directory with
 *   screenshot.png|jpg|jpeg|webp   the image
 *   expected.json                  { looksLikeBankLog, rows: [{ itemId, quantity, gameTimestamp, character }] }
 *                                  (deposit rows only: what should reach the verify screen)
 *   mock-response.json             optional canned *model* output; `mock: true` feeds it through
 *                                  a fake client, so the extractor's own rules still run
 *
 * Rows are compared order-insensitively as multisets of
 * (itemId, quantity, gameTimestamp, character): identical rows are separate
 * deposits and each has to be found.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ExtractorError, extract, type ExtractDeps, type ImageMediaType } from "./index";
import { fakeClient, fakeMessage } from "./testing";

const expectedRowSchema = z.object({
  itemId: z.string(),
  quantity: z.string().regex(/^\d+$/),
  gameTimestamp: z.string(),
  character: z.string(),
});
const expectedSchema = z.object({
  looksLikeBankLog: z.boolean(),
  rows: z.array(expectedRowSchema),
});

export type ExpectedRow = z.infer<typeof expectedRowSchema>;
export type FixtureExpected = z.infer<typeof expectedSchema>;

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
  looksLikeBankLog: { expected: boolean; actual: boolean | null };
  missingRows: ExpectedRow[];
  extraRows: ExpectedRow[];
  warnings: string[];
  /** Set when `extract()` threw; every expected row then counts as missing. */
  error?: { kind: string; message: string };
  model?: string;
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
  /** Passed through to `extract()` in live mode (model, effort, client, ...). */
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

export interface RowScore {
  matched: number;
  missingRows: ExpectedRow[];
  extraRows: ExpectedRow[];
  itemIdCorrect: number;
  quantityCorrect: number;
}

/** Multiset comparison of expected vs extracted rows. Pure. */
export function scoreRows(expected: ExpectedRow[], actual: ExpectedRow[]): RowScore {
  const pool = new Map<string, number>();
  for (const row of actual) pool.set(keyOf(row), (pool.get(keyOf(row)) ?? 0) + 1);

  let matched = 0;
  const missingRows: ExpectedRow[] = [];
  for (const row of expected) {
    const left = pool.get(keyOf(row)) ?? 0;
    if (left > 0) {
      pool.set(keyOf(row), left - 1);
      matched += 1;
    } else {
      missingRows.push(pick(row));
    }
  }
  const extraRows: ExpectedRow[] = [];
  for (const row of actual) {
    const left = pool.get(keyOf(row)) ?? 0;
    if (left > 0) {
      pool.set(keyOf(row), left - 1);
      extraRows.push(pick(row));
    }
  }

  // Per-field credit for near misses: pair each missing row with the unused
  // extracted row that agrees on the most fields (at least one).
  let itemIdCorrect = matched;
  let quantityCorrect = matched;
  const unused = [...extraRows];
  for (const want of missingRows) {
    let best = -1;
    let bestScore = 0;
    unused.forEach((got, index) => {
      const score = FIELDS.filter((field) => got[field] === want[field]).length;
      if (score > bestScore) {
        best = index;
        bestScore = score;
      }
    });
    if (best === -1) continue;
    const [got] = unused.splice(best, 1);
    if (got.itemId === want.itemId) itemIdCorrect += 1;
    if (got.quantity === want.quantity) quantityCorrect += 1;
  }

  return { matched, missingRows, extraRows, itemIdCorrect, quantityCorrect };
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

  try {
    const result = await extract(
      {
        image: await readFile(path.join(dir, screenshot)),
        mediaType: SCREENSHOT_TYPES[screenshot.toLowerCase()],
      },
      deps,
    );
    const score = scoreRows(expected.rows, result.rows);
    return {
      ...base,
      extracted: result.rows.length,
      matched: score.matched,
      missing: score.missingRows.length,
      extra: score.extraRows.length,
      itemIdCorrect: score.itemIdCorrect,
      quantityCorrect: score.quantityCorrect,
      looksLikeBankLog: { expected: expected.looksLikeBankLog, actual: result.looksLikeBankLog },
      missingRows: score.missingRows,
      extraRows: score.extraRows,
      warnings: result.warnings,
      model: result.model,
      usage: result.usage,
    };
  } catch (error) {
    if (!(error instanceof ExtractorError)) throw error;
    return {
      ...base,
      extracted: 0,
      matched: 0,
      missing: expected.rows.length,
      extra: 0,
      itemIdCorrect: 0,
      quantityCorrect: 0,
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
  const expected = sum((r) => r.expected);
  const matched = sum((r) => r.matched);
  const missing = sum((r) => r.missing);
  const extra = sum((r) => r.extra);
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
