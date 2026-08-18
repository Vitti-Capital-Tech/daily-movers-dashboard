import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Cached across hot reloads in dev so we don't leak a connection pool on every
 * file change.
 */
const globalForDb = globalThis as unknown as {
  __sql?: ReturnType<typeof postgres>;
  __db?: Db;
};

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Lazy so that importing this module never requires a live database -- the app
 * type-checks and builds before DATABASE_URL exists, and the error surfaces at
 * query time with something actionable.
 */
export function getDb(): Db {
  if (globalForDb.__db) return globalForDb.__db;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and add your Postgres connection string.",
    );
  }

  const sql =
    globalForDb.__sql ??
    postgres(url, {
      // Required for Supabase's transaction-mode pooler (port 6543), harmless
      // on a direct connection.
      prepare: false,
      max: 10,
    });
  const db = drizzle(sql, { schema });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__sql = sql;
    globalForDb.__db = db;
  }

  return db;
}
