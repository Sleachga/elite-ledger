import { describe, expect, it } from "vitest";
import type { ExtractionResult, ParsedRow } from "@/modules/extractor";
import { batchReducer, initialBatchState, reviewedImages, reviewSources, type BatchAction, type BatchState } from "./batch";
import type { QueueFile } from "./queue";
import { combinedTotals } from "./summary";

function row(itemId: string, quantity: string, character = "Leftaltar"): ParsedRow {
  return {
    itemId,
    iconDescription: "",
    quantity,
    gameTimestamp: "06.09.2026 - 23:21",
    character,
    direction: "deposit",
    confidence: 0.95,
  };
}

function result(rows: ParsedRow[], looksLikeBankLog = true): ExtractionResult {
  return {
    looksLikeBankLog,
    rows,
    characters: [],
    warnings: [],
    model: "claude-opus-5",
    usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  };
}

function file(name: string): QueueFile {
  return { name, size: 10, type: "image/png", lastModified: 1 };
}

function run(state: BatchState, ...actions: BatchAction[]): BatchState {
  return actions.reduce(batchReducer, state);
}

/** Two images enqueued; "a" read with gold 112 + silver 50m, "b" still reading. */
function batch(): BatchState {
  return run(
    initialBatchState(),
    {
      type: "enqueue",
      now: 0,
      items: [
        { id: "a", file: file("a.png"), previewUrl: null },
        { id: "b", file: file("b.png"), previewUrl: null },
      ],
    },
    { type: "start", id: "a", now: 1 },
    { type: "start", id: "b", now: 1 },
    {
      type: "succeed",
      id: "a",
      now: 5,
      body: { result: result([row("gold-ingot", "112"), row("silver-coin", "50000000")]), durationMs: 4 },
    },
  );
}

describe("batchReducer", () => {
  it("starts a review the moment a read finishes", () => {
    const state = batch();
    expect(Object.keys(state.review)).toEqual(["a"]);
    expect(state.review.a.token).toBe(5);
    expect(state.review.a.rows.map((entry) => [entry.current.itemId, entry.checked])).toEqual([
      ["gold-ingot", true],
      ["silver-coin", false],
    ]);
  });

  it("routes review actions to the review and leaves the queue alone", () => {
    const before = batch();
    const after = run(before, { type: "toggleChecked", imageId: "a", rowId: "r1" });
    expect(after.queue).toBe(before.queue);
    expect(after.review.a.rows[1].checked).toBe(true);
    expect(run(before, { type: "toggleChecked", imageId: "zzz", rowId: "r1" })).toBe(before);
  });

  it("keeps a review through unrelated queue changes", () => {
    const before = run(batch(), { type: "setQuantity", imageId: "a", rowId: "r1", quantity: "500000000" });
    const after = run(before, {
      type: "succeed",
      id: "b",
      now: 9,
      body: { result: result([row("ruby", "5")]), durationMs: 4 },
    });
    expect(after.review.a).toBe(before.review.a);
    expect(after.review.b.rows).toHaveLength(1);
  });

  it("forgets the review of a removed image, and all of them on clear", () => {
    expect(Object.keys(run(batch(), { type: "remove", id: "a" }).review)).toEqual([]);
    expect(run(batch(), { type: "clear" }).review).toEqual({});
  });

  it("reviews a result that is not a bank log as no rows", () => {
    const state = run(batch(), {
      type: "succeed",
      id: "b",
      now: 9,
      body: { result: result([row("ruby", "5")], false), durationMs: 4 },
    });
    expect(state.review.b.rows).toEqual([]);
    expect(reviewSources(state.queue.entries).map((source) => source.rows.length)).toEqual([2, 0]);
  });

  it("returns the same state for an action that changes nothing", () => {
    const before = batch();
    expect(run(before, { type: "resume" })).toBe(before);
  });
});

describe("reviewedImages", () => {
  it("hands the summary and the exports the corrected rows of finished images", () => {
    const state = run(
      batch(),
      { type: "setQuantity", imageId: "a", rowId: "r1", quantity: "500000000" },
      { type: "deleteRow", imageId: "a", rowId: "r0" },
      { type: "addRow", imageId: "a", values: { itemId: "ruby", quantity: "9", gameTimestamp: "", character: "" } },
    );
    const images = reviewedImages(state.queue.entries, state.review);
    expect(images).toEqual([
      {
        imageId: "a",
        fileName: "a.png",
        looksLikeBankLog: true,
        rows: [
          { itemId: "silver-coin", quantity: "500000000", gameTimestamp: "06.09.2026 - 23:21", character: "Leftaltar" },
          { itemId: "ruby", quantity: "9", gameTimestamp: "", character: "" },
        ],
      },
    ]);
    expect(combinedTotals(images, ["ruby", "silver-coin"])).toEqual([
      { itemId: "ruby", total: 9n, rows: 1 },
      { itemId: "silver-coin", total: 500000000n, rows: 1 },
    ]);
  });
});
