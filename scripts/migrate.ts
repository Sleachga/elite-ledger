import { createDb } from "@/db";
import { loadDotEnv } from "./env";

async function main() {
  loadDotEnv();
  const handle = await createDb();
  console.log(`migrate: ${handle.describe}`);
  try {
    await handle.migrate();
    console.log("migrate: up to date");
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
