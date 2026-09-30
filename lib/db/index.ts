import { Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Db = NeonDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __db?: Db };

function realDb(): Db {
  if (!globalForDb.__db) {
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    globalForDb.__db = drizzle({ client: pool, schema });
  }
  return globalForDb.__db;
}

/**
 * Lazily connected so `next build` never needs a database. The prototype trap keeps
 * drizzle's `is(db, PgDatabase)` checks (used by the Auth.js adapter) working.
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = realDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" && prop !== "constructor" ? value.bind(real) : value;
  },
  getPrototypeOf() {
    return Object.getPrototypeOf(realDb());
  },
});

export { schema };
