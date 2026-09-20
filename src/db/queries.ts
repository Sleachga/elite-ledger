import { asc } from "drizzle-orm";
import type { EliteType } from "@/catalog";
import { computeProgress, type Progress, type ProgressCraft } from "@/modules/progress";
import { getDb, type Db } from "./index";
import { items, recipeItems, recipes, type ItemRow } from "./schema";

export async function listItems(db: Db): Promise<ItemRow[]> {
  return db.select().from(items).orderBy(asc(items.sortOrder), asc(items.id));
}

export interface RecipeWithLines {
  id: string;
  eliteType: EliteType;
  name: string;
  fragmentItemId: string | null;
  lines: { itemId: string; qty: bigint; shared: boolean }[];
}

export async function listRecipes(db: Db, itemsById: ReadonlyMap<string, ItemRow>): Promise<RecipeWithLines[]> {
  const recipeRows = await db.select().from(recipes).orderBy(asc(recipes.id));
  const lineRows = await db.select().from(recipeItems);
  return recipeRows.map((recipe) => {
    const lines = lineRows
      .filter((line) => line.recipeId === recipe.id)
      .map((line) => ({
        itemId: line.itemId,
        qty: line.qty,
        shared: itemsById.get(line.itemId)?.kind !== "fragment",
      }));
    return {
      id: recipe.id,
      eliteType: recipe.eliteType,
      name: recipe.name,
      fragmentItemId: lines.find((line) => !line.shared)?.itemId ?? null,
      lines,
    };
  });
}

/**
 * Current stock per item = total confirmed deposits per item.
 *
 * There is no `deposits` table yet (slice 2), so every tracked item is 0.
 * A later slice replaces the body with `SELECT item_id, SUM(qty) ... GROUP BY`.
 */
export async function getStockByItem(db: Db): Promise<Map<string, bigint>> {
  const rows = await listItems(db);
  return new Map(rows.map((row) => [row.id, 0n]));
}

/** Crafted Elites. There is no `crafts` table yet (slice 4), so none. Will take `db`. */
export async function listCrafts(): Promise<ProgressCraft[]> {
  return [];
}

export interface ProgressPageData {
  itemsById: Map<string, ItemRow>;
  recipes: RecipeWithLines[];
  progress: Progress;
  /** Google Sheet mirror does not exist yet; null renders as an em dash. */
  lastSyncedAt: Date | null;
}

export async function loadProgressPageData(): Promise<ProgressPageData> {
  const db = await getDb();
  const itemRows = await listItems(db);
  const itemsById = new Map(itemRows.map((row) => [row.id, row]));
  const recipeRows = await listRecipes(db, itemsById);
  const [stockByItem, crafts] = await Promise.all([getStockByItem(db), listCrafts()]);
  const progress = computeProgress({
    recipes: recipeRows.map((recipe) => ({ eliteType: recipe.eliteType, lines: recipe.lines })),
    stockByItem,
    crafts,
  });
  return { itemsById, recipes: recipeRows, progress, lastSyncedAt: null };
}
