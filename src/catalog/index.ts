/**
 * Vendored item catalog + Elite recipes.
 *
 * `catalog.json` holds the tracked items (name, rarity, icon file, aliases)
 * pulled once from the Quinfall Codex, plus the *decoys*: codex items that
 * share their art with a tracked item but carry a different rarity, so the
 * extractor can show the model what "same art, different border" looks like.
 * The PNGs live in `public/icons/` so one copy is both served to the browser
 * and readable from disk for the extraction prompt. `recipes.json` holds the
 * four Elite recipes from CLAUDE.md decision 7.
 *
 * Rarity -> Radix color mapping (the site's chrome) and rarity -> in-game
 * border color (what a screenshot shows) both live here and nowhere else.
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

/** Where a rarity's in-game border color comes from. */
export type BorderEvidence =
  /** Seen on the owner's real bank-log screenshots. */
  | "in-game"
  /** The owner's own description of the border. */
  | "owner"
  /** Not seen; assumed from the usual green-blue-purple ladder. */
  | "assumed"
  /** Not seen; the Quinfall Codex's own palette value. */
  | "codex";

export interface RarityBorder {
  /** Border color as hex, used to draw the reference icons. */
  hex: string;
  /** Plain color word the extraction prompt uses. */
  word: string;
  evidence: BorderEvidence;
}

/**
 * The border color the game draws around an item's icon, by rarity
 * (settled 2026-09-22; tracking issue: the rarity-matching PR).
 *
 * Evidence, strongest first:
 *  - the owner's two real bank-log screenshots: ingots (common) have a green
 *    border, Nyxium (legendary) a purple one, blueprint fragments (mythic) a
 *    red one, and Silver Coin rows have no border at all;
 *  - the owner calls Purified Veltryn's (rare) border "purple";
 *  - the Quinfall Codex stylesheet (`--r-*` in `/_app/immutable/assets/
 *    0.FHPm1DP_.css`, fetched 2026-09-22): common oklch(94% .01 250) #e6ecf2,
 *    uncommon oklch(70% .15 145) #5bb661, rare oklch(68% .16 255) #4c99f8,
 *    epic oklch(70% .19 310) #c277f5, legendary oklch(82% .15 75) #fcb442,
 *    mythic oklch(65% .22 22) #f93f4e.
 *
 * The codex palette is the fan site's own and disagrees with the game where
 * we can check (common is near-white there, green in the game; legendary is
 * orange there, purple in the game), so the in-game evidence wins and the
 * codex only lends its hex values for the hues. A second fan site
 * (quinfallcrafting.com/item-db, `.rarity-0` .. `.rarity-6` in its CSS) uses
 * the usual ladder grey, green, blue, purple, orange, red, gold, which agrees
 * with green/blue/purple for the first three rungs; uncommon (blue) and epic
 * (orange) are taken from that ladder and are not seen in-game (uncommon is
 * on two decoys and no tracked item; epic is on nothing). Rare and legendary
 * are both "purple" until a real screenshot shows two shades, so borders
 * never tell them apart: see `sameBorderColor`.
 */
export const RARITY_BORDER: Record<Rarity, RarityBorder> = {
  common: { hex: "#5bb661", word: "green", evidence: "in-game" },
  uncommon: { hex: "#4c99f8", word: "blue", evidence: "assumed" },
  rare: { hex: "#c277f5", word: "purple", evidence: "owner" },
  epic: { hex: "#fcb442", word: "orange", evidence: "assumed" },
  legendary: { hex: "#c277f5", word: "purple", evidence: "in-game" },
  mythic: { hex: "#f93f4e", word: "red", evidence: "in-game" },
};

/** Rarity -> in-game border color as hex (see `RARITY_BORDER` for the sources). */
export const rarityBorderHex: Record<Rarity, string> = Object.fromEntries(
  RARITIES.map((rarity) => [rarity, RARITY_BORDER[rarity].hex]),
) as Record<Rarity, string>;

export function rarityBorderWord(rarity: Rarity): string {
  return RARITY_BORDER[rarity].word;
}

/** True when two rarities draw the same border color, so a border cannot tell them apart. */
export function sameBorderColor(a: Rarity, b: Rarity): boolean {
  return RARITY_BORDER[a].word === RARITY_BORDER[b].word;
}

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

/**
 * A codex item that is not tracked but shares its art with a tracked item
 * and has a different rarity, so only the border (and a detail of the art)
 * tells them apart. Shown to the model as a "NOT tracked" reference.
 */
export interface DecoyItem {
  id: string;
  name: string;
  rarity: Rarity;
  /** File name inside `public/icons/`. */
  icon: string;
  /** Tracked item ids this one can be mistaken for. */
  lookalikeOf: string[];
  /** What sets its art apart from the tracked item's, for the prompt label. */
  differs: string;
}

export interface CatalogSource {
  name: string;
  url: string;
  iconBase: string;
  gamePatch: string;
  codexDataUpdated: string;
  fetchedAt: string;
  decoysFetchedAt: string;
}

function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value);
}

type RawItem = (typeof catalogJson.items)[number];
type RawDecoy = (typeof catalogJson.decoys)[number];

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

function parseDecoy(raw: RawDecoy): DecoyItem {
  if (!isOneOf(RARITIES, raw.rarity)) {
    throw new Error(`catalog: unknown rarity "${raw.rarity}" on decoy ${raw.id}`);
  }
  if (byId.has(raw.id)) {
    throw new Error(`catalog: decoy id "${raw.id}" is also a tracked item`);
  }
  if (raw.lookalikeOf.length === 0) {
    throw new Error(`catalog: decoy ${raw.id} names no tracked item it looks like`);
  }
  for (const id of raw.lookalikeOf) {
    const tracked = byId.get(id);
    if (!tracked) throw new Error(`catalog: decoy ${raw.id} looks like unknown item "${id}"`);
    if (sameBorderColor(tracked.rarity, raw.rarity)) {
      throw new Error(
        `catalog: decoy ${raw.id} has the same border color as ${id}, so it is not a border decoy`,
      );
    }
  }
  return {
    id: raw.id,
    name: raw.name,
    rarity: raw.rarity,
    icon: raw.icon,
    lookalikeOf: [...raw.lookalikeOf],
    differs: raw.differs,
  };
}

/** Untracked lookalikes with a different border, for the extraction prompt. */
export const decoys: readonly DecoyItem[] = catalogJson.decoys.map(parseDecoy);

const decoyById = new Map(decoys.map((item) => [item.id, item]));
if (decoyById.size !== decoys.length) throw new Error("catalog: duplicate decoy id");

export function getItem(id: string): CatalogItem {
  const item = byId.get(id);
  if (!item) throw new Error(`catalog: unknown item id "${id}"`);
  return item;
}

export function findItem(id: string): CatalogItem | undefined {
  return byId.get(id);
}

export function findDecoy(id: string): DecoyItem | undefined {
  return decoyById.get(id);
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
