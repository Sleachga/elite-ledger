import { describe, expect, it } from "vitest";
import { rowAtFraction, stripLayout, stripWindow } from "./geometry";

describe("stripWindow", () => {
  it("pads the row by 40% of its own height on both sides", () => {
    const window = stripWindow({ top: 0.4, bottom: 0.5 });
    expect(window.top).toBeCloseTo(0.36);
    expect(window.bottom).toBeCloseTo(0.54);
  });

  it("stays inside the image", () => {
    expect(stripWindow({ top: 0, bottom: 0.1 }).top).toBe(0);
    expect(stripWindow({ top: 0.95, bottom: 1 }).bottom).toBe(1);
  });
});

describe("stripLayout", () => {
  const natural = { width: 780, height: 396 };

  it("draws at twice the screenshot's pixels at least", () => {
    const layout = stripLayout({ top: 0.25, bottom: 0.5 }, natural, 360);
    expect(layout.imageWidth).toBe(1560);
    expect(layout.imageHeight).toBe(792);
    // Row 0.25 of the height + 40% above and below = 0.45 of 792.
    expect(layout.height).toBeCloseTo(356.4);
    expect(layout.offsetY).toBeCloseTo(0.15 * 792);
  });

  it("scales further when the container is wider than twice the screenshot", () => {
    const layout = stripLayout({ top: 0.25, bottom: 0.5 }, { width: 200, height: 100 }, 600);
    expect(layout.imageWidth).toBe(600);
    expect(layout.imageHeight).toBe(300);
  });

  it("copes with an image that has not loaded", () => {
    expect(stripLayout({ top: 0.25, bottom: 0.5 }, { width: 0, height: 0 }, 360)).toEqual({
      imageWidth: 0,
      imageHeight: 0,
      height: 0,
      offsetY: 0,
    });
  });
});

describe("rowAtFraction", () => {
  const rows = [
    { id: "r0", box: { top: 0.1, bottom: 0.3 } },
    { id: "r1", box: null },
    { id: "r2", box: { top: 0.28, bottom: 0.5 } },
  ];

  it("finds the row whose band contains the click", () => {
    expect(rowAtFraction(rows, 0.2)).toBe("r0");
    expect(rowAtFraction(rows, 0.45)).toBe("r2");
  });

  it("finds nothing between and outside the bands", () => {
    expect(rowAtFraction(rows, 0.05)).toBeNull();
    expect(rowAtFraction(rows, 0.9)).toBeNull();
    expect(rowAtFraction([], 0.5)).toBeNull();
    expect(rowAtFraction([{ id: "r1", box: null }], 0.5)).toBeNull();
  });

  it("picks the nearest middle where bands overlap", () => {
    expect(rowAtFraction(rows, 0.285)).toBe("r0");
    expect(rowAtFraction(rows, 0.299)).toBe("r2");
  });
});
