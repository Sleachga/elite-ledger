import { describe, expect, it } from "vitest";
import { catalog } from "@/catalog";
import {
  ALWAYS_CHECKED_CONFIDENCE,
  FRAGMENT_REASON,
  MONEY_REASON,
  checkAmount,
  normalizeBox,
  normalizeOutput,
  sortByBox,
} from "./normalize";
import { modelOutputSchema, type ModelRow } from "./schema";

function modelRow(overrides: Partial<ModelRow> = {}): ModelRow {
  return {
    itemId: "gold-ingot",
    iconDescription: "A stack of yellow metal bars with a grey border.",
    quantity: "112",
    gameTimestamp: "06.09.2026 - 23:21",
    character: "Leftaltar",
    direction: "deposit",
    confidence: 0.95,
    lowConfidenceReason: "",
    ...overrides,
  };
}

function normalize(rows: ModelRow[]) {
  return normalizeOutput({ looksLikeBankLog: true, rows, notes: [] }, catalog).rows;
}

describe("checkAmount: the thousands grouping of the printed amount", () => {
  it.each([
    ["500,000,000", "500000000", "500000000"],
    ["10,000,000,000", "10000000000", "10000000000"],
    ["1.250.000", "1250000", "1250000"],
    ["75 500 000", "75500000", "75500000"],
    ["5,000", "5,000", "5000"], // separators in both readings are fine
    ["1000", "1000", "1000"],
    ["", "", "1"],
    ["", null, "1"],
  ])("accepts %j with quantity %j", (quantityText, quantity, value) => {
    expect(checkAmount(quantityText, quantity)).toEqual({ value });
  });

  it("falls back to quantity alone when an older answer has no quantityText", () => {
    expect(checkAmount(undefined, "500,000,000")).toEqual({ value: "500000000" });
    expect(checkAmount(null, "")).toEqual({ value: "1" });
    expect(checkAmount(undefined, "1.2k")).toEqual({ value: "1", issue: "unreadable" });
  });

  it.each([
    "50,000,00", // a digit dropped from the last group
    "5000,000", // a separator dropped
    "1,2500,000", // a digit doubled
    "12,50",
    ",500",
    "500,",
    "x12",
  ])("calls %j malformed and keeps the digit reading", (quantityText) => {
    expect(checkAmount(quantityText, "5000000")).toEqual({ value: "5000000", issue: "malformed" });
  });

  it("keeps the printed amount when both readings are well-formed but differ", () => {
    // The digit reading lost a group; the verbatim copy has all four.
    expect(checkAmount("10,000,000,000", "10000000")).toEqual({
      value: "10000000000",
      issue: "mismatch",
    });
    expect(checkAmount("37", "31")).toEqual({ value: "37", issue: "mismatch" });
    expect(checkAmount("250", "2.5k")).toEqual({ value: "250", issue: "mismatch" });
  });

  it("keeps a real number over an empty printed form, but still reports the disagreement", () => {
    expect(checkAmount("", "500")).toEqual({ value: "500", issue: "mismatch" });
  });

  it("gives up when neither reading is a positive integer", () => {
    expect(checkAmount("1.2k", "1.2k")).toEqual({ value: "1", issue: "unreadable" });
    expect(checkAmount("0", "0")).toEqual({ value: "1", issue: "unreadable" });
  });
});

describe("normalizeBox", () => {
  it("keeps a sane box and clamps it into the image", () => {
    expect(normalizeBox({ top: 0.25, bottom: 0.5 })).toEqual({ top: 0.25, bottom: 0.5 });
    expect(normalizeBox({ top: -0.02, bottom: 0.1 })).toEqual({ top: 0, bottom: 0.1 });
    expect(normalizeBox({ top: 0.93, bottom: 1.04 })).toEqual({ top: 0.93, bottom: 1 });
  });

  it.each<[unknown, string]>([
    [{ top: 0.5, bottom: 0.5 }, "empty"],
    [{ top: 0.6, bottom: 0.4 }, "upside down"],
    [{ top: 52, bottom: 118 }, "pixels, not fractions"],
    [{ top: -3, bottom: -1 }, "above the image"],
    [{ top: Number.NaN, bottom: 0.5 }, "NaN"],
    [{ top: "0.1", bottom: "0.2" }, "strings"],
    [{ top: 0.1 }, "half a box"],
    [[0.1, 0.2], "an array"],
    [null, "null"],
    [undefined, "absent"],
  ])("drops %j (%s)", (raw, why) => {
    expect(normalizeBox(raw), why).toBeUndefined();
  });
});

