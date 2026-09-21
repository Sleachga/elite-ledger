/**
 * Manual upload mode, end to end through the pure modules: the queue never
 * offers a manual entry for reading, the batch gives it a review to add rows
 * to, and totals / exports / the summary read those rows like any others.
 */
import { describe, expect, it } from "vitest";
import type { ExtractionResult, ParsedRow } from "@/modules/extractor";
import { MAX_IMAGE_BYTES } from "./index";
import {
  batchReducer,
  holdsRows,
  initialBatchState,
  isReviewable,
  knownCharacters,
  reviewedImages,
  type BatchAction,
  type BatchState,
} from "./batch";
import { buildFixture, buildTsv } from "./export";
import {
  BLANK_ENTRY_NAME,
  MAX_BATCH_IMAGES,
  autoSelectId,
  blankEntryId,
  canGoManual,
  canRetryEntry,
  hasRetryableFailures,
  imageEntries,
  interpretResponse,
  isManualEntry,
  isRetryableKind,
  pickStartable,
  readingIds,
  type NewEntry,
  type QueueFile,
} from "./queue";
import { addRowDefaults, batchReviewCounts, reviewCounts, type RowValues } from "./review";
import { characterBreakdown, combinedTotals, summarize } from "./summary";

function file(name: string, overrides: Partial<QueueFile> = {}): QueueFile {
  return { name, size: 1000, type: "image/png", lastModified: 1_700_000_000_000, ...overrides };
}

function item(id: string, overrides: Partial<QueueFile> = {}): NewEntry {
  return { id, file: file(`${id}.png`, overrides), previewUrl: `blob:${id}` };
}

const BLANK: NewEntry = { id: "blank", file: file(BLANK_ENTRY_NAME, { size: 0, type: "" }), previewUrl: null };

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

function result(rows: ParsedRow[]): ExtractionResult {
  return {
    looksLikeBankLog: true,
    rows,
    characters: rows.map((entry) => entry.character),
    warnings: [],
    model: "claude-opus-5",
    usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  };
}

function values(itemId: string, quantity: string, character = "Leftaltar", gameTimestamp = "07.09.2026 - 18:02"): RowValues {
  return { itemId, quantity, gameTimestamp, character };
}

function run(state: BatchState, ...actions: BatchAction[]): BatchState {
  return actions.reduce(batchReducer, state);
}

function states(state: BatchState): Record<string, string> {
  return Object.fromEntries(state.queue.entries.map((entry) => [entry.id, entry.state]));
}

describe("manual enqueue", () => {
  const state = run(initialBatchState(), { type: "enqueue", mode: "manual", now: 7, items: [item("a"), item("b")] });

  it("makes every image a ready manual entry, at once", () => {
    expect(states(state)).toEqual({ a: "ready", b: "ready" });
    expect(state.queue.entries[0]).toEqual({
      id: "a",
      file: file("a.png"),
      previewUrl: "blob:a",
      state: "ready",
      kind: "manual",
      finishedAt: 7,
    });
    expect(state.queue.entries.every(isManualEntry)).toBe(true);
  });

  it("never produces a start selection, whatever the concurrency and whatever happens next", () => {
    expect(pickStartable(state.queue)).toEqual([]);
    expect(pickStartable(state.queue, 99)).toEqual([]);
    expect(readingIds(state.queue)).toEqual([]);

    // Nothing the page can dispatch brings a manual entry into the line.
    const poked = run(
      state,
      { type: "start", id: "a", now: 8 },
      { type: "retry", id: "a" },
      { type: "retryFailed" },
      { type: "cancel", id: "a" },
      { type: "resume" },
      { type: "succeed", id: "a", now: 9, body: { result: result([row("ruby", "1")]), durationMs: 1 } },
      { type: "fail", id: "a", now: 9, error: { kind: "api", retryable: true } },
      { type: "unauthorized", id: "a" },
    );
    expect(states(poked)).toEqual({ a: "ready", b: "ready" });
    expect(poked.queue.entries[0].body).toBeUndefined();
    expect(pickStartable({ ...poked.queue, paused: false }, 99)).toEqual([]);
    expect(canRetryEntry(poked.queue.entries[0])).toBe(false);
    expect(hasRetryableFailures(poked.queue)).toBe(false);
  });

  it("opens a review with zero rows for each entry", () => {
    expect(Object.keys(state.review)).toEqual(["a", "b"]);
    expect(state.review.a).toEqual({ token: 7, rows: [], addedCount: 0 });
    expect(state.queue.entries.every(isReviewable)).toBe(true);
    expect(state.queue.entries.every(holdsRows)).toBe(true);
  });

  it("selects the first manual entry by itself, on phones too", () => {
    expect(autoSelectId(state.queue.entries, false)).toBe("a");
  });

  it("applies the same file rules: a bad file is a failed line, the rest go on", () => {
    const mixed = run(initialBatchState(), {
      type: "enqueue",
      mode: "manual",
      now: 1,
      items: [item("gif", { type: "image/gif" }), item("huge", { size: MAX_IMAGE_BYTES + 1 }), item("ok")],
    });
    expect(states(mixed)).toEqual({ gif: "failed", huge: "failed", ok: "ready" });
    expect(mixed.queue.entries[0].error).toEqual({ kind: "bad_request", retryable: false });
    expect(Object.keys(mixed.review)).toEqual(["ok"]);
    expect(pickStartable(mixed.queue, 99)).toEqual([]);
  });

  it("holds the batch cap", () => {
    const many = Array.from({ length: MAX_BATCH_IMAGES + 3 }, (_, index) => item(`m${index}`));
    const full = run(initialBatchState(), { type: "enqueue", mode: "manual", now: 1, items: many });
    expect(full.queue.entries).toHaveLength(MAX_BATCH_IMAGES);
  });
});

