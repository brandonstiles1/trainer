import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next.js uses .env.local; load that explicitly so drizzle-kit sees the same vars.
config({ path: ".env.local" });

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
});
