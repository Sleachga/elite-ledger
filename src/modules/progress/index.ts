/**
 * Progress toward the next Elite: a pure function of (recipes, stock, crafts).
 *
 * - Stock is the total of confirmed deposits per item. Crafts subtract each
 *   crafted recipe's full quantities from stock (never from anyone's
 *   contributions; those live elsewhere).
 * - "Shared" lines are every ingredient except an Elite's own blueprint
 *   fragment. Their `need` is the max over recipes (all four are identical
 *   today, but nothing here assumes that).
 * - All quantities are bigint. Percentages are numbers 0-100 with two decimals.
 */
import type { EliteType } from "@/catalog";

export interface ProgressRecipeLine {
  itemId: string;
  qty: bigint;
  /** false for the Elite's own blueprint fragment, true for everything else. */
  shared: boolean;
}

export interface ProgressRecipe {
  eliteType: EliteType;
  lines: readonly ProgressRecipeLine[];
}

export interface ProgressCraft {
  eliteType: EliteType;
}

export type StockByItem = ReadonlyMap<string, bigint> | Readonly<Record<string, bigint>>;

export interface ProgressInput {
  recipes: readonly ProgressRecipe[];
  /** Total deposits per item id (before crafts are subtracted). */
  stockByItem: StockByItem;
  crafts: readonly ProgressCraft[];
}

export interface MaterialProgress {
  itemId: string;
  /** Stock after crafts, clamped at 0. */
  have: bigint;
  need: bigint;
  /** 0-100, capped at 100. */
  pct: number;
}

export interface EliteProgress {
  eliteType: EliteType;
  fragmentItemId: string | null;
  fragmentsHave: bigint;
  fragmentsNeed: bigint;
  /** 0-100, capped at 100. */
  fragmentsPct: number;
  /** How many of this Elite could be crafted from current stock alone. */
  craftableNow: number;
}

export interface Progress {
  /** In recipe order; use sortByPctAscending() for the bottleneck-first view. */
  shared: MaterialProgress[];
  elites: EliteProgress[];
  elitesCrafted: number;
  /** min(shared material %) capped by the best fragment type's %. 0-100. */
  pctToNextElite: number;
  /** min over shared materials of have / need, uncapped (e.g. 2.35). */
  sharedElitesWorth: number;
}

const ZERO = 0n;

function readStock(stock: StockByItem, itemId: string): bigint {
  if (stock instanceof Map) return stock.get(itemId) ?? ZERO;
  return (stock as Readonly<Record<string, bigint>>)[itemId] ?? ZERO;
}

function clamp0(value: bigint): bigint {
  return value < ZERO ? ZERO : value;
}

/** have/need as a percentage 0-100 with two decimals, capped at 100. */
export function pctOf(have: bigint, need: bigint): number {
  if (need <= ZERO) return 100;
  const capped = have >= need ? need : clamp0(have);
  return Number((capped * 10000n) / need) / 100;
}

/** have/need as an uncapped ratio with three decimals. */
export function ratioOf(have: bigint, need: bigint): number {
  if (need <= ZERO) return 0;
  return Number((clamp0(have) * 1000n) / need) / 1000;
}

function floorDiv(have: bigint, qty: bigint): number {
  if (qty <= ZERO) return Number.POSITIVE_INFINITY;
  return Number(clamp0(have) / qty);
}

export function computeProgress(input: ProgressInput): Progress {
  const { recipes, crafts } = input;

  // 1. Stock after crafts.
  const stock = new Map<string, bigint>();
  const touch = (itemId: string) => {
    if (!stock.has(itemId)) stock.set(itemId, readStock(input.stockByItem, itemId));
  };
  for (const recipe of recipes) for (const line of recipe.lines) touch(line.itemId);

  const recipeByType = new Map(recipes.map((recipe) => [recipe.eliteType, recipe]));
  for (const craft of crafts) {
    const recipe = recipeByType.get(craft.eliteType);
    if (!recipe) continue;
    for (const line of recipe.lines) {
      stock.set(line.itemId, (stock.get(line.itemId) ?? ZERO) - line.qty);
    }
  }

  // 2. Shared materials: union across recipes, need = max, first-seen order.
  const sharedNeed = new Map<string, bigint>();
  for (const recipe of recipes) {
    for (const line of recipe.lines) {
      if (!line.shared) continue;
      const prev = sharedNeed.get(line.itemId);
      if (prev === undefined || line.qty > prev) sharedNeed.set(line.itemId, line.qty);
    }
  }
  const shared: MaterialProgress[] = [...sharedNeed].map(([itemId, need]) => {
    const have = clamp0(stock.get(itemId) ?? ZERO);
    return { itemId, have, need, pct: pctOf(have, need) };
  });

  // 3. Per Elite type.
  const elites: EliteProgress[] = recipes.map((recipe) => {
    const fragment = recipe.lines.find((line) => !line.shared) ?? null;
    const fragmentsHave = fragment ? clamp0(stock.get(fragment.itemId) ?? ZERO) : ZERO;
    const fragmentsNeed = fragment ? fragment.qty : ZERO;
    let craftableNow = recipe.lines.length === 0 ? 0 : Number.POSITIVE_INFINITY;
    for (const line of recipe.lines) {
      craftableNow = Math.min(craftableNow, floorDiv(stock.get(line.itemId) ?? ZERO, line.qty));
    }
    return {
      eliteType: recipe.eliteType,
      fragmentItemId: fragment?.itemId ?? null,
      fragmentsHave,
      fragmentsNeed,
      fragmentsPct: fragment ? pctOf(fragmentsHave, fragmentsNeed) : 0,
      craftableNow: Number.isFinite(craftableNow) ? craftableNow : 0,
    };
  });

  // 4. Headline numbers.
  const minSharedPct = shared.length ? Math.min(...shared.map((m) => m.pct)) : 0;
  const bestFragmentPct = elites.length ? Math.max(...elites.map((e) => e.fragmentsPct)) : 0;
  const pctToNextElite = shared.length || elites.length ? Math.min(minSharedPct, bestFragmentPct) : 0;
  const sharedElitesWorth = shared.length
    ? Math.min(...shared.map((m) => ratioOf(m.have, m.need)))
    : 0;

  return {
    shared,
    elites,
    elitesCrafted: crafts.length,
    pctToNextElite,
    sharedElitesWorth,
  };
}

/** Bottleneck first: lowest % on top, ties keep recipe order. */
export function sortByPctAscending<T extends { pct: number }>(list: readonly T[]): T[] {
  return list
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.pct - b.entry.pct || a.index - b.index)
    .map(({ entry }) => entry);
}
