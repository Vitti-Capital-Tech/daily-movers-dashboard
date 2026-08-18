/**
 * Creates the private reports bucket. Safe to re-run.
 *
 *   npm run storage:setup
 *
 * Private on purpose: report PDFs are only ever served through
 * /api/reports/[id], which checks the session first and then issues a signed URL
 * valid for 60 seconds.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

import {
  ALLOWED_REPORT_TYPES,
  MAX_REPORT_BYTES,
  REPORTS_BUCKET,
  formatBytes,
} from "../src/lib/storage.js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.\n" +
      "Supabase → Project Settings → API keys → service_role (secret).",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: existing, error: listError } =
  await supabase.storage.listBuckets();

if (listError) {
  console.error("Could not list buckets:", listError.message);
  process.exit(1);
}

const found = existing?.find((b) => b.name === REPORTS_BUCKET);

if (found) {
  console.log(`Bucket "${REPORTS_BUCKET}" already exists (public=${found.public}).`);
  if (found.public) {
    console.log("  Making it private…");
    const { error } = await supabase.storage.updateBucket(REPORTS_BUCKET, {
      public: false,
      fileSizeLimit: MAX_REPORT_BYTES,
      allowedMimeTypes: [...ALLOWED_REPORT_TYPES],
    });
    if (error) {
      console.error("  Failed:", error.message);
      process.exit(1);
    }
    console.log("  Now private.");
  }
} else {
  const { error } = await supabase.storage.createBucket(REPORTS_BUCKET, {
    public: false,
    fileSizeLimit: MAX_REPORT_BYTES,
    allowedMimeTypes: [...ALLOWED_REPORT_TYPES],
  });
  if (error) {
    console.error(`Could not create "${REPORTS_BUCKET}":`, error.message);
    process.exit(1);
  }
  console.log(
    `Created private bucket "${REPORTS_BUCKET}" (max ${formatBytes(MAX_REPORT_BYTES)}, PDF only).`,
  );
}