describe("mode switching mid-batch", () => {
  it("keeps existing entries as they are; the mode only decides what new images become", () => {
    let state = run(
      initialBatchState(),
      { type: "enqueue", now: 1, items: [item("ai1"), item("ai2")] },
      { type: "start", id: "ai1", now: 2 },
      { type: "succeed", id: "ai1", now: 5, body: { result: result([row("gold-ingot", "112")]), durationMs: 3 } },
    );
    // The member flips to Manual and adds an image...
    state = run(state, { type: "enqueue", mode: "manual", now: 6, items: [item("m1")] });
    expect(states(state)).toEqual({ ai1: "done", ai2: "queued", m1: "ready" });
    expect(state.queue.entries.map(isManualEntry)).toEqual([false, false, true]);
    // ...the waiting AI read still runs, the manual entry never does.
    expect(pickStartable(state.queue).map((entry) => entry.id)).toEqual(["ai2"]);
    expect(state.review.ai1.rows).toHaveLength(1);

    // Back to AI: the next image joins the line; the manual entry and its rows stay.
    state = run(
      state,
      { type: "addRow", imageId: "m1", values: values("ruby", "40") },
      { type: "enqueue", mode: "ai", now: 8, items: [item("ai3")] },
    );
    expect(states(state)).toEqual({ ai1: "done", ai2: "queued", m1: "ready", ai3: "queued" });
    expect(state.review.m1.rows).toHaveLength(1);
    expect(pickStartable(state.queue, 99).map((entry) => entry.id)).toEqual(["ai2", "ai3"]);
  });

  it("no mode means AI, as before", () => {
    const state = run(initialBatchState(), { type: "enqueue", now: 1, items: [item("a")] });
    expect(state.queue.entries[0]).toEqual({ id: "a", file: file("a.png"), previewUrl: "blob:a", state: "queued" });
  });
});

describe("the entry without a screenshot", () => {
  it("is a single ready entry named \"Manual entry\" with no preview", () => {
    const state = run(initialBatchState(), { type: "addBlank", item: { ...BLANK, previewUrl: "blob:ignored" }, now: 3 });
    expect(state.queue.entries).toEqual([
      { id: "blank", file: BLANK.file, previewUrl: null, state: "ready", kind: "manual", blank: true, finishedAt: 3 },
    ]);
    expect(state.queue.entries[0].file.name).toBe("Manual entry");
    expect(state.review.blank).toEqual({ token: 3, rows: [], addedCount: 0 });
    expect(blankEntryId(state.queue.entries)).toBe("blank");
    expect(pickStartable(state.queue, 99)).toEqual([]);
  });

  it("is added once: a second one changes nothing", () => {
    const once = run(initialBatchState(), { type: "addBlank", item: BLANK, now: 3 });
    const twice = run(once, { type: "addBlank", item: { ...BLANK, id: "blank-2" }, now: 4 });
    expect(twice).toBe(once);
  });

  it("does not count toward the image cap, and comes back after being removed", () => {
    const many = Array.from({ length: MAX_BATCH_IMAGES }, (_, index) => item(`m${index}`));
    let state = run(
      initialBatchState(),
      { type: "addBlank", item: BLANK, now: 1 },
      { type: "enqueue", mode: "manual", now: 2, items: many },
    );
    expect(state.queue.entries).toHaveLength(MAX_BATCH_IMAGES + 1);
    expect(imageEntries(state.queue.entries)).toHaveLength(MAX_BATCH_IMAGES);

    // Full of images: the blank entry can still be added.
    state = run(state, { type: "remove", id: "blank" });
    expect(blankEntryId(state.queue.entries)).toBeNull();
    expect(state.review.blank).toBeUndefined();
    state = run(state, { type: "addBlank", item: BLANK, now: 9 });
    expect(blankEntryId(state.queue.entries)).toBe("blank");
  });
});

