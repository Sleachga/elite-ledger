import { describe, expect, it } from "vitest";
import { compactReading, parseQuantityInput, quantityRejectionText } from "./quantity";

function digits(input: string): string | null {
  const parsed = parseQuantityInput(input);
  return parsed.ok ? parsed.digits : null;
}

function rejection(input: string): string | null {
  const parsed = parseQuantityInput(input);
  return parsed.ok ? null : parsed.reason;
}

describe("parseQuantityInput", () => {
  it("reads plain digits", () => {
    expect(digits("1")).toBe("1");
    expect(digits("640")).toBe("640");
    expect(digits("  20000  ")).toBe("20000");
    expect(digits("+112")).toBe("112");
    expect(digits("007")).toBe("7");
  });

  it("reads comma grouping", () => {
    expect(digits("20,000")).toBe("20000");
    expect(digits("500,000,000")).toBe("500000000");
    expect(digits("10,000,000,000")).toBe("10000000000");
  });

  it("reads spaces, no-break spaces, apostrophes and underscores as grouping", () => {
    expect(digits("500 000 000")).toBe("500000000");
    expect(digits("500 000 000")).toBe("500000000");
    expect(digits("1'500'000")).toBe("1500000");
    expect(digits("1_500_000")).toBe("1500000");
  });

  it("reads dots as grouping when there is no suffix", () => {
    expect(digits("1.500")).toBe("1500");
    expect(digits("500.000.000")).toBe("500000000");
  });

  it("reads the k / m / b suffixes", () => {
    expect(digits("5k")).toBe("5000");
    expect(digits("500m")).toBe("500000000");
    expect(digits("10b")).toBe("10000000000");
    expect(digits("500M")).toBe("500000000");
    expect(digits("500 m")).toBe("500000000");
    expect(digits("1,500k")).toBe("1500000");
  });

  it("reads decimals in front of a suffix", () => {
    expect(digits("1.5b")).toBe("1500000000");
    expect(digits("2.25m")).toBe("2250000");
    expect(digits("0.5k")).toBe("500");
    expect(digits(".5m")).toBe("500000");
    expect(digits("1.500k")).toBe("1500");
    expect(digits("1.50b")).toBe("1500000000");
  });

  it("accepts a fraction that is a whole number after all", () => {
    expect(digits("2.0")).toBe("2");
    expect(digits("1.234k")).toBe("1234");
  });

  it("stays exact beyond Number's safe range", () => {
    expect(digits("9,007,199,254,740,993")).toBe("9007199254740993");
    expect(digits("999999999999999999")).toBe("999999999999999999");
    expect(digits("999999999b")).toBe("999999999000000000");
  });

  it("rejects nothing, negatives and zero", () => {
    expect(rejection("")).toBe("empty");
    expect(rejection("   ")).toBe("empty");
    expect(rejection("-5")).toBe("negative");
    expect(rejection("−500m")).toBe("negative");
    expect(rejection("0")).toBe("zero");
    expect(rejection("0.0k")).toBe("zero");
    expect(rejection("000")).toBe("zero");
  });

  it("rejects fractions that do not come out whole", () => {
    expect(rejection("1.5")).toBe("fraction");
    expect(rejection("1.2345k")).toBe("fraction");
    expect(rejection("0.0000000001b")).toBe("fraction");
  });

  it("rejects more than 18 digits", () => {
    expect(rejection("1000000000000000000")).toBe("too_long");
    expect(rejection("10000000000b")).toBe("too_long");
  });

  it("rejects a slipped digit rather than guessing the magnitude", () => {
    expect(rejection("50,000,00")).toBe("invalid");
    expect(rejection("5000,000")).toBe("invalid");
    expect(rejection("5,00,000")).toBe("invalid");
    expect(rejection("500 000,000")).toBe("invalid");
    expect(rejection("1,5b")).toBe("invalid");
  });

  it("rejects anything else that is not a number", () => {
    expect(rejection("abc")).toBe("invalid");
    expect(rejection("k")).toBe("invalid");
    expect(rejection("1e9")).toBe("invalid");
    expect(rejection("1.2.3m")).toBe("invalid");
    expect(rejection("12 gold")).toBe("invalid");
    expect(rejection("5kk")).toBe("invalid");
  });

  it("has a plain sentence for every rejection", () => {
    for (const reason of ["empty", "invalid", "negative", "zero", "fraction", "too_long"] as const) {
      expect(quantityRejectionText(reason)).toMatch(/\.$/);
    }
  });
});

describe("compactReading", () => {
  it("leaves small numbers alone", () => {
    expect(compactReading("1")).toBe("1");
    expect(compactReading("640")).toBe("640");
    expect(compactReading("999")).toBe("999");
  });

  it("names thousands, millions and billions", () => {
    expect(compactReading("2000")).toBe("2 thousand");
    expect(compactReading("20000")).toBe("20 thousand");
    expect(compactReading("50000000")).toBe("50 million");
    expect(compactReading("500000000")).toBe("500 million");
    expect(compactReading("1500000000")).toBe("1.5 billion");
    expect(compactReading("10000000000")).toBe("10 billion");
    expect(compactReading("2250000")).toBe("2.25 million");
  });

  it("goes on past billions, exactly", () => {
    expect(compactReading("1000000000000")).toBe("1 trillion");
    expect(compactReading("9007199254740993")).toBe("≈ 9 quadrillion");
    expect(compactReading("999999999999999999")).toBe("≈ 999.99 quadrillion");
    expect(compactReading("1000000000000000000000")).toBe("1,000 quintillion");
  });

  it("cuts instead of rounding up, and says so", () => {
    expect(compactReading("999999")).toBe("≈ 999.99 thousand");
    expect(compactReading("1234567")).toBe("≈ 1.23 million");
    expect(compactReading("1001")).toBe("≈ 1 thousand");
    expect(compactReading("1230000")).toBe("1.23 million");
  });

  it("ignores leading zeros and anything that is not digits", () => {
    expect(compactReading("0001500")).toBe("1.5 thousand");
    expect(compactReading("")).toBe("");
    expect(compactReading("12a")).toBe("");
    expect(compactReading("-5")).toBe("");
  });
});
