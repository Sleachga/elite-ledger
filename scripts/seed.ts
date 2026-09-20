import { createDb } from "@/db";
import { seedCatalog } from "@/db/seed";
import { loadDotEnv } from "./env";

async function main() {
  loadDotEnv();
  const handle = await createDb();
  console.log(`seed: ${handle.describe}`);
  try {
    await handle.migrate();
    const summary = await seedCatalog(handle.db);
    console.log(
      `seed: upserted ${summary.items} items, ${summary.recipes} recipes, ${summary.recipeItems} recipe lines`,
    );
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
