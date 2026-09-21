import { describe, expect, it } from "vitest";
import type { ParsedRow } from "@/modules/extractor";
import { totalsByItem } from "./index";
import { characterBreakdown, combinedTotals } from "./summary";
import {
  activeRows,
  addRowDefaults,
  batchReviewCounts,
  correctedRows,
  createImageReview,
  deletedRows,
  initialReviewState,
  isReviewAction,
  lookReasons,
  needsLook,
  reconcileReviews,
  reviewCounts,
  reviewReducer,
  rowBox,
  rowLookReasons,
  rowQuantityText,
  type ReviewAction,
  type ReviewState,
} from "./review";

type ExtraFields = { box?: unknown; quantityText?: unknown };

function row(itemId: string, quantity: string, overrides: Partial<ParsedRow> & ExtraFields = {}): ParsedRow {
  return {
    itemId,
    iconDescription: "",
    quantity,
    gameTimestamp: "06.09.2026 - 23:21",
    character: "Leftaltar",
    direction: "deposit",
    confidence: 0.95,
    ...overrides,
  } as ParsedRow;
}

const IMAGE = "shot-1";

/** r0 safe gold · r1 ring fragment · r2 silver · r3 unknown · r4 low-confidence ruby. */
const ROWS: ParsedRow[] = [
  row("gold-ingot", "112"),
  row("fragment-ring-of-night", "3"),
  row("silver-coin", "50000000", { quantityText: "50,000,000" }),
  row("unknown", "7", { iconDescription: "a blue gem" }),
  row("ruby", "40", { confidence: 0.6, lowConfidenceReason: "Blurry overlay number." }),
];

function started(rows: ParsedRow[] = ROWS): ReviewState {
  return reviewReducer(initialReviewState, { type: "init", imageId: IMAGE, rows, token: 1 });
}

function run(state: ReviewState, ...actions: ReviewAction[]): ReviewState {
  return actions.reduce(reviewReducer, state);
}

function byId(state: ReviewState, rowId: string) {
  const found = state[IMAGE].rows.find((entry) => entry.id === rowId);
  if (!found) throw new Error(`no row ${rowId}`);
  return found;
}

describe("rowBox / rowQuantityText (tolerant accessors)", () => {
  it("reads a well-formed box", () => {
    expect(rowBox({ box: { top: 0.1, bottom: 0.2 } })).toEqual({ top: 0.1, bottom: 0.2 });
  });

  it("clamps a box that pokes outside the image", () => {
    expect(rowBox({ box: { top: -0.05, bottom: 1.2 } })).toEqual({ top: 0, bottom: 1 });
  });

  it("reads no box from anything else", () => {
    expect(rowBox({})).toBeNull();
    expect(rowBox({ box: null })).toBeNull();
    expect(rowBox({ box: "0.1-0.2" })).toBeNull();
    expect(rowBox({ box: { top: "0.1", bottom: "0.2" } })).toBeNull();
    expect(rowBox({ box: { top: 0.1 } })).toBeNull();
    expect(rowBox({ box: { top: Number.NaN, bottom: 0.5 } })).toBeNull();
    expect(rowBox({ box: { top: 0.4, bottom: 0.4 } })).toBeNull();
    expect(rowBox({ box: { top: 0.6, bottom: 0.2 } })).toBeNull();
    expect(rowBox({ box: { top: 2, bottom: 3 } })).toBeNull();
    expect(rowBox(null)).toBeNull();
    expect(rowBox(undefined)).toBeNull();
    expect(rowBox("row")).toBeNull();
  });

  it("reads quantityText only when it is a non-blank string", () => {
    expect(rowQuantityText({ quantityText: "500,000,000" })).toBe("500,000,000");
    expect(rowQuantityText({ quantityText: "  2000 " })).toBe("2000");
    expect(rowQuantityText({ quantityText: "" })).toBeNull();
    expect(rowQuantityText({ quantityText: "   " })).toBeNull();
    expect(rowQuantityText({ quantityText: 2000 })).toBeNull();
    expect(rowQuantityText({ quantityText: null })).toBeNull();
    expect(rowQuantityText({})).toBeNull();
    expect(rowQuantityText(null)).toBeNull();
  });

  it("carries both onto the review row, and works without them", () => {
    const review = createImageReview([
      row("gold-ingot", "112", { box: { top: 0.1, bottom: 0.2 }, quantityText: "112" }),
      row("gold-ingot", "112"),
      row("gold-ingot", "112", { box: { top: 1, bottom: 0 }, quantityText: 5 }),
    ]);
    expect(review.rows[0]).toMatchObject({ box: { top: 0.1, bottom: 0.2 }, quantityText: "112" });
    expect(review.rows[1]).toMatchObject({ box: null, quantityText: null, checked: true });
    expect(review.rows[2]).toMatchObject({ box: null, quantityText: null, checked: true });
  });
});

