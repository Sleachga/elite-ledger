/**
 * Vendored item catalog + Elite recipes.
 *
 * `catalog.json` holds the tracked items (name, rarity, icon file, aliases)
 * pulled once from the Quinfall Codex. The PNGs live in `public/icons/` so
 * one copy is both served to the browser and readable from disk for the
 * extraction prompt in a later slice. `recipes.json` holds the four Elite
 * recipes from CLAUDE.md decision 7.
 *
 * Rarity -> Radix color mapping lives here and nowhere else.
 */
import catalogJson from "./catalog.json";
import recipesJson from "./recipes.json";

export const RARITIES = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "mythic",
] as const;
export type Rarity = (typeof RARITIES)[number];

export const ITEM_KINDS = ["material", "fragment", "currency"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ELITE_TYPES = ["ring", "earring", "necklace", "bracelet"] as const;
export type EliteType = (typeof ELITE_TYPES)[number];

/** Radix Themes color names used for rarity borders and badges. */
export type RadixColor = "gray" | "green" | "blue" | "purple" | "orange" | "red";

/** The one place rarity becomes a color (CLAUDE.md: never per-component). */
export const RARITY_COLOR: Record<Rarity, RadixColor> = {
  common: "gray",
  uncommon: "green",
  rare: "blue",
  epic: "purple",
  legendary: "orange",
  mythic: "red",
};

export interface CatalogItem {
  id: string;
  name: string;
  rarity: Rarity;
  /** File name inside `public/icons/`. */
  icon: string;
  aliases: string[];
  kind: ItemKind;
  eliteType?: EliteType;
}

export interface CatalogSource {
  name: string;
  url: string;
  iconBase: string;
  gamePatch: string;
  codexDataUpdated: string;
  fetchedAt: string;
}

function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value);
}

type RawItem = (typeof catalogJson.items)[number];

function parseItem(raw: RawItem): CatalogItem {
  if (!isOneOf(RARITIES, raw.rarity)) {
    throw new Error(`catalog: unknown rarity "${raw.rarity}" on ${raw.id}`);
  }
  if (!isOneOf(ITEM_KINDS, raw.kind)) {
    throw new Error(`catalog: unknown kind "${raw.kind}" on ${raw.id}`);
  }
  const eliteType = "eliteType" in raw ? raw.eliteType : undefined;
  if (eliteType !== undefined && !isOneOf(ELITE_TYPES, eliteType)) {
    throw new Error(`catalog: unknown eliteType "${eliteType}" on ${raw.id}`);
  }
  if ((raw.kind === "fragment") !== (eliteType !== undefined)) {
    throw new Error(`catalog: fragments and only fragments carry an eliteType (${raw.id})`);
  }
  return {
    id: raw.id,
    name: raw.name,
    rarity: raw.rarity,
    icon: raw.icon,
    aliases: [...raw.aliases],
    kind: raw.kind,
    ...(eliteType ? { eliteType } : {}),
  };
}

export const catalogSource: CatalogSource = catalogJson.source;

/** All tracked items, in display order. */
export const catalog: readonly CatalogItem[] = catalogJson.items.map(parseItem);

const byId = new Map(catalog.map((item) => [item.id, item]));

export function getItem(id: string): CatalogItem {
  const item = byId.get(id);
  if (!item) throw new Error(`catalog: unknown item id "${id}"`);
  return item;
}

export function findItem(id: string): CatalogItem | undefined {
  return byId.get(id);
}

/** Public URL of an item's icon (served from `public/icons/`). */
export function iconUrl(item: Pick<CatalogItem, "icon">): string {
  return `/icons/${item.icon}`;
}

export function rarityColor(rarity: Rarity): RadixColor {
  return RARITY_COLOR[rarity];
}

/** "[Blueprint Fragment] Ring of Night" -> "Ring of Night". */
export function fragmentLabel(item: Pick<CatalogItem, "name">): string {
  return item.name.replace(/^\[Blueprint Fragment\]\s*/, "");
}

export interface RecipeLine {
  itemId: string;
  qty: bigint;
  /** false for the Elite's own blueprint fragment, true for everything else. */
  shared: boolean;
}

export interface RecipeDef {
  /** Same as eliteType; also the primary key in the `recipes` table. */
  id: EliteType;
  eliteType: EliteType;
  /** Display name of the crafted Elite, e.g. "Ring of Night". */
  name: string;
  fragmentItemId: string;
  lines: RecipeLine[];
}

const sharedLines: readonly RecipeLine[] = recipesJson.shared.map((line) => {
  getItem(line.itemId); // throws on a typo
  return { itemId: line.itemId, qty: BigInt(line.qty), shared: true };
});

/** The four Elite recipes: 100 of the matching fragment + the shared list. */
export const recipes: readonly RecipeDef[] = recipesJson.elites.map((elite) => {
  if (!isOneOf(ELITE_TYPES, elite.eliteType)) {
    throw new Error(`recipes: unknown eliteType "${elite.eliteType}"`);
  }
  const fragment = getItem(elite.fragmentItemId);
  if (fragment.kind !== "fragment" || fragment.eliteType !== elite.eliteType) {
    throw new Error(`recipes: ${elite.fragmentItemId} is not the ${elite.eliteType} fragment`);
  }
  return {
    id: elite.eliteType,
    eliteType: elite.eliteType,
    name: elite.name,
    fragmentItemId: elite.fragmentItemId,
    lines: [
      { itemId: elite.fragmentItemId, qty: BigInt(recipesJson.fragmentQty), shared: false },
      ...sharedLines.map((line) => ({ ...line })),
    ],
  };
});