describe("rows typed by hand", () => {
  function typed(): BatchState {
    return run(
      initialBatchState(),
      { type: "enqueue", mode: "manual", now: 1, items: [item("shot")] },
      { type: "addBlank", item: BLANK, now: 2 },
      { type: "addRow", imageId: "shot", values: values("gold-ingot", "112") },
      { type: "addRow", imageId: "shot", values: values("silver-coin", "500000000") },
      { type: "addRow", imageId: "shot", values: values("ring-fragment", "3", "Rightaltar") },
      { type: "addRow", imageId: "blank", values: values("gold-ingot", "8") },
    );
  }

  it("are created checked and added, even the kinds an AI read always flags", () => {
    const { rows } = typed().review.shot;
    expect(rows.map((entry) => entry.id)).toEqual(["a1", "a2", "a3"]);
    for (const entry of rows) {
      expect(entry).toMatchObject({ checked: true, auto: false, added: true, edited: false, original: null });
    }
    expect(reviewCounts(typed().review.shot)).toMatchObject({ rows: 3, toCheck: 0, added: 3 });
  });

  it("prefill the next row from the one before", () => {
    expect(addRowDefaults(typed().review.shot)).toEqual({ gameTimestamp: "07.09.2026 - 18:02", character: "Rightaltar" });
    expect(addRowDefaults(initialBatchState().review.nothing)).toEqual({ gameTimestamp: "", character: "" });
  });

  it("refuse a quantity that is not a positive whole number", () => {
    const before = typed();
    for (const quantity of ["", "0", "-5", "1.5", "12a", "1,000"]) {
      expect(run(before, { type: "addRow", imageId: "shot", values: values("ruby", quantity) })).toBe(before);
    }
  });

  it("add up in the totals, the per-character counts and the summary", () => {
    const state = typed();
    const images = reviewedImages(state.queue.entries, state.review);
    expect(images.map((image) => [image.fileName, image.looksLikeBankLog, image.rows.length])).toEqual([
      ["shot.png", true, 3],
      ["Manual entry", true, 1],
    ]);
    expect(combinedTotals(images, ["ring-fragment", "gold-ingot", "silver-coin"])).toEqual([
      { itemId: "ring-fragment", total: 3n, rows: 1 },
      { itemId: "gold-ingot", total: 120n, rows: 2 },
      { itemId: "silver-coin", total: 500000000n, rows: 1 },
    ]);
    expect(characterBreakdown(images)).toEqual([
      { character: "Leftaltar", rows: 3, images: 2 },
      { character: "Rightaltar", rows: 1, images: 1 },
    ]);
    expect(batchReviewCounts(images.map((image) => state.review[image.imageId]))).toMatchObject({
      rows: 4,
      toCheck: 0,
      added: 4,
    });
    expect(summarize(state.queue.entries)).toMatchObject({ total: 2, ready: 2, done: 0, settled: 2, queued: 0, durationMs: 0 });
    expect(knownCharacters(state.queue.entries, state.review)).toEqual(["Leftaltar", "Rightaltar"]);
  });

  it("follow edits and deletes like any reviewed row", () => {
    const state = run(
      typed(),
      { type: "setQuantity", imageId: "shot", rowId: "a1", quantity: "200" },
      { type: "deleteRow", imageId: "shot", rowId: "a2" },
    );
    const images = reviewedImages(state.queue.entries, state.review);
    expect(combinedTotals(images, [])).toEqual([
      { itemId: "gold-ingot", total: 208n, rows: 2 },
      { itemId: "ring-fragment", total: 3n, rows: 1 },
    ]);
  });

  it("export as TSV and as a fixture exactly like corrected AI rows", () => {
    const state = typed();
    const images = reviewedImages(state.queue.entries, state.review);
    expect(buildTsv(images).split("\n")).toEqual([
      "Game time\tCharacter\tItem\tQuantity\tImage",
      "07.09.2026 - 18:02\tLeftaltar\tGold Ingot\t112\tshot.png",
      "07.09.2026 - 18:02\tLeftaltar\tSilver Coin\t500000000\tshot.png",
      expect.stringMatching(/^07\.09\.2026 - 18:02\tRightaltar\t.+\t3\tshot\.png$/),
      "07.09.2026 - 18:02\tLeftaltar\tGold Ingot\t8\tManual entry",
    ]);
    expect(buildFixture(true, images[1].rows)).toEqual({
      looksLikeBankLog: true,
      rows: [{ itemId: "gold-ingot", quantity: "8", gameTimestamp: "07.09.2026 - 18:02", character: "Leftaltar" }],
    });
  });

  it("sit beside AI rows in one batch", () => {
    const state = run(
      typed(),
      { type: "enqueue", now: 10, items: [item("ai")] },
      { type: "start", id: "ai", now: 11 },
      { type: "succeed", id: "ai", now: 15, body: { result: result([row("gold-ingot", "1000", "Thirdaltar")]), durationMs: 4000 } },
    );
    const images = reviewedImages(state.queue.entries, state.review);
    expect(combinedTotals(images, ["gold-ingot"])[0]).toEqual({ itemId: "gold-ingot", total: 1120n, rows: 3 });
    expect(summarize(state.queue.entries)).toMatchObject({ total: 3, ready: 2, done: 1, settled: 3, durationMs: 4000 });
    // Adding rows never restarts a manual review (its token does not move).
    expect(state.review.shot.rows).toHaveLength(3);
  });

  it("go when their entry is removed or the batch is cleared", () => {
    expect(run(typed(), { type: "remove", id: "shot" }).review.shot).toBeUndefined();
    expect(run(typed(), { type: "clear" }).review).toEqual({});
  });
});

