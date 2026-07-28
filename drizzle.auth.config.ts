import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set (see .env.example)");
}

/**
 * Better Auth's tables, kept in a SEPARATE config and migration folder from
 * everything else.
 *
 * They live in `public`, not `rogue_raise`, because PRD §12 says identity comes
 * from WR's existing auth layer rather than a duplicate store. Two configs
 * rather than one is what makes the merge mechanical: at merge, WR already has
 * these tables, so this config, `db/auth-schema.ts`, and `drizzle/auth/` are all
 * **deleted** — and because they never shared a migration folder with the
 * `rogue_raise` tables, deleting them leaves the real migrations untouched.
 */
export default defineConfig({
  schema: "./src/lib/rogue-raise/db/auth-schema.ts",
  out: "./drizzle/auth",
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: { url: process.env.DATABASE_URL },
  verbose: true,
  strict: true,
});
