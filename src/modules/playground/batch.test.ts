import { describe, expect, it } from "vitest";
import type { ExtractionResult, ParsedRow } from "@/modules/extractor";
import {
  batchCounts,
  batchReducer,
  canConfirm,
  checkSequence,
  firstImageToCheck,
  initialBatchState,
  reviewedImages,
  reviewSources,
  uploadStep,
  type BatchAction,
  type BatchState,
} from "./batch";
import { buildTsv } from "./export";
import type { QueueFile } from "./queue";
import { characterBreakdown, combinedTotals } from "./summary";

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

/**
 * Two images read: "a" has SlimJimTim gold (safe) + Leftaltar silver (needs a
 * look); "b" has Leftaltar ruby (safe) + SlimJimTim silver (needs a look).
 */
function twoCharacters(): BatchState {
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
      body: {
        result: result([row("gold-ingot", "112", "SlimJimTim"), row("silver-coin", "50000000", "Leftaltar")]),
        durationMs: 4,
      },
    },
    {
      type: "succeed",
      id: "b",
      now: 6,
      body: {
        result: result([row("ruby", "5", "Leftaltar"), row("silver-coin", "70000000", "SlimJimTim")]),
        durationMs: 4,
      },
    },
  );
}

describe("character filter", () => {
  it("sets and clears, and ignores a name no row has", () => {
    const state = twoCharacters();
    const filtered = run(state, { type: "filterCharacter", character: "SlimJimTim" });
    expect(filtered.character).toBe("SlimJimTim");
    expect(run(filtered, { type: "filterCharacter", character: null }).character).toBeNull();
    expect(run(state, { type: "filterCharacter", character: "Nobody" })).toBe(state);
    expect(run(filtered, { type: "filterCharacter", character: "SlimJimTim" })).toBe(filtered);
  });

  it("scopes the rows, the counts and the first image to check", () => {
    const state = run(twoCharacters(), { type: "filterCharacter", character: "SlimJimTim" });
    expect(reviewedImages(state.queue.entries, state.review, state.character).map((image) => image.rows)).toEqual([
      [{ itemId: "gold-ingot", quantity: "112", gameTimestamp: "06.09.2026 - 23:21", character: "SlimJimTim" }],
      [{ itemId: "silver-coin", quantity: "70000000", gameTimestamp: "06.09.2026 - 23:21", character: "SlimJimTim" }],
    ]);
    expect(batchCounts(state.queue.entries, state.review, state.character)).toMatchObject({ rows: 2, toCheck: 1 });
    expect(batchCounts(state.queue.entries, state.review)).toMatchObject({ rows: 4, toCheck: 2 });
    // SlimJimTim's only unchecked row is in "b"; Leftaltar's is in "a".
    expect(firstImageToCheck(state.queue.entries, state.review, "SlimJimTim")).toBe("b");
    expect(firstImageToCheck(state.queue.entries, state.review, "Leftaltar")).toBe("a");
    expect(firstImageToCheck(state.queue.entries, state.review)).toBe("a");
  });

  it("filters the TSV export", () => {
    const state = run(twoCharacters(), { type: "filterCharacter", character: "Leftaltar" });
    const images = reviewedImages(state.queue.entries, state.review, state.character);
    expect(buildTsv(images, { header: false }).split("\n")).toEqual([
      "06.09.2026 - 23:21\tLeftaltar\tSilver Coin\t50000000\ta.png",
      "06.09.2026 - 23:21\tLeftaltar\tRuby\t5\tb.png",
    ]);
    // The export can also do the filtering itself.
    expect(buildTsv(reviewedImages(state.queue.entries, state.review), { header: false, character: "SlimJimTim" })).toBe(
      "06.09.2026 - 23:21\tSlimJimTim\tGold Ingot\t112\ta.png\n06.09.2026 - 23:21\tSlimJimTim\tSilver Coin\t70000000\tb.png",
    );
  });

  it("is dropped when the character's last row is removed or renamed", () => {
    const filtered = run(twoCharacters(), { type: "filterCharacter", character: "SlimJimTim" });
    const renamed = run(filtered, { type: "setCharacter", imageId: "a", rowId: "r0", character: "xReacher" });
    expect(renamed.character).toBe("SlimJimTim");
    const gone = run(renamed, { type: "deleteRow", imageId: "b", rowId: "r1" });
    expect(gone.character).toBeNull();
    expect(run(filtered, { type: "remove", id: "a" }).character).toBe("SlimJimTim");
    expect(run(filtered, { type: "clear" }).character).toBeNull();
  });

  it("counts rows per character from the corrected rows", () => {
    const state = run(
      twoCharacters(),
      { type: "setCharacter", imageId: "a", rowId: "r1", character: "SlimJimTim" },
      { type: "deleteRow", imageId: "b", rowId: "r0" },
      { type: "addRow", imageId: "b", values: { itemId: "ruby", quantity: "1", gameTimestamp: "", character: "xReacher" } },
    );
    expect(characterBreakdown(reviewedImages(state.queue.entries, state.review))).toEqual([
      { character: "SlimJimTim", rows: 3, images: 2 },
      { character: "xReacher", rows: 1, images: 1 },
    ]);
  });
});