describe("handing entries over to the member (toManual)", () => {
  function pending(): BatchState {
    return run(
      initialBatchState(),
      { type: "enqueue", now: 1, items: [item("done"), item("reading"), item("queued"), item("failed"), item("gif", { type: "image/gif" })] },
      { type: "start", id: "done", now: 2 },
      { type: "succeed", id: "done", now: 3, body: { result: result([row("ruby", "1")]), durationMs: 1 } },
      { type: "start", id: "failed", now: 2 },
      { type: "fail", id: "failed", now: 3, error: { kind: "refusal", retryable: true } },
      { type: "start", id: "reading", now: 4 },
    );
  }

  it("without an id: everything waiting or in flight goes manual; results and failures stay", () => {
    const state = run(pending(), { type: "toManual", now: 20 });
    expect(states(state)).toEqual({ done: "done", reading: "ready", queued: "ready", failed: "failed", gif: "failed" });
    expect(pickStartable(state.queue, 99)).toEqual([]);
    expect(state.review.reading).toEqual({ token: 20, rows: [], addedCount: 0 });
    expect(state.review.done.rows).toHaveLength(1);

    // The answer of the read that was in flight arrives late: dropped.
    const late = run(state, { type: "fail", id: "reading", now: 21, error: { kind: "ai_disabled", retryable: false } });
    expect(late).toBe(state);
  });

  it("with an id: one entry without a result, if its file is acceptable", () => {
    const before = pending();
    expect(before.queue.entries.map(canGoManual)).toEqual([false, true, true, true, false]);

    const state = run(before, { type: "toManual", id: "failed", now: 30 });
    expect(states(state).failed).toBe("ready");
    expect(state.queue.entries.find((entry) => entry.id === "failed")).toMatchObject({ kind: "manual", finishedAt: 30 });
    expect(state.queue.entries.find((entry) => entry.id === "failed")?.error).toBeUndefined();

    expect(run(before, { type: "toManual", id: "done", now: 30 })).toBe(before);
    expect(run(before, { type: "toManual", id: "gif", now: 30 })).toBe(before);
    expect(run(before, { type: "toManual", id: "nope", now: 30 })).toBe(before);
  });

  it("changes nothing when nothing is pending", () => {
    const state = run(initialBatchState(), { type: "enqueue", mode: "manual", now: 1, items: [item("a")] });
    expect(run(state, { type: "toManual", now: 2 })).toBe(state);
  });
});

describe("the ai_disabled answer", () => {
  it("is its own outcome, so the page can go manual instead of failing the image", () => {
    const body = { error: { kind: "ai_disabled", message: "AI reading of screenshots is switched off by an admin." } };
    expect(interpretResponse(403, body, null, 0)).toEqual({ type: "ai_disabled" });
  });

  it("is not worth retrying", () => {
    expect(isRetryableKind("ai_disabled")).toBe(false);
  });

  it("a bare 403 from the host is still an ordinary failure", () => {
    expect(interpretResponse(403, null, null, 0)).toMatchObject({ type: "failure", error: { kind: "api" } });
  });
});
