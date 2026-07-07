import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set (see .env.example)");
}

// All Rogue Raise tables live under a dedicated `rogue_raise` Postgres schema so
// they drop into WR's Neon DB at merge without colliding (PRD §3.1 / Appendix A).
export default defineConfig({
  schema: "./src/lib/rogue-raise/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["rogue_raise"],
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