describe("check dialog", () => {
  it("opens by itself on the first image to check once the last read is in, once per round", () => {
    const state = twoCharacters();
    expect(state.checking).toBe("a");
    expect(state.autoOpened).toBe(true);
    // Not before the round is over.
    const midway = run(state, { type: "closeCheck" }, { type: "retry", id: "b" }, { type: "start", id: "b", now: 7 });
    expect(midway.checking).toBeNull();
    const again = run(midway, {
      type: "succeed",
      id: "b",
      now: 9,
      body: { result: result([row("silver-coin", "1")]), durationMs: 1 },
    });
    expect(again.checking).toBeNull();
    // More images: a new round, so it may open once more when that one finishes.
    const nextRound = run(
      again,
      { type: "enqueue", now: 10, items: [{ id: "c", file: file("c.png"), previewUrl: null }] },
      { type: "start", id: "c", now: 11 },
      { type: "succeed", id: "c", now: 12, body: { result: result([row("silver-coin", "2")]), durationMs: 1 } },
    );
    expect(nextRound.checking).toBe("a");
  });

  it("stays closed when every row is already safe, or when it is already open", () => {
    const safe = run(
      initialBatchState(),
      { type: "enqueue", now: 0, items: [{ id: "a", file: file("a.png"), previewUrl: null }] },
      { type: "start", id: "a", now: 1 },
      { type: "succeed", id: "a", now: 5, body: { result: result([row("gold-ingot", "112")]), durationMs: 4 } },
    );
    expect(safe.checking).toBeNull();
    expect(safe.autoOpened).toBe(false);
    const open = run(
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
      { type: "succeed", id: "a", now: 5, body: { result: result([row("silver-coin", "1")]), durationMs: 4 } },
      { type: "openCheck", imageId: "a" },
      { type: "succeed", id: "b", now: 6, body: { result: result([row("silver-coin", "2")]), durationMs: 4 } },
    );
    expect(open.checking).toBe("a");
  });

  it("opens only on an image with rows, and closes when that image leaves", () => {
    const state = run(twoCharacters(), { type: "closeCheck" });
    expect(run(state, { type: "openCheck", imageId: "zzz" })).toBe(state);
    const open = run(state, { type: "openCheck", imageId: "b" });
    expect(open.checking).toBe("b");
    expect(run(open, { type: "remove", id: "b" }).checking).toBeNull();
    expect(checkSequence(state.queue.entries)).toEqual(["a", "b"]);
  });
});

describe("uploadStep", () => {
  it("is upload until an image has finished", () => {
    const empty = initialBatchState();
    expect(uploadStep(empty)).toBe("upload");
    const reading = run(
      empty,
      { type: "enqueue", now: 0, items: [{ id: "a", file: file("a.png"), previewUrl: null }] },
      { type: "start", id: "a", now: 1 },
    );
    expect(uploadStep(reading)).toBe("upload");
  });

  it("is check while rows wait, reads are in flight, or the dialog is open", () => {
    const state = twoCharacters();
    expect(uploadStep(state)).toBe("check");
    const checked = run(
      state,
      { type: "closeCheck" },
      { type: "toggleChecked", imageId: "a", rowId: "r1" },
      { type: "toggleChecked", imageId: "b", rowId: "r1" },
    );
    expect(uploadStep(checked)).toBe("confirm");
    expect(uploadStep(run(checked, { type: "openCheck", imageId: "a" }))).toBe("check");
    const more = run(checked, { type: "enqueue", now: 20, items: [{ id: "c", file: file("c.png"), previewUrl: null }] });
    expect(uploadStep(more)).toBe("check");
    // The filter narrows what has to be checked.
    const halfChecked = run(state, { type: "closeCheck" }, { type: "toggleChecked", imageId: "a", rowId: "r1" });
    expect(uploadStep(halfChecked)).toBe("check");
    expect(uploadStep(run(halfChecked, { type: "filterCharacter", character: "Leftaltar" }))).toBe("confirm");
  });

  it("confirms only at the confirm step with rows, and un-confirms on any change to the rows", () => {
    const state = twoCharacters();
    expect(canConfirm(state)).toBe(false);
    expect(run(state, { type: "confirm" })).toBe(state);
    const ready = run(
      state,
      { type: "closeCheck" },
      { type: "toggleChecked", imageId: "a", rowId: "r1" },
      { type: "toggleChecked", imageId: "b", rowId: "r1" },
    );
    expect(canConfirm(ready)).toBe(true);
    const confirmed = run(ready, { type: "confirm" });
    expect(confirmed.confirmed).toBe(true);
    expect(canConfirm(confirmed)).toBe(false);
    // Looking is fine; correcting is not.
    expect(run(confirmed, { type: "openCheck", imageId: "a" }, { type: "closeCheck" }).confirmed).toBe(true);
    expect(run(confirmed, { type: "filterCharacter", character: "Leftaltar" }).confirmed).toBe(true);
    expect(run(confirmed, { type: "setQuantity", imageId: "a", rowId: "r0", quantity: "113" }).confirmed).toBe(false);
    const unchecked = run(confirmed, { type: "toggleChecked", imageId: "a", rowId: "r0" });
    expect(unchecked.confirmed).toBe(false);
    expect(uploadStep(unchecked)).toBe("check");
    expect(run(confirmed, { type: "enqueue", now: 30, items: [{ id: "c", file: file("c.png"), previewUrl: null }] }).confirmed).toBe(false);
    expect(run(confirmed, { type: "remove", id: "b" }).confirmed).toBe(false);
    // Nothing to confirm without rows.
    const empty = run(
      initialBatchState(),
      { type: "enqueue", now: 0, items: [{ id: "a", file: file("a.png"), previewUrl: null }] },
      { type: "start", id: "a", now: 1 },
      { type: "succeed", id: "a", now: 5, body: { result: result([], false), durationMs: 4 } },
    );
    expect(uploadStep(empty)).toBe("confirm");
    expect(canConfirm(empty)).toBe(false);
  });
});