describe("sortByBox", () => {
  const at = (id: string, top?: number) => ({
    id,
    ...(top === undefined ? {} : { box: { top, bottom: top + 0.1 } }),
  });

  it("orders rows top to bottom when every row has a box", () => {
    const rows = [at("c", 0.5), at("a", 0.1), at("b", 0.3)];
    expect(sortByBox(rows).map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(rows.map((row) => row.id)).toEqual(["c", "a", "b"]); // input untouched
  });

  it("keeps the given order for rows at the same height", () => {
    expect(sortByBox([at("x", 0.2), at("y", 0.2), at("w", 0.1)]).map((row) => row.id)).toEqual([
      "w",
      "x",
      "y",
    ]);
  });

  it("leaves the model's order alone as soon as one row has no box", () => {
    const rows = [at("c", 0.5), at("a"), at("b", 0.3)];
    expect(sortByBox(rows).map((row) => row.id)).toEqual(["c", "a", "b"]);
  });
});

describe("normalizeOutput: the new row fields", () => {
  it("passes quantityText and box through, and sorts by box", () => {
    const rows = normalize([
      modelRow({ itemId: "ruby", quantity: "37", quantityText: "37", box: { top: 0.5, bottom: 0.6 } }),
      modelRow({ quantity: "112", quantityText: " 112 ", box: { top: 0.1, bottom: 0.2 } }),
    ]);

    expect(rows.map((row) => row.itemId)).toEqual(["gold-ingot", "ruby"]);
    expect(rows[0]).toMatchObject({ quantity: "112", quantityText: "112", box: { top: 0.1, bottom: 0.2 } });
    expect(rows[0]).not.toHaveProperty("lowConfidenceReason");
    expect(rows[0].confidence).toBe(0.95);
  });

  it("reports an empty quantityText for a stack of 1", () => {
    const [row] = normalize([modelRow({ itemId: "nyxium", quantity: "", quantityText: "" })]);
    expect(row).toMatchObject({ quantity: "1", quantityText: "" });
  });

  it("drops a box that makes no sense without touching the rest of the row", () => {
    const [row] = normalize([modelRow({ quantityText: "112", box: { top: 640, bottom: 706 } })]);
    expect(row).not.toHaveProperty("box");
    expect(row.confidence).toBe(0.95);
  });

  it("reads answers from before the fields existed", () => {
    const old = {
      looksLikeBankLog: true,
      rows: [
        {
          itemId: "silver-coin",
          iconDescription: "A gold coin.",
          quantity: "500,000,000",
          gameTimestamp: "07.09.2026 - 18:02",
          character: "xReacher",
          direction: "deposit",
          confidence: 0.97,
          lowConfidenceReason: "",
        },
      ],
      notes: [],
    };
    const [row] = normalizeOutput(modelOutputSchema.parse(old), catalog).rows;

    expect(row.quantity).toBe("500000000");
    expect(row).not.toHaveProperty("quantityText");
    expect(row).not.toHaveProperty("box");
  });

  it("parses answers that carry the fields, a null quantityText and a junk box included", () => {
    const parsed = modelOutputSchema.parse({
      looksLikeBankLog: true,
      rows: [
        { ...modelRow(), quantityText: "112", box: { top: 0.1, bottom: 0.2 } },
        { ...modelRow(), quantityText: null, box: "second row" },
      ],
      notes: [],
    });
    const rows = normalizeOutput(parsed, catalog).rows;

    expect(rows[0].box).toEqual({ top: 0.1, bottom: 0.2 });
    expect(rows[1]).not.toHaveProperty("box");
    expect(rows[1]).not.toHaveProperty("quantityText");
    expect(rows.map((row) => row.quantity)).toEqual(["112", "112"]);
  });
});

describe("normalizeOutput: amounts that do not add up", () => {
  it("caps a malformed amount at 0.5 and says so", () => {
    const [row] = normalize([
      modelRow({ itemId: "silver-coin", quantityText: "50,000,00", quantity: "5000000" }),
    ]);

    expect(row.quantity).toBe("5000000");
    expect(row.quantityText).toBe("50,000,00");
    expect(row.confidence).toBe(0.5);
    expect(row.lowConfidenceReason).toMatch(/amount looked malformed/);
    expect(row.lowConfidenceReason).toContain('"50,000,00"');
  });

  it("keeps the printed digits when the two readings disagree, and flags the row", () => {
    const [row] = normalize([
      modelRow({ itemId: "silver-coin", quantityText: "10,000,000,000", quantity: "1000000000" }),
    ]);

    expect(row.quantity).toBe("10000000000");
    expect(row.confidence).toBe(0.5);
    expect(row.lowConfidenceReason).toMatch(/read two ways/);
  });
});

describe("normalizeOutput: rows a human always checks", () => {
  const fragments = catalog.filter((item) => item.kind === "fragment");

  it("has four fragments and one currency to apply this to", () => {
    expect(fragments).toHaveLength(4);
    expect(catalog.filter((item) => item.kind === "currency").map((item) => item.id)).toEqual([
      "silver-coin",
    ]);
  });

  it("caps every fragment row at 0.8, however sure the model was", () => {
    const rows = normalize(
      fragments.map((item) => modelRow({ itemId: item.id, quantity: "4", quantityText: "4", confidence: 0.99 })),
    );

    for (const row of rows) {
      expect(row.confidence).toBe(ALWAYS_CHECKED_CONFIDENCE);
      expect(row.lowConfidenceReason).toBe(FRAGMENT_REASON);
    }
    expect(FRAGMENT_REASON.toLowerCase()).toContain("blueprint fragments are always double-checked");
  });

  it("caps every Silver Coin row at 0.8, even with a perfectly grouped amount", () => {
    const [row] = normalize([
      modelRow({
        itemId: "silver-coin",
        quantityText: "500,000,000",
        quantity: "500000000",
        confidence: 0.99,
      }),
    ]);

    expect(row.quantity).toBe("500000000");
    expect(row.confidence).toBe(ALWAYS_CHECKED_CONFIDENCE);
    expect(row.lowConfidenceReason).toBe(MONEY_REASON);
    expect(MONEY_REASON.toLowerCase()).toContain("money amounts are always double-checked");
  });

  it("adds to the model's own doubt instead of replacing it, and never raises confidence", () => {
    const [row] = normalize([
      modelRow({
        itemId: "fragment-ring-of-night",
        confidence: 0.4,
        lowConfidenceReason: "Could be the bracelet.",
      }),
    ]);

    expect(row.confidence).toBe(0.4);
    expect(row.lowConfidenceReason).toBe(`Could be the bracelet. ${FRAGMENT_REASON}`);
  });

  it("notes a money amount that came without separators", () => {
    const [row] = normalize([
      modelRow({ itemId: "silver-coin", quantityText: "5000000", quantity: "5000000" }),
    ]);

    expect(row.quantity).toBe("5000000");
    expect(row.lowConfidenceReason).toMatch(/without thousands separators/);
  });

  it("leaves ordinary materials alone", () => {
    const [row] = normalize([modelRow({ confidence: 0.99 })]);
    expect(row.confidence).toBe(0.99);
    expect(row).not.toHaveProperty("lowConfidenceReason");
  });
});
