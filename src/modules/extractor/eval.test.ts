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

  it("scores fragment item ids and Silver Coin quantities as their own categories", () => {
    const expected = [
      row("fragment-ring-of-night", "4"),
      row("fragment-pirates-earring", "2"),
      row("silver-coin", "500000000"),
      row("silver-coin", "75500000"),
      row("gold-ingot", "112"),
    ];
    const actual = [
      row("fragment-necklace-of-starlight", "4"), // wrong fragment, right stack
      row("fragment-pirates-earring", "2"),
      row("silver-coin", "50000000"), // a digit group short
      row("silver-coin", "75500000"),
      row("gold-ingot", "117"), // wrong, but in neither category
    ];

    const score = scoreRows(expected, actual);

    expect(score.fragmentItemId).toEqual({ correct: 1, total: 2 });
    expect(score.silverQuantity).toEqual({ correct: 1, total: 2 });
    expect(score.matched).toBe(2);
  });

  it("counts a row missing from the answer against its category", () => {
    const score = scoreRows([row("fragment-ring-of-night", "4"), row("silver-coin", "5000000")], []);

    expect(score.fragmentItemId).toEqual({ correct: 0, total: 1 });
    expect(score.silverQuantity).toEqual({ correct: 0, total: 1 });
  });

  it("checks boxes only where the fixture has them, pairing identical rows by position", () => {
    const at = (top: number, bottom: number) => ({ ...row("nyxium", "1"), box: { top, bottom } });
    const expected = [at(0.1, 0.2), at(0.2, 0.3), row("gold-ingot", "112")];
    // Same rows, listed bottom-up; the second box is far off.
    const actual = [row("gold-ingot", "112"), at(0.21, 0.29), at(0.6, 0.7)];

    const score = scoreRows(expected, actual);

    expect(score.matched).toBe(3);
    expect(score.boxes).toEqual({ correct: 1, total: 2 });
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
