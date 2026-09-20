import { defineConfig } from "drizzle-kit";

// Only `drizzle-kit generate` is used in this repo (migrations are applied by
// scripts/migrate.ts through the same db module the app uses), so no
// connection details are needed here.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
