import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

// Single DATABASE_URL is the only DB config seam: local Postgres in dev, Neon at
// merge, no code change (PRD §3.1). HMR-safe singleton so `next dev` doesn't open
// a new pool on every hot reload.
const globalForDb = globalThis as unknown as {
  rogueRaiseSql?: ReturnType<typeof postgres>;
};

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set (see .env.example)");
  }
  return url;
}

const client = globalForDb.rogueRaiseSql ?? postgres(getConnectionString());
if (process.env.NODE_ENV !== "production") {
  globalForDb.rogueRaiseSql = client;
}

export const db = drizzle(client, { schema });
export { schema };
