import { describe, expect, it } from "vitest";
import type { ExtractionResult, ParsedRow } from "@/modules/extractor";
import type { QueueEntry } from "./queue";
import {
  characterBreakdown,
  combinedTotals,
  finishedResults,
  lowConfidenceCount,
  summarize,
  worstFlag,
} from "./summary";

function row(itemId: string, quantity: string, character = "Leftaltar", confidence = 0.95): ParsedRow {
  return {
    itemId,
    iconDescription: "",
    quantity,
    gameTimestamp: "06.09.2026 - 23:21",
    character,
    direction: "deposit",
    confidence,
  };
}

function result(rows: ParsedRow[], overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    looksLikeBankLog: true,
    rows,
    characters: [...new Set(rows.map((entry) => entry.character))],
    warnings: [],
    model: "claude-opus-5",
    usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    ...overrides,
  };
}

function entry(id: string, state: QueueEntry["state"], body?: QueueEntry["body"]): QueueEntry {
  return {
    id,
    file: { name: `${id}.png`, size: 10, type: "image/png", lastModified: 1 },
    previewUrl: null,
    state,
    body,
  };
}

const ORDER = ["nyxium", "gold-ingot", "ruby", "silver-coin"];

describe("combinedTotals", () => {
  it("sums each item across results, in catalog order", () => {
    const totals = combinedTotals(
      [
        result([row("silver-coin", "500000000"), row("gold-ingot", "112")]),
        result([row("gold-ingot", "888"), row("nyxium", "1"), row("silver-coin", "1")]),
      ],
      ORDER,
    );
    expect(totals).toEqual([
      { itemId: "nyxium", total: 1n, rows: 1 },
      { itemId: "gold-ingot", total: 1000n, rows: 2 },
      { itemId: "silver-coin", total: 500000001n, rows: 2 },
    ]);
  });

  it("sums with BigInt, so silver beyond 2^53 stays exact", () => {
    const [silver] = combinedTotals(
      [
        result([row("silver-coin", "9007199254740993")]),
        result([row("silver-coin", "9007199254740993")]),
        result([row("silver-coin", "10000000000")]),
      ],
      ORDER,
    );
    // 2 x 9,007,199,254,740,993 + 10,000,000,000
    expect(silver.total).toBe(18_014_408_509_481_986n);
    expect(silver.rows).toBe(3);
  });

  it("keeps 'unknown' as its own bucket, last, after ids outside the catalog", () => {
    const totals = combinedTotals(
      [
        result([row("unknown", "3"), row("mystery-ore", "5"), row("ruby", "2")]),
        result([row("unknown", "4"), row("nyxium", "1")]),
      ],
      ORDER,
    );
    expect(totals.map((total) => total.itemId)).toEqual(["nyxium", "ruby", "mystery-ore", "unknown"]);
    expect(totals[3]).toEqual({ itemId: "unknown", total: 7n, rows: 2 });
  });

  it("ignores results that are not a bank log, and copes with nothing", () => {
    expect(combinedTotals([], ORDER)).toEqual([]);
    expect(combinedTotals([result([row("ruby", "9")], { looksLikeBankLog: false })], ORDER)).toEqual([]);
  });

  it("counts a row with an unreadable quantity as 0", () => {
    expect(combinedTotals([result([row("ruby", "n/a"), row("ruby", "5")])], ORDER)).toEqual([
      { itemId: "ruby", total: 5n, rows: 2 },
    ]);
  });
});

describe("characterBreakdown", () => {
  it("counts rows and screenshots per character, most rows first", () => {
    const breakdown = characterBreakdown([
      result([row("ruby", "1", "Leftaltar"), row("ruby", "1", "Rightaltar"), row("ruby", "1", "Leftaltar")]),
      result([row("ruby", "1", "Leftaltar")]),
      result([row("ruby", "1", "Altmain"), row("ruby", "1", " Rightaltar ")]),
    ]);
    expect(breakdown).toEqual([
      { character: "Leftaltar", rows: 3, images: 2 },
      { character: "Rightaltar", rows: 2, images: 2 },
      { character: "Altmain", rows: 1, images: 1 },
    ]);
  });

  it("breaks ties by name and keeps nameless rows in their own bucket", () => {
    const breakdown = characterBreakdown([result([row("ruby", "1", "Zed"), row("ruby", "1", ""), row("ruby", "1", "Abe")])]);
    expect(breakdown.map((entry) => entry.character)).toEqual(["", "Abe", "Zed"]);
  });

  it("skips results that are not a bank log", () => {
    expect(characterBreakdown([result([row("ruby", "1")], { looksLikeBankLog: false })])).toEqual([]);
  });
});

describe("confidence flags", () => {
  it("counts rows below high confidence", () => {
    const rows = [row("ruby", "1", "A", 0.99), row("ruby", "1", "A", 0.85), row("ruby", "1", "A", 0.7), row("ruby", "1", "A", 0.2)];
    expect(lowConfidenceCount(rows)).toBe(2);
    expect(lowConfidenceCount([])).toBe(0);
  });

  it("reports the worst level for the dot", () => {
    expect(worstFlag([row("ruby", "1", "A", 0.99)])).toBeNull();
    expect(worstFlag([row("ruby", "1", "A", 0.99), row("ruby", "1", "A", 0.6)])).toBe("medium");
    expect(worstFlag([row("ruby", "1", "A", 0.6), row("ruby", "1", "A", 0.1)])).toBe("low");
  });
});

describe("summarize", () => {
  const entries: QueueEntry[] = [
    entry("a", "done", {
      durationMs: 12_000,
      result: result([row("ruby", "1", "A", 0.99), row("ruby", "1", "A", 0.4)], { warnings: ["Row 3 is cut off."] }),
    }),
    entry("b", "done", {
      durationMs: 8500,
      result: result([row("nyxium", "1", "B", 0.6)], { warnings: ["Blurry.", "Two names."] }),
    }),
    entry("c", "done", {
      durationMs: 3000,
      result: result([row("ruby", "5")], { looksLikeBankLog: false, warnings: ["Not a bank log."] }),
    }),
    entry("d", "failed"),
    entry("e", "reading"),
    entry("f", "queued"),
    entry("g", "queued"),
    entry("h", "canceled"),
  ];

  it("counts states, rows, flags, warnings and read time across finished images", () => {
    expect(summarize(entries)).toEqual({
      total: 8,
      done: 3,
      failed: 1,
      reading: 1,
      queued: 2,
      canceled: 1,
      settled: 5,
      rows: 3,
      lowConfidenceRows: 2,
      warnings: 4,
      notBankLog: 1,
      durationMs: 23_500,
    });
  });

  it("is all zeroes for an empty batch", () => {
    const empty = summarize([]);
    expect(empty.total).toBe(0);
    expect(empty.rows).toBe(0);
    expect(empty.durationMs).toBe(0);
  });

  it("lists finished results in list order", () => {
    expect(finishedResults(entries)).toHaveLength(3);
    expect(finishedResults(entries)[1].rows[0].itemId).toBe("nyxium");
  });
});
