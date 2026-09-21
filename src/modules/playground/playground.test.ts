import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_BYTES,
  confidenceLevel,
  errorText,
  formatConfidence,
  formatQuantity,
  sniffMediaType,
  totalsByItem,
  validateImageFile,
} from "./index";

describe("formatQuantity", () => {
  it("adds thousands separators", () => {
    expect(formatQuantity("1")).toBe("1");
    expect(formatQuantity("20000")).toBe("20,000");
  });

  it("keeps every digit of amounts beyond Number's safe range", () => {
    expect(formatQuantity("10000000000")).toBe("10,000,000,000");
    // 2^53 + 1 is not representable as a Number.
    expect(formatQuantity("9007199254740993")).toBe("9,007,199,254,740,993");
    expect(formatQuantity("123456789012345678901234567890")).toBe(
      "123,456,789,012,345,678,901,234,567,890",
    );
  });

  it("returns anything that is not all digits unchanged", () => {
    expect(formatQuantity("")).toBe("");
    expect(formatQuantity("12a")).toBe("12a");
    expect(formatQuantity("-5")).toBe("-5");
  });
});

describe("totalsByItem", () => {
  it("sums per item in order of first appearance", () => {
    const totals = totalsByItem([
      { itemId: "gold-ingot", quantity: "112" },
      { itemId: "nyxium", quantity: "1" },
      { itemId: "gold-ingot", quantity: "888" },
      { itemId: "unknown", quantity: "3" },
      { itemId: "nyxium", quantity: "1" },
    ]);
    expect(totals).toEqual([
      { itemId: "gold-ingot", total: 1000n, rows: 2 },
      { itemId: "nyxium", total: 2n, rows: 2 },
      { itemId: "unknown", total: 3n, rows: 1 },
    ]);
  });

  it("sums with BigInt, so silver beyond 2^53 stays exact", () => {
    const [silver] = totalsByItem([
      { itemId: "silver-coin", quantity: "9007199254740993" },
      { itemId: "silver-coin", quantity: "9007199254740993" },
    ]);
    expect(silver.total).toBe(18014398509481986n);
    expect(formatQuantity(silver.total.toString())).toBe("18,014,398,509,481,986");
  });

  it("treats an unreadable quantity as 0 and still counts the row", () => {
    expect(totalsByItem([{ itemId: "ruby", quantity: "n/a" }])).toEqual([
      { itemId: "ruby", total: 0n, rows: 1 },
    ]);
  });

  it("returns nothing for no rows", () => {
    expect(totalsByItem([])).toEqual([]);
  });
});

describe("confidence", () => {
  it("is green at 0.85 and above, amber from 0.5, red below", () => {
    expect(confidenceLevel(1)).toBe("high");
    expect(confidenceLevel(0.85)).toBe("high");
    expect(confidenceLevel(0.849)).toBe("medium");
    expect(confidenceLevel(0.5)).toBe("medium");
    expect(confidenceLevel(0.499)).toBe("low");
    expect(confidenceLevel(0)).toBe("low");
  });

  it("formats as a whole percentage", () => {
    expect(formatConfidence(0.873)).toBe("87%");
    expect(formatConfidence(1.4)).toBe("100%");
    expect(formatConfidence(Number.NaN)).toBe("0%");
  });
});

describe("validateImageFile", () => {
  it("accepts PNG, JPEG and WebP up to 10 MB", () => {
    expect(validateImageFile({ type: "image/png", size: 1 })).toBeNull();
    expect(validateImageFile({ type: "image/jpeg", size: MAX_IMAGE_BYTES })).toBeNull();
    expect(validateImageFile({ type: "image/webp", size: 2048 })).toBeNull();
  });

  it("rejects other types, empty files and files over 10 MB", () => {
    expect(validateImageFile({ type: "image/gif", size: 10 })).toBe("bad_request");
    expect(validateImageFile({ type: "", size: 10 })).toBe("bad_request");
    expect(validateImageFile({ type: "image/png", size: 0 })).toBe("bad_request");
    expect(validateImageFile({ type: "image/png", size: MAX_IMAGE_BYTES + 1 })).toBe("too_large");
  });
});

describe("sniffMediaType", () => {
  it("recognises PNG, JPEG and WebP signatures", () => {
    expect(sniffMediaType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      "image/png",
    );
    expect(sniffMediaType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(
      sniffMediaType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])),
    ).toBe("image/webp");
  });

  it("returns null for anything else", () => {
    expect(sniffMediaType(new Uint8Array([]))).toBeNull();
    expect(sniffMediaType(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(sniffMediaType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
  });
});

describe("errorText", () => {
  it("has the agreed wording for config and rate_limit", () => {
    expect(errorText("config")).toBe("The server has no API key configured.");
    expect(errorText("rate_limit")).toBe("Busy, try again in a minute.");
  });

  it("falls back to a generic line for an unknown kind", () => {
    expect(errorText("???")).toBe("Something went wrong. Try again.");
  });
});
