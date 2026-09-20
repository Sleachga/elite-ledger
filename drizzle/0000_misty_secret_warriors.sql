CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rarity" text NOT NULL,
	"kind" text NOT NULL,
	"elite_type" text,
	"icon" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "items_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "recipe_items" (
	"recipe_id" text NOT NULL,
	"item_id" text NOT NULL,
	"qty" bigint NOT NULL,
	CONSTRAINT "recipe_items_recipe_id_item_id_pk" PRIMARY KEY("recipe_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" text PRIMARY KEY NOT NULL,
	"elite_type" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "recipes_elite_type_unique" UNIQUE("elite_type")
);
--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;