import { describe, expect, it } from "vitest";
import { runEval, scoreRows, type ExpectedRow } from "./eval";

const row = (itemId: string, quantity: string, character = "Leftaltar"): ExpectedRow => ({
  itemId,
  quantity,
  gameTimestamp: "06.09.2026 - 23:21",
  character,
});

describe("scoreRows", () => {
  it("matches order-insensitively and counts identical rows separately", () => {
    const expected = [row("nyxium", "1"), row("nyxium", "1"), row("gold-ingot", "112")];
    const actual = [row("gold-ingot", "112"), row("nyxium", "1")];

    const score = scoreRows(expected, actual);

    expect(score.matched).toBe(2);
    expect(score.missingRows).toEqual([row("nyxium", "1")]);
    expect(score.extraRows).toEqual([]);
  });

  it("gives per-field credit to a near miss", () => {
    const score = scoreRows([row("gold-ingot", "112")], [row("gold-ingot", "117")]);

    expect(score.matched).toBe(0);
    expect(score.missingRows).toHaveLength(1);
    expect(score.extraRows).toHaveLength(1);
    expect(score.itemIdCorrect).toBe(1);
    expect(score.quantityCorrect).toBe(0);
  });
});

describe("runEval --mock over the shipped fixtures", () => {
  it("scores 100% with no network and no API key", async () => {
    const report = await runEval({ mock: true });

    expect(report.mode).toBe("mock");
    expect(report.fixtures.length).toBeGreaterThanOrEqual(3);
    expect(report.totals.errors).toBe(0);
    expect(report.totals.expected).toBeGreaterThan(0);
    expect(report.totals).toMatchObject({
      missing: 0,
      extra: 0,
      rowAccuracy: 1,
      itemIdAccuracy: 1,
      quantityAccuracy: 1,
      bankLogFlagAccuracy: 1,
    });

    const byName = Object.fromEntries(report.fixtures.map((fixture) => [fixture.name, fixture]));
    // The withdrawal in this fixture is dropped by the extractor, not by the mock.
    expect(byName["synthetic-silver-and-withdraw"].warnings.join("\n")).toMatch(/Dropped 1/);
    expect(byName["synthetic-not-a-bank-log"].looksLikeBankLog.actual).toBe(false);
  });
});
