/**
 * Applies a .sql file statement-by-statement, tolerating "already exists" so
 * it can be re-run safely.
 *
 *   npx tsx scripts/apply-sql.mts drizzle/0001_military_senator_kelly.sql
 *
 * Exists because `drizzle-kit push` crashes introspecting Supabase's `auth`
 * schema once `profiles.id` references `auth.users` (it fails parsing a CHECK
 * constraint it doesn't own). Generating the SQL and applying it directly keeps
 * the schema under review rather than under a black box.
 */
import fs from "node:fs";
import path from "node:path";

import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const file = process.argv[2];
if (!file) {
  console.error("usage: tsx scripts/apply-sql.mts <file.sql>");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

/**
 * A chunk counts as executable if any line is neither blank nor a `--` comment.
 * Testing only the FIRST line would drop every statement that has an
 * explanatory comment above it — which is most of them.
 */
function hasExecutableSql(chunk: string): boolean {
  return chunk
    .split("\n")
    .some((line) => line.trim() !== "" && !line.trim().startsWith("--"));
}

/** Strips leading comment lines so log lines show the statement, not its prose. */
function label(chunk: string): string {
  const firstSql = chunk
    .split("\n")
    .find((line) => line.trim() !== "" && !line.trim().startsWith("--"));
  return (firstSql ?? chunk).replace(/\s+/g, " ").slice(0, 78);
}

const raw = fs.readFileSync(path.resolve(file), "utf8");
const statements = raw
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(hasExecutableSql);

const IGNORABLE = new Set([
  "42710", // duplicate_object      — type/policy already exists
  "42P07", // duplicate_table       — table/index already exists
  "42701", // duplicate_column
  "42P16", // invalid_table_definition (constraint already present)
]);

const sql = postgres(url, { prepare: false, ssl: "require", max: 1 });

let applied = 0;
let skipped = 0;
let failed = 0;

for (const statement of statements) {
  const name = label(statement);
  try {
    await sql.unsafe(statement);
    applied += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    const message = (error as Error).message ?? "";
    if (IGNORABLE.has(code) || /already exists/i.test(message)) {
      skipped += 1;
      console.log(`  – ${name}  (already applied)`);
    } else {
      failed += 1;
      console.log(`  ✗ ${name}`);
      console.log(`      ${code} ${message}`);
    }
  }
}

console.log(
  `\n${applied} applied, ${skipped} already present, ${failed} failed.`,
);
await sql.end({ timeout: 5 });
process.exit(failed > 0 ? 1 : 0);
