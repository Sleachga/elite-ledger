import { and, eq, notInArray, sql } from "drizzle-orm";
import { catalog, recipes as recipeDefs } from "@/catalog";
import type { Db } from "./index";
import { items, recipeItems, recipes } from "./schema";

export interface SeedSummary {
  items: number;
  recipes: number;
  recipeItems: number;
}

/**
 * Upsert the vendored catalog and the four Elite recipes. Idempotent: rerun
 * after editing src/catalog/*.json and rows are updated in place; recipe
 * lines that were removed from a recipe are deleted.
 */
export async function seedCatalog(db: Db): Promise<SeedSummary> {
  return db.transaction(async (tx) => {
    await tx
      .insert(items)
      .values(
        catalog.map((item, index) => ({
          id: item.id,
          name: item.name,
          rarity: item.rarity,
          kind: item.kind,
          eliteType: item.eliteType ?? null,
          icon: item.icon,
          aliases: item.aliases,
          sortOrder: index,
        })),
      )
      .onConflictDoUpdate({
        target: items.id,
        set: {
          name: sql`excluded.name`,
          rarity: sql`excluded.rarity`,
          kind: sql`excluded.kind`,
          eliteType: sql`excluded.elite_type`,
          icon: sql`excluded.icon`,
          aliases: sql`excluded.aliases`,
          sortOrder: sql`excluded.sort_order`,
        },
      });

    let lineCount = 0;
    for (const def of recipeDefs) {
      await tx
        .insert(recipes)
        .values({ id: def.id, eliteType: def.eliteType, name: def.name })
        .onConflictDoUpdate({
          target: recipes.id,
          set: { eliteType: sql`excluded.elite_type`, name: sql`excluded.name` },
        });

      await tx
        .insert(recipeItems)
        .values(def.lines.map((line) => ({ recipeId: def.id, itemId: line.itemId, qty: line.qty })))
        .onConflictDoUpdate({
          target: [recipeItems.recipeId, recipeItems.itemId],
          set: { qty: sql`excluded.qty` },
        });

      await tx.delete(recipeItems).where(
        and(
          eq(recipeItems.recipeId, def.id),
          notInArray(
            recipeItems.itemId,
            def.lines.map((line) => line.itemId),
          ),
        ),
      );
      lineCount += def.lines.length;
    }

    return { items: catalog.length, recipes: recipeDefs.length, recipeItems: lineCount };
  });
}