describe("lookReasons (the needs-a-look rule)", () => {
  it("lets a confident row of an ordinary material through", () => {
    expect(lookReasons({ itemId: "gold-ingot", quantity: "112", confidence: 0.95 })).toEqual([]);
    expect(needsLook({ itemId: "gold-ingot", quantity: "112", confidence: 0.85 })).toBe(false);
    expect(needsLook({ itemId: "nyxium", quantity: "1", confidence: 1, quantityText: null })).toBe(false);
  });

  it("flags confidence below 0.85", () => {
    expect(lookReasons({ itemId: "gold-ingot", quantity: "112", confidence: 0.849 })).toEqual(["low_confidence"]);
    expect(lookReasons({ itemId: "gold-ingot", quantity: "112", confidence: 0 })).toEqual(["low_confidence"]);
    expect(lookReasons({ itemId: "gold-ingot", quantity: "112", confidence: Number.NaN })).toEqual([
      "low_confidence",
    ]);
  });

  it("does not doubt a row a person added (no confidence)", () => {
    expect(lookReasons({ itemId: "gold-ingot", quantity: "112", confidence: null })).toEqual([]);
  });

  it("flags an unknown item, and an id that is not in the catalog", () => {
    expect(lookReasons({ itemId: "unknown", quantity: "7", confidence: 0.99 })).toEqual(["unknown_item"]);
    expect(lookReasons({ itemId: "dragon-scale", quantity: "7", confidence: 0.99 })).toEqual(["unknown_item"]);
  });

  it("flags each of the four blueprint fragments, however confident", () => {
    for (const itemId of [
      "fragment-ring-of-night",
      "fragment-pirates-earring",
      "fragment-necklace-of-starlight",
      "fragment-bracelet-of-faith",
    ]) {
      expect(lookReasons({ itemId, quantity: "3", confidence: 1 })).toEqual(["fragment"]);
    }
  });

  it("flags Silver Coin, however confident", () => {
    expect(lookReasons({ itemId: "silver-coin", quantity: "500000000", confidence: 1 })).toEqual(["silver"]);
    // Silver Ingot is a material, not the currency.
    expect(lookReasons({ itemId: "silver-ingot", quantity: "500", confidence: 1 })).toEqual([]);
  });

  it("flags a displayed amount whose grouping is malformed", () => {
    for (const quantityText of ["5,00,000", "500,000,00", "1,2345", "500.000", "500 000", ",500", "12a"]) {
      expect(lookReasons({ itemId: "gold-ingot", quantity: "500000", confidence: 1, quantityText })).toContain(
        "quantity_text",
      );
    }
  });

  it("flags a displayed amount that disagrees with the quantity", () => {
    expect(
      lookReasons({ itemId: "gold-ingot", quantity: "5000", confidence: 1, quantityText: "50,000" }),
    ).toEqual(["quantity_text"]);
    expect(lookReasons({ itemId: "gold-ingot", quantity: "20000", confidence: 1, quantityText: "2000" })).toEqual([
      "quantity_text",
    ]);
  });

  it("accepts a displayed amount that is grouped right, or not grouped at all", () => {
    expect(lookReasons({ itemId: "gold-ingot", quantity: "20000", confidence: 1, quantityText: "20,000" })).toEqual(
      [],
    );
    // Stack overlays print "2000", without separators.
    expect(lookReasons({ itemId: "gold-ingot", quantity: "2000", confidence: 1, quantityText: "2000" })).toEqual([]);
    expect(lookReasons({ itemId: "gold-ingot", quantity: "64", confidence: 1, quantityText: " 64 " })).toEqual([]);
    expect(lookReasons({ itemId: "gold-ingot", quantity: "1", confidence: 1, quantityText: "" })).toEqual([]);
  });

  it("reports every reason at once", () => {
    expect(
      lookReasons({ itemId: "silver-coin", quantity: "5000000", confidence: 0.4, quantityText: "5,00,0000" }),
    ).toEqual(["low_confidence", "silver", "quantity_text"]);
  });
});

