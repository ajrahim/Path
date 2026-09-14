import { defineConfig } from "drizzle-kit";

// These paths are relative to the database workspace where db:generate runs.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/Schema.ts",
  out: "./drizzle",
  dbCredentials: { url: "./database.sqlite" },
});
