/**
 * pnpm eval:extractor [--mock] [--json] [--min-accuracy 0.9] [--fixtures <dir>] [fixture ...]
 *
 * Runs every fixture in `fixtures/extractor/` through the extractor and
 * prints per-fixture and total accuracy. `--mock` needs no API key (this is
 * what CI runs); without it each fixture is one real API call.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { defaultFixturesDir, runEval, type FixtureResult } from "@/modules/extractor/eval";
import { loadDotEnv } from "./env";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

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
    },
  });

  let minAccuracy = Number(values["min-accuracy"]);
  if (!Number.isFinite(minAccuracy) || minAccuracy < 0 || minAccuracy > 100) {
    console.error(`--min-accuracy must be between 0 and 1 (got "${values["min-accuracy"]}")`);
    process.exit(2);
  }
  if (minAccuracy > 1) minAccuracy /= 100; // allow "90" for 90%

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
    onFixture: printFixture,
  });

  const t = report.totals;
  console.log(
    [
      "",
      `fixtures          ${t.fixtures} (${t.errors} errored)`,
      `rows              matched ${t.matched} / expected ${t.expected}, missing ${t.missing}, extra ${t.extra}`,
      `row accuracy      ${percent(t.rowAccuracy)}   matched / (matched + missing + extra)`,
      `item-id accuracy  ${percent(t.itemIdAccuracy)}`,
      `quantity accuracy ${percent(t.quantityAccuracy)}`,
      `bank-log flag     ${percent(t.bankLogFlagAccuracy)}`,
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
