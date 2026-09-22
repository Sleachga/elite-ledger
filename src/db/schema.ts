import { sql } from "drizzle-orm";
import { bigint, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { EliteType, ItemKind, Rarity } from "@/catalog";

/** Tracked items: the vendored catalog, seeded from src/catalog/catalog.json. */
export const items = pgTable("items", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  rarity: text("rarity").$type<Rarity>().notNull(),
  kind: text("kind").$type<ItemKind>().notNull(),
  eliteType: text("elite_type").$type<EliteType>(),
  /** File name inside public/icons/. */
  icon: text("icon").notNull(),
  aliases: text("aliases")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  sortOrder: integer("sort_order").notNull().default(0),
});

/** One recipe per Elite type. Tree-capable later; v1 is a single flat level. */
export const recipes = pgTable("recipes", {
  id: text("id").primaryKey(),
  eliteType: text("elite_type").$type<EliteType>().notNull().unique(),
  name: text("name").notNull(),
});

/** Flat ingredient lines. qty is BIGINT because Silver Coin needs 10,000,000,000. */
export const recipeItems = pgTable(
  "recipe_items",
  {
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id),
    qty: bigint("qty", { mode: "bigint" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.recipeId, t.itemId] })],
);

/**
 * Admin settings: one row per key, the value as JSON. Read and written only
 * through src/modules/settings, which owns the known keys and their defaults.
 */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** Free text until Discord auth (#4) exists; then the admin's Discord id. */
  updatedBy: text("updated_by"),
});

export type ItemRow = typeof items.$inferSelect;
export type RecipeRow = typeof recipes.$inferSelect;
export type RecipeItemRow = typeof recipeItems.$inferSelect;
export type SettingRow = typeof settings.$inferSelect;
