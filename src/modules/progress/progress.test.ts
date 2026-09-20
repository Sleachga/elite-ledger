import { describe, expect, it } from "vitest";
import { recipes as catalogRecipes } from "@/catalog";
import {
  computeProgress,
  pctOf,
  ratioOf,
  sortByPctAscending,
  type ProgressRecipe,
} from "./index";

// Small recipes so the arithmetic is readable. Two Elite types share
// "gold" and "ruby"; each needs 10 of its own fragment.
const ring: ProgressRecipe = {
  eliteType: "ring",
  lines: [
    { itemId: "frag-ring", qty: 10n, shared: false },
    { itemId: "gold", qty: 100n, shared: true },
    { itemId: "ruby", qty: 20n, shared: true },
  ],
};
const earring: ProgressRecipe = {
  eliteType: "earring",
  lines: [
    { itemId: "frag-earring", qty: 10n, shared: false },
    { itemId: "gold", qty: 100n, shared: true },
    { itemId: "ruby", qty: 20n, shared: true },
  ],
};
const recipes = [ring, earring];

function stock(values: Record<string, bigint>) {
  return new Map(Object.entries(values));
}

describe("computeProgress", () => {
  it("zero stock -> everything is 0 and nothing is craftable", () => {
    const p = computeProgress({ recipes, stockByItem: stock({}), crafts: [] });

    expect(p.shared).toEqual([
      { itemId: "gold", have: 0n, need: 100n, pct: 0 },
      { itemId: "ruby", have: 0n, need: 20n, pct: 0 },
    ]);
    expect(p.elites.map((e) => e.fragmentsHave)).toEqual([0n, 0n]);
    expect(p.elites.map((e) => e.craftableNow)).toEqual([0, 0]);
    expect(p.elitesCrafted).toBe(0);
    expect(p.pctToNextElite).toBe(0);
    expect(p.sharedElitesWorth).toBe(0);
  });

  it("percent math: per-material % is have/need, capped at 100, two decimals", () => {
    const p = computeProgress({
      recipes,
      stockByItem: stock({ gold: 33n, ruby: 45n }),
      crafts: [],
    });
    const byId = Object.fromEntries(p.shared.map((m) => [m.itemId, m]));

    expect(byId.gold.pct).toBe(33);
    expect(byId.ruby.pct).toBe(100); // 45/20 caps at 100
    expect(byId.ruby.have).toBe(45n); // but the raw quantity is kept
    expect(pctOf(1n, 3n)).toBe(33.33);
    expect(pctOf(0n, 0n)).toBe(100);
  });

  it("splits fragments from shared materials", () => {
    const p = computeProgress({
      recipes,
      stockByItem: stock({ "frag-ring": 5n, "frag-earring": 10n, gold: 100n }),
      crafts: [],
    });

    expect(p.shared.map((m) => m.itemId)).toEqual(["gold", "ruby"]);
    expect(p.elites).toEqual([
      {
        eliteType: "ring",
        fragmentItemId: "frag-ring",
        fragmentsHave: 5n,
        fragmentsNeed: 10n,
        fragmentsPct: 50,
        craftableNow: 0,
      },
      {
        eliteType: "earring",
        fragmentItemId: "frag-earring",
        fragmentsHave: 10n,
        fragmentsNeed: 10n,
        fragmentsPct: 100,
        craftableNow: 0, // ruby is still 0
      },
    ]);
  });

  it("% to next Elite is the min over shared materials, capped by the best fragment type", () => {
    // Shared is complete; fragments are the limit -> best fragment type wins.
    const fragmentsLimit = computeProgress({
      recipes,
      stockByItem: stock({ gold: 100n, ruby: 20n, "frag-ring": 3n, "frag-earring": 7n }),
      crafts: [],
    });
    expect(fragmentsLimit.pctToNextElite).toBe(70);

    // Fragments complete; gold is the bottleneck.
    const goldLimit = computeProgress({
      recipes,
      stockByItem: stock({ gold: 25n, ruby: 20n, "frag-ring": 10n, "frag-earring": 10n }),
      crafts: [],
    });
    expect(goldLimit.pctToNextElite).toBe(25);

    // Both complete -> 100.
    const ready = computeProgress({
      recipes,
      stockByItem: stock({ gold: 100n, ruby: 20n, "frag-ring": 10n }),
      crafts: [],
    });
    expect(ready.pctToNextElite).toBe(100);
    expect(ready.elites[0].craftableNow).toBe(1);
  });

  it("Elites' worth of shared materials is the uncapped min ratio", () => {
    const p = computeProgress({
      recipes,
      stockByItem: stock({ gold: 250n, ruby: 60n }),
      crafts: [],
    });
    // gold 2.5x, ruby 3x -> 2.5
    expect(p.sharedElitesWorth).toBe(2.5);
    expect(ratioOf(1n, 3n)).toBe(0.333);
  });

  it("craftableNow is limited by shared stock even when fragments are plentiful", () => {
    const p = computeProgress({
      recipes,
      stockByItem: stock({ gold: 250n, ruby: 60n, "frag-ring": 50n, "frag-earring": 10n }),
      crafts: [],
    });
    expect(p.elites[0].craftableNow).toBe(2); // 5 fragments' worth, 2 gold's worth
    expect(p.elites[1].craftableNow).toBe(1);
  });

  it("a craft subtracts its recipe from stock but the function never touches the inputs", () => {
    const input = stock({ gold: 100n, ruby: 20n, "frag-ring": 10n, "frag-earring": 4n });
    const before = new Map(input);

    const p = computeProgress({ recipes, stockByItem: input, crafts: [{ eliteType: "ring" }] });

    expect(p.elitesCrafted).toBe(1);
    expect(p.shared.map((m) => [m.itemId, m.have])).toEqual([
      ["gold", 0n],
      ["ruby", 0n],
    ]);
    expect(p.elites[0].fragmentsHave).toBe(0n); // ring fragments consumed
    expect(p.elites[1].fragmentsHave).toBe(4n); // earring fragments untouched
    expect(p.pctToNextElite).toBe(0);
    expect(input).toEqual(before); // caller's stock (the "contributed" totals) is unchanged
  });

  it("stock driven negative by crafts is clamped to 0", () => {
    const p = computeProgress({
      recipes,
      stockByItem: stock({ gold: 10n }),
      crafts: [{ eliteType: "ring" }, { eliteType: "earring" }],
    });
    expect(p.elitesCrafted).toBe(2);
    expect(p.shared.every((m) => m.have === 0n && m.pct === 0)).toBe(true);
  });

  it("uses the max need when recipes disagree on a shared quantity", () => {
    const heavier: ProgressRecipe = {
      eliteType: "necklace",
      lines: [
        { itemId: "frag-necklace", qty: 10n, shared: false },
        { itemId: "gold", qty: 400n, shared: true },
      ],
    };
    const p = computeProgress({ recipes: [ring, heavier], stockByItem: stock({}), crafts: [] });
    expect(p.shared.find((m) => m.itemId === "gold")?.need).toBe(400n);
  });

  it("accepts a plain object for stock", () => {
    const p = computeProgress({ recipes, stockByItem: { gold: 50n }, crafts: [] });
    expect(p.shared[0]).toEqual({ itemId: "gold", have: 50n, need: 100n, pct: 50 });
  });

  it("works with the real catalog recipes (bigint-safe Silver Coin)", () => {
    const p = computeProgress({
      recipes: catalogRecipes,
      stockByItem: { "silver-coin": 5_000_000_000n },
      crafts: [],
    });
    expect(p.shared).toHaveLength(11);
    expect(p.elites.map((e) => e.eliteType)).toEqual(["ring", "earring", "necklace", "bracelet"]);
    const silver = p.shared.find((m) => m.itemId === "silver-coin");
    expect(silver).toEqual({
      itemId: "silver-coin",
      have: 5_000_000_000n,
      need: 10_000_000_000n,
      pct: 50,
    });
    expect(p.elites.every((e) => e.fragmentsNeed === 100n)).toBe(true);
  });
});

describe("sortByPctAscending", () => {
  it("puts the bottleneck first and keeps input order for ties", () => {
    const sorted = sortByPctAscending([
      { id: "a", pct: 50 },
      { id: "b", pct: 0 },
      { id: "c", pct: 0 },
      { id: "d", pct: 100 },
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["b", "c", "a", "d"]);
  });
});
