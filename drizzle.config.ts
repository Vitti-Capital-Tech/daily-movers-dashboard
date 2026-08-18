import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Only manage the public schema — `auth.users` is Supabase's, referenced by
  // profiles.id but never created or altered by us.
  schemaFilter: ["public"],
  // Stops drizzle-kit trying to manage Supabase's built-in roles
  // (anon, authenticated, service_role, …).
  entities: {
    roles: { provider: "supabase" },
  },
  strict: true,
  verbose: true,
});