describe("reviewReducer", () => {
  it("init: safe rows start auto-accepted, the rest unchecked", () => {
    const state = started();
    expect(state[IMAGE].token).toBe(1);
    expect(state[IMAGE].rows.map((entry) => [entry.id, entry.checked, entry.auto])).toEqual([
      ["r0", true, true],
      ["r1", false, false],
      ["r2", false, false],
      ["r3", false, false],
      ["r4", false, false],
    ]);
    expect(byId(state, "r0")).toMatchObject({
      original: { itemId: "gold-ingot", quantity: "112", gameTimestamp: "06.09.2026 - 23:21", character: "Leftaltar" },
      edited: false,
      added: false,
      deleted: false,
      confidence: 0.95,
    });
    expect(byId(state, "r0").current).toEqual(byId(state, "r0").original);
    expect(byId(state, "r3").iconDescription).toBe("a blue gem");
    expect(byId(state, "r4").lowConfidenceReason).toBe("Blurry overlay number.");
  });

  it("init again replaces the image's review", () => {
    const state = run(
      started(),
      { type: "deleteRow", imageId: IMAGE, rowId: "r0" },
      { type: "init", imageId: IMAGE, rows: [row("ruby", "5")], token: 2 },
    );
    expect(state[IMAGE].token).toBe(2);
    expect(state[IMAGE].rows).toHaveLength(1);
    expect(state[IMAGE].rows[0]).toMatchObject({ id: "r0", deleted: false });
  });

  it("setItem: corrects the item, marks the row edited and checked", () => {
    const state = run(started(), {
      type: "setItem",
      imageId: IMAGE,
      rowId: "r3",
      itemId: "fragment-pirates-earring",
    });
    const changed = byId(state, "r3");
    expect(changed.current.itemId).toBe("fragment-pirates-earring");
    expect(changed.original?.itemId).toBe("unknown");
    expect(changed).toMatchObject({ edited: true, checked: true, auto: false });
  });

  it("setItem back to the original clears `edited` but keeps the human check", () => {
    const state = run(
      started(),
      { type: "setItem", imageId: IMAGE, rowId: "r0", itemId: "copper-ingot" },
      { type: "setItem", imageId: IMAGE, rowId: "r0", itemId: "gold-ingot" },
    );
    expect(byId(state, "r0")).toMatchObject({ edited: false, checked: true, auto: false });
  });

  it("setItem to the same item changes nothing", () => {
    const before = started();
    expect(run(before, { type: "setItem", imageId: IMAGE, rowId: "r1", itemId: "fragment-ring-of-night" })).toBe(
      before,
    );
    expect(byId(before, "r1").checked).toBe(false);
  });

  it("setQuantity: corrects the quantity, marks the row edited and checked", () => {
    const state = run(started(), { type: "setQuantity", imageId: IMAGE, rowId: "r2", quantity: "500000000" });
    const changed = byId(state, "r2");
    expect(changed.current.quantity).toBe("500000000");
    expect(changed.original?.quantity).toBe("50000000");
    expect(changed).toMatchObject({ edited: true, checked: true, auto: false });
  });

  it("setQuantity: ignores anything that is not a positive integer digit string", () => {
    const before = started();
    for (const quantity of ["", "0", "-5", "1.5", "500,000", "012", "1e9"]) {
      expect(run(before, { type: "setQuantity", imageId: IMAGE, rowId: "r2", quantity })).toBe(before);
    }
  });

  it("setTimestamp / setCharacter: mark the row edited without checking it", () => {
    const state = run(
      started(),
      { type: "setTimestamp", imageId: IMAGE, rowId: "r1", gameTimestamp: " 06.09.2026 - 23:25 " },
      { type: "setCharacter", imageId: IMAGE, rowId: "r4", character: " xReacher " },
    );
    expect(byId(state, "r1").current.gameTimestamp).toBe("06.09.2026 - 23:25");
    expect(byId(state, "r1")).toMatchObject({ edited: true, checked: false });
    expect(byId(state, "r4").current.character).toBe("xReacher");
    expect(byId(state, "r4")).toMatchObject({ edited: true, checked: false });
  });

  it("toggleChecked: flips the check and makes it a human one", () => {
    let state = run(started(), { type: "toggleChecked", imageId: IMAGE, rowId: "r1" });
    expect(byId(state, "r1")).toMatchObject({ checked: true, auto: false });
    state = run(state, { type: "toggleChecked", imageId: IMAGE, rowId: "r1" });
    expect(byId(state, "r1")).toMatchObject({ checked: false, auto: false });
    state = run(state, { type: "toggleChecked", imageId: IMAGE, rowId: "r0" });
    expect(byId(state, "r0")).toMatchObject({ checked: false, auto: false });
  });

  it("checkAllSafe: confirms safe rows and leaves every row that needs a look alone", () => {
    const state = run(
      started(),
      { type: "toggleChecked", imageId: IMAGE, rowId: "r0" }, // a safe row a person unchecked
      { type: "checkAllSafe", imageId: IMAGE },
    );
    expect(state[IMAGE].rows.map((entry) => [entry.id, entry.checked, entry.auto])).toEqual([
      ["r0", true, false],
      ["r1", false, false],
      ["r2", false, false],
      ["r3", false, false],
      ["r4", false, false],
    ]);
  });

  it("checkAllSafe: turns automatic checks into human ones, then has nothing left to do", () => {
    const once = run(started(), { type: "checkAllSafe", imageId: IMAGE });
    expect(byId(once, "r0")).toMatchObject({ checked: true, auto: false });
    expect(run(once, { type: "checkAllSafe", imageId: IMAGE })).toBe(once);
  });

  it("checkAllSafe: judges a row on its corrected item, and skips deleted rows", () => {
    const state = run(
      started([row("gold-ingot", "10"), row("gold-ingot", "20"), row("gold-ingot", "30")]),
      { type: "setItem", imageId: IMAGE, rowId: "r0", itemId: "fragment-bracelet-of-faith" },
      { type: "toggleChecked", imageId: IMAGE, rowId: "r0" }, // unchecked again
      { type: "toggleChecked", imageId: IMAGE, rowId: "r1" },
      { type: "deleteRow", imageId: IMAGE, rowId: "r1" },
      { type: "checkAllSafe", imageId: IMAGE },
    );
    expect(byId(state, "r0").checked).toBe(false); // now a fragment: tap it yourself
    expect(byId(state, "r1").checked).toBe(false); // deleted: untouched
    expect(byId(state, "r2")).toMatchObject({ checked: true, auto: false });
  });

  it("deleteRow / restoreRow: a deleted row keeps its values and comes back as it was", () => {
    let state = run(
      started(),
      { type: "setQuantity", imageId: IMAGE, rowId: "r0", quantity: "120" },
      { type: "deleteRow", imageId: IMAGE, rowId: "r0" },
    );
    expect(byId(state, "r0")).toMatchObject({ deleted: true, edited: true });
    expect(activeRows(state[IMAGE]).map((entry) => entry.id)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(deletedRows(state[IMAGE]).map((entry) => entry.id)).toEqual(["r0"]);
    // A deleted row cannot be toggled.
    expect(run(state, { type: "toggleChecked", imageId: IMAGE, rowId: "r0" })).toBe(state);

    state = run(state, { type: "restoreRow", imageId: IMAGE, rowId: "r0" });
    expect(byId(state, "r0")).toMatchObject({ deleted: false, edited: true, checked: true });
    expect(byId(state, "r0").current.quantity).toBe("120");
    expect(activeRows(state[IMAGE]).map((entry) => entry.id)).toEqual(["r0", "r1", "r2", "r3", "r4"]);
  });

  it("addRow: appends a checked, human-made row with its own id", () => {
    const values = { itemId: "ruby", quantity: "25", gameTimestamp: " 06.09.2026 - 23:30 ", character: " Leftaltar " };
    const state = run(
      started(),
      { type: "addRow", imageId: IMAGE, values },
      { type: "addRow", imageId: IMAGE, values: { ...values, itemId: "nyxium", quantity: "1" } },
    );
    expect(state[IMAGE].rows.map((entry) => entry.id)).toEqual(["r0", "r1", "r2", "r3", "r4", "a1", "a2"]);
    expect(byId(state, "a1")).toMatchObject({
      original: null,
      current: { itemId: "ruby", quantity: "25", gameTimestamp: "06.09.2026 - 23:30", character: "Leftaltar" },
      confidence: null,
      box: null,
      checked: true,
      auto: false,
      edited: false,
      added: true,
      deleted: false,
    });
  });

  it("addRow: refuses a quantity that is not a positive integer, and never reuses an id", () => {
    const before = started();
    const bad = { itemId: "ruby", quantity: "0", gameTimestamp: "", character: "" };
    expect(run(before, { type: "addRow", imageId: IMAGE, values: bad })).toBe(before);

    const good = { ...bad, quantity: "5" };
    const state = run(
      before,
      { type: "addRow", imageId: IMAGE, values: good },
      { type: "reset", imageId: IMAGE, rowId: "a1" },
      { type: "addRow", imageId: IMAGE, values: good },
    );
    expect(state[IMAGE].rows.map((entry) => entry.id)).toEqual(["r0", "r1", "r2", "r3", "r4", "a2"]);
  });

  it("an added row stays editable and never counts as edited", () => {
    const state = run(
      started(),
      { type: "addRow", imageId: IMAGE, values: { itemId: "ruby", quantity: "25", gameTimestamp: "", character: "" } },
      { type: "setQuantity", imageId: IMAGE, rowId: "a1", quantity: "26" },
    );
    expect(byId(state, "a1")).toMatchObject({ edited: false, added: true });
    expect(byId(state, "a1").current.quantity).toBe("26");
  });

  it("reset (one row): back to what was extracted, check included", () => {
    const state = run(
      started(),
      { type: "setItem", imageId: IMAGE, rowId: "r1", itemId: "fragment-pirates-earring" },
      { type: "setQuantity", imageId: IMAGE, rowId: "r0", quantity: "999" },
      { type: "reset", imageId: IMAGE, rowId: "r1" },
    );
    expect(byId(state, "r1")).toMatchObject({ edited: false, checked: false, auto: false });
    expect(byId(state, "r1").current.itemId).toBe("fragment-ring-of-night");
    expect(byId(state, "r0").current.quantity).toBe("999"); // other rows untouched
  });

  it("reset (whole image): drops added rows, restores deleted ones, forgets every edit", () => {
    const state = run(
      started(),
      { type: "setQuantity", imageId: IMAGE, rowId: "r0", quantity: "999" },
      { type: "toggleChecked", imageId: IMAGE, rowId: "r1" },
      { type: "deleteRow", imageId: IMAGE, rowId: "r2" },
      { type: "addRow", imageId: IMAGE, values: { itemId: "ruby", quantity: "25", gameTimestamp: "", character: "" } },
      { type: "reset", imageId: IMAGE },
    );
    expect(state[IMAGE].rows).toEqual(started()[IMAGE].rows);
  });

  it("drop: forgets an image", () => {
    const state = run(started(), { type: "drop", imageId: IMAGE });
    expect(state).toEqual({});
    expect(run(state, { type: "drop", imageId: IMAGE })).toBe(state);
  });

  it("ignores actions for an image or a row it does not know", () => {
    const before = started();
    expect(run(before, { type: "toggleChecked", imageId: "nope", rowId: "r0" })).toBe(before);
    expect(run(before, { type: "toggleChecked", imageId: IMAGE, rowId: "r99" })).toBe(before);
    expect(run(before, { type: "checkAllSafe", imageId: "nope" })).toBe(before);
    expect(run(before, { type: "deleteRow", imageId: "nope", rowId: "r0" })).toBe(before);
    expect(
      run(before, {
        type: "addRow",
        imageId: "nope",
        values: { itemId: "ruby", quantity: "1", gameTimestamp: "", character: "" },
      }),
    ).toBe(before);
    expect(run(before, { type: "reset", imageId: "nope" })).toBe(before);
  });

  it("never mutates the state it was given", () => {
    const before = started();
    const snapshot = structuredClone(before);
    run(
      before,
      { type: "setItem", imageId: IMAGE, rowId: "r0", itemId: "ruby" },
      { type: "deleteRow", imageId: IMAGE, rowId: "r1" },
      { type: "addRow", imageId: IMAGE, values: { itemId: "ruby", quantity: "1", gameTimestamp: "", character: "" } },
      { type: "checkAllSafe", imageId: IMAGE },
    );
    expect(before).toEqual(snapshot);
  });

  it("isReviewAction tells review actions from queue actions", () => {
    expect(isReviewAction({ type: "toggleChecked" })).toBe(true);
    expect(isReviewAction({ type: "reset" })).toBe(true);
    expect(isReviewAction({ type: "clear" })).toBe(false);
    expect(isReviewAction({ type: "remove" })).toBe(false);
  });
});

describe("rowLookReasons", () => {
  it("follows the corrected item", () => {
    const state = run(started(), { type: "setItem", imageId: IMAGE, rowId: "r3", itemId: "gold-ingot" });
    expect(rowLookReasons(byId(started(), "r3"))).toEqual(["unknown_item"]);
    expect(rowLookReasons(byId(state, "r3"))).toEqual([]);
  });

  it("drops the displayed-amount doubt once a person typed the quantity", () => {
    const before = started([row("gold-ingot", "5000", { quantityText: "50,000" })]);
    expect(rowLookReasons(byId(before, "r0"))).toEqual(["quantity_text"]);
    const after = run(before, { type: "setQuantity", imageId: IMAGE, rowId: "r0", quantity: "50000" });
    expect(rowLookReasons(byId(after, "r0"))).toEqual([]);
  });
});

describe("totals, counts and exports read the corrected rows", () => {
  const corrected = run(
    started(),
    { type: "setQuantity", imageId: IMAGE, rowId: "r2", quantity: "500000000" }, // silver: 50m -> 500m
    { type: "setItem", imageId: IMAGE, rowId: "r3", itemId: "gold-ingot" }, // unknown -> gold
    { type: "setCharacter", imageId: IMAGE, rowId: "r3", character: "xReacher" },
    { type: "deleteRow", imageId: IMAGE, rowId: "r4" }, // ruby: gone
    { type: "addRow", imageId: IMAGE, values: { itemId: "nyxium", quantity: "2", gameTimestamp: "", character: "xReacher" } },
  );

  it("correctedRows: current values, deleted rows out, added rows in", () => {
    expect(correctedRows(corrected[IMAGE]).map((entry) => [entry.itemId, entry.quantity])).toEqual([
      ["gold-ingot", "112"],
      ["fragment-ring-of-night", "3"],
      ["silver-coin", "500000000"],
      ["gold-ingot", "7"],
      ["nyxium", "2"],
    ]);
    expect(correctedRows(undefined)).toEqual([]);
  });

  it("per-item totals use the corrected values and exclude deleted rows", () => {
    const totals = totalsByItem(correctedRows(corrected[IMAGE]));
    expect(totals).toEqual([
      { itemId: "gold-ingot", total: 119n, rows: 2 },
      { itemId: "fragment-ring-of-night", total: 3n, rows: 1 },
      { itemId: "silver-coin", total: 500000000n, rows: 1 },
      { itemId: "nyxium", total: 2n, rows: 1 },
    ]);
    // Nothing of the uncorrected read is left: no "unknown" bucket, no ruby, no 50m silver.
    expect(totals.some((total) => total.itemId === "unknown" || total.itemId === "ruby")).toBe(false);
  });

  it("the summary strip's combined totals and per-character counts take corrected rows", () => {
    const image = { looksLikeBankLog: true, rows: correctedRows(corrected[IMAGE]) };
    expect(combinedTotals([image], ["nyxium", "gold-ingot", "silver-coin"]).map((total) => total.itemId)).toEqual([
      "nyxium",
      "gold-ingot",
      "silver-coin",
      "fragment-ring-of-night",
    ]);
    expect(characterBreakdown([image])).toEqual([
      { character: "Leftaltar", rows: 3, images: 1 },
      { character: "xReacher", rows: 2, images: 1 },
    ]);
  });

  it("reviewCounts: rows, to check, edited, added, deleted, acceptable", () => {
    expect(reviewCounts(started()[IMAGE])).toEqual({
      rows: 5,
      toCheck: 4,
      edited: 0,
      added: 0,
      deleted: 0,
      acceptable: 1,
    });
    expect(reviewCounts(corrected[IMAGE])).toEqual({
      rows: 5,
      toCheck: 1, // only the ring fragment is left
      edited: 2,
      added: 1,
      deleted: 1,
      acceptable: 1, // r0 is still only auto-accepted
    });
    expect(reviewCounts(undefined)).toEqual({ rows: 0, toCheck: 0, edited: 0, added: 0, deleted: 0, acceptable: 0 });
  });

  it("batchReviewCounts: sums images", () => {
    expect(batchReviewCounts([started()[IMAGE], corrected[IMAGE], undefined])).toMatchObject({
      rows: 10,
      toCheck: 5,
      deleted: 1,
    });
  });

  it("addRowDefaults: timestamp and character of the last row that counts", () => {
    expect(addRowDefaults(started()[IMAGE])).toEqual({
      gameTimestamp: "06.09.2026 - 23:21",
      character: "Leftaltar",
    });
    expect(addRowDefaults(corrected[IMAGE])).toEqual({ gameTimestamp: "", character: "xReacher" });
    expect(addRowDefaults(undefined)).toEqual({ gameTimestamp: "", character: "" });
  });
});

describe("reconcileReviews", () => {
  it("starts a review for a new read and keeps the others untouched", () => {
    const first = reconcileReviews(initialReviewState, [{ imageId: "a", token: 10, rows: ROWS }]);
    const edited = reviewReducer(first, { type: "toggleChecked", imageId: "a", rowId: "r1" });
    const second = reconcileReviews(edited, [
      { imageId: "a", token: 10, rows: ROWS },
      { imageId: "b", token: 20, rows: [row("ruby", "5")] },
    ]);
    expect(second.a).toBe(edited.a);
    expect(second.b.rows).toHaveLength(1);
  });

  it("returns the same state when nothing changed", () => {
    const state = reconcileReviews(initialReviewState, [{ imageId: "a", token: 10, rows: ROWS }]);
    expect(reconcileReviews(state, [{ imageId: "a", token: 10, rows: ROWS }])).toBe(state);
    expect(reconcileReviews(initialReviewState, [])).toBe(initialReviewState);
  });

  it("starts over when the image was read again", () => {
    const first = reconcileReviews(initialReviewState, [{ imageId: "a", token: 10, rows: ROWS }]);
    const edited = reviewReducer(first, { type: "deleteRow", imageId: "a", rowId: "r0" });
    const again = reconcileReviews(edited, [{ imageId: "a", token: 11, rows: ROWS }]);
    expect(again.a.token).toBe(11);
    expect(again.a.rows[0].deleted).toBe(false);
  });

  it("forgets images that left the batch", () => {
    const state = reconcileReviews(initialReviewState, [
      { imageId: "a", token: 10, rows: ROWS },
      { imageId: "b", token: 20, rows: ROWS },
    ]);
    expect(Object.keys(reconcileReviews(state, [{ imageId: "b", token: 20, rows: ROWS }]))).toEqual(["b"]);
    expect(reconcileReviews(state, [])).toEqual({});
  });
});
