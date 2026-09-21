/**
 * pnpm eval:extractor [--mock] [--json] [--min-accuracy 0.9] [--fixtures <dir>]
 *                     [--upscale on|off] [--max-edge <px>] [fixture ...]
 *
 * Runs every fixture in `fixtures/extractor/` through the extractor and
 * prints per-fixture and total accuracy. `--mock` needs no API key (this is
 * what CI runs); without it each fixture is one real API call. `--upscale` and
 * `--max-edge` override EXTRACTOR_UPSCALE / EXTRACTOR_UPSCALE_MAX_EDGE, to
 * compare runs with and without the enlargement.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import type { ExtractDeps } from "@/modules/extractor";
import { defaultFixturesDir, runEval, type FixtureResult } from "@/modules/extractor/eval";
import { loadDotEnv } from "./env";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const category = (accuracy: number, count: { correct: number; total: number }) =>
  count.total === 0 ? "n/a (no such rows)" : `${percent(accuracy)}   ${count.correct} / ${count.total}`;

function printFixture(result: FixtureResult) {
  const flag =
    result.looksLikeBankLog.actual === result.looksLikeBankLog.expected
      ? ""
      : `  looksLikeBankLog: expected ${result.looksLikeBankLog.expected}, got ${result.looksLikeBankLog.actual}`;
  const status = result.error
    ? "ERROR"
    : result.missing === 0 && result.extra === 0 && !flag
      ? "ok"
      : "DIFF";
  console.log(
    `${status.padEnd(5)} ${result.name}  matched ${result.matched}/${result.expected}  extra ${result.extra}${flag}`,
  );
  if (result.error) console.log(`      ${result.error.kind}: ${result.error.message}`);
  for (const row of result.missingRows) console.log(`      missing ${JSON.stringify(row)}`);
  for (const row of result.extraRows) console.log(`      extra   ${JSON.stringify(row)}`);
  for (const warning of result.warnings) console.log(`      warning: ${warning}`);
  if (result.upscale?.applied) {
    const { scale, width, height } = result.upscale;
    console.log(`      sent enlarged ${scale.toFixed(2)}x (upload ${width}x${height})`);
  }
  if (result.usage && result.usage.inputTokens + result.usage.outputTokens > 0) {
    const u = result.usage;
    console.log(
      `      ${result.model}: in ${u.inputTokens}, out ${u.outputTokens}, cache write ${u.cacheCreationInputTokens}, cache read ${u.cacheReadInputTokens}`,
    );
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      mock: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      "min-accuracy": { type: "string", default: "0" },
      fixtures: { type: "string" },
      upscale: { type: "string" },
      "max-edge": { type: "string" },
    },
  });

  let minAccuracy = Number(values["min-accuracy"]);
  if (!Number.isFinite(minAccuracy) || minAccuracy < 0 || minAccuracy > 100) {
    console.error(`--min-accuracy must be between 0 and 1 (got "${values["min-accuracy"]}")`);
    process.exit(2);
  }
  if (minAccuracy > 1) minAccuracy /= 100; // allow "90" for 90%

  if (values.upscale !== undefined && values.upscale !== "on" && values.upscale !== "off") {
    console.error(`--upscale must be "on" or "off" (got "${values.upscale}")`);
    process.exit(2);
  }
  const maxEdge = values["max-edge"] === undefined ? undefined : Number(values["max-edge"]);
  if (maxEdge !== undefined && !Number.isInteger(maxEdge)) {
    console.error(`--max-edge must be a whole number of pixels (got "${values["max-edge"]}")`);
    process.exit(2);
  }
  const deps: ExtractDeps = {
    ...(values.upscale === undefined ? {} : { upscale: values.upscale === "on" }),
    ...(maxEdge === undefined ? {} : { upscaleMaxEdge: maxEdge }),
  };

  loadDotEnv();
  const hasKey = Boolean(
    process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim(),
  );
  if (!values.mock && !hasKey) {
    console.error(
      [
        "ANTHROPIC_API_KEY is not set, and a live eval makes one real API call per fixture.",
        "  - put ANTHROPIC_API_KEY=... in .env (see .env.example), or",
        "  - run `pnpm eval:extractor --mock` to use the canned model responses (no key, no network).",
      ].join("\n"),
    );
    process.exit(2);
  }

  const fixturesDir = values.fixtures ? path.resolve(values.fixtures) : defaultFixturesDir();
  console.log(`extractor eval (${values.mock ? "mock" : "live"}) over ${fixturesDir}\n`);

  const report = await runEval({
    fixturesDir,
    mock: values.mock,
    only: positionals,
    deps,
    onFixture: printFixture,
  });

  const t = report.totals;
  const usage = report.fixtures.reduce(
    (total, fixture) => ({
      input: total.input + (fixture.usage?.inputTokens ?? 0),
      output: total.output + (fixture.usage?.outputTokens ?? 0),
      cacheWrite: total.cacheWrite + (fixture.usage?.cacheCreationInputTokens ?? 0),
      cacheRead: total.cacheRead + (fixture.usage?.cacheReadInputTokens ?? 0),
    }),
    { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
  );
  console.log(
    [
      "",
      `fixtures          ${t.fixtures} (${t.errors} errored)`,
      `rows              matched ${t.matched} / expected ${t.expected}, missing ${t.missing}, extra ${t.extra}`,
      `row accuracy      ${percent(t.rowAccuracy)}   matched / (matched + missing + extra)`,
      `item-id accuracy  ${percent(t.itemIdAccuracy)}`,
      `quantity accuracy ${percent(t.quantityAccuracy)}`,
      `fragment item-id  ${category(t.fragmentItemIdAccuracy, t.fragmentItemId)}`,
      `silver quantity   ${category(t.silverQuantityAccuracy, t.silverQuantity)}`,
      `row boxes         ${category(t.boxAccuracy, t.boxes)}`,
      `bank-log flag     ${percent(t.bankLogFlagAccuracy)}`,
      ...(usage.input + usage.output > 0
        ? [
            `tokens            in ${usage.input}, out ${usage.output}, cache write ${usage.cacheWrite}, cache read ${usage.cacheRead}`,
          ]
        : []),
    ].join("\n"),
  );

  if (values.json) {
    const dir = path.join(fixturesDir, ".results");
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `${stamp}-${report.mode}.json`);
    await writeFile(file, `${JSON.stringify({ ranAt: new Date().toISOString(), ...report }, null, 2)}\n`);
    console.log(`\nresults written to ${path.relative(process.cwd(), file)}`);
  }

  if (t.rowAccuracy < minAccuracy) {
    console.error(`\nrow accuracy ${percent(t.rowAccuracy)} is below --min-accuracy ${percent(minAccuracy)}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
