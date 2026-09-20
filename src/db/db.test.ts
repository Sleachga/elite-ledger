import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalog } from "@/catalog";
import { createDb, type DbHandle } from "./index";
import { listItems, listRecipes } from "./queries";
import { seedCatalog } from "./seed";

// In-memory PGlite: proves the committed migrations + seed work end to end.
describe("migrations + seed", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = await createDb({ memory: true });
    await handle.migrate();
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
  });

  it("seeds the catalog and recipes idempotently", async () => {
    const first = await seedCatalog(handle.db);
    const second = await seedCatalog(handle.db);
    expect(second).toEqual(first);
    expect(first).toEqual({ items: catalog.length, recipes: 4, recipeItems: 4 * 12 });

    const items = await listItems(handle.db);
    expect(items.map((i) => i.id)).toEqual(catalog.map((i) => i.id));

    const recipes = await listRecipes(handle.db, new Map(items.map((i) => [i.id, i])));
    expect(recipes.map((r) => r.id)).toEqual(["bracelet", "earring", "necklace", "ring"]);
    for (const recipe of recipes) {
      expect(recipe.lines).toHaveLength(12);
      expect(recipe.lines.filter((l) => !l.shared)).toHaveLength(1);
      const silver = recipe.lines.find((l) => l.itemId === "silver-coin");
      expect(silver?.qty).toBe(10_000_000_000n);
    }
  });
});
