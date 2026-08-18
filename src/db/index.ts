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

/**
 * Reads DATABASE_URL, tolerating the two ways it usually arrives broken.
 *
 * Hosting dashboards store the value literally, so pasting a line copied out of
 * a .env file leaves the surrounding quotes attached — `"postgres://…"` — and
 * `new URL()` then fails on the leading quote. Stray whitespace and newlines
 * come from the same copy-paste. Both are stripped here rather than left to
 * produce an opaque parse error at request time.
 */
function readConnectionString(): string | null {
  const raw = process.env.DATABASE_URL;
  if (typeof raw !== "string") return null;

  const unquoted = raw
    .trim()
    // Only a *matching* pair, so a quote inside a password is untouched.
    .replace(/^(['"])([\s\S]*)\1$/, "$2")
    .trim();

  return unquoted === "" ? null : unquoted;
}

export function isDbConfigured(): boolean {
  return readConnectionString() !== null;
}

/**
 * Lazy so that importing this module never requires a live database -- the app
 * type-checks and builds before DATABASE_URL exists, and the error surfaces at
 * query time with something actionable.
 */
export function getDb(): Db {
  if (globalForDb.__db) return globalForDb.__db;

  const url = readConnectionString();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and add your Postgres connection string.",
    );
  }

  /**
   * Validated here so a malformed value produces a message we control.
   *
   * Critically, the message must never include the value: it contains the
   * database password, and an unguarded `new URL(url)` failure puts the whole
   * connection string into the error — which then lands in the hosting
   * provider's runtime logs for anyone with project access to read.
   */
  try {
    const parsed = new URL(url);
    if (!parsed.protocol.startsWith("postgres")) {
      throw new Error("wrong protocol");
    }
  } catch {
    throw new Error(
      "DATABASE_URL is not a valid Postgres URL. Check for surrounding quotes, " +
        "stray whitespace, or a password containing characters that need " +
        "percent-encoding. (The value is not shown here because it contains the " +
        "password.)",
    );
  }

  const sql =
    globalForDb.__sql ??
    postgres(url, {
      // Required for Supabase's transaction-mode pooler (port 6543), harmless
      // on a direct connection.
      prepare: false,
      /**
       * On Vercel every concurrent invocation is its own process with its own
       * pool, so a generous `max` multiplies: 10 × 50 warm lambdas would try to
       * open 500 connections and exhaust the Supabase pooler. One connection per
       * invocation is the correct shape for serverless — the pooler does the
       * pooling. Locally there's a single long-lived process, so a real pool
       * helps the parallel queries on the table page.
       */
      max: process.env.VERCEL ? 1 : 10,
      // Don't hold a connection open across an idle serverless instance.
      idle_timeout: 20,
      // Tokyo-hosted database from a US-default function region can be slow to
      // connect on a cold start.
      connect_timeout: 15,
    });
  const db = drizzle(sql, { schema });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__sql = sql;
    globalForDb.__db = db;
  }

  return db;
}
