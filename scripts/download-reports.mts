import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.DATABASE_URL;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

if (!databaseUrl) {
  console.error("Missing DATABASE_URL in .env.local");
  process.exit(1);
}

const REPORTS_BUCKET = "daily-mover-reports";
const OUTPUT_DIR = path.resolve(process.cwd(), "all-daily-reports");

async function main() {
  console.log("🔍 Fetching all daily mover reports from database...");

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const supabase = createClient(supabaseUrl!, supabaseServiceKey!);
  const sql = postgres(databaseUrl!, { max: 1 });

  try {
    const movers = await sql`
      SELECT 
        dm.id,
        dm.move_date,
        dm.report_storage_path,
        dm.report_url,
        c.ticker,
        c.name as company_name
      FROM daily_movers dm
      JOIN companies c ON dm.company_id = c.id
      WHERE dm.report_storage_path IS NOT NULL OR dm.report_url IS NOT NULL
      ORDER BY dm.move_date DESC, c.ticker ASC
    `;

    console.log(`📋 Found ${movers.length} records with report attachments.`);

    if (movers.length === 0) {
      console.log("No reports found in the database.");
      return;
    }

    let successCount = 0;

    for (const mover of movers) {
      const dateStr = typeof mover.move_date === "string" 
        ? mover.move_date 
        : new Date(mover.move_date).toISOString().slice(0, 10);

      const ticker = mover.ticker;
      const cleanName = mover.company_name
        .replace(/[^a-zA-Z0-9]/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 35);

      const fileName = `${dateStr}_${ticker}_${cleanName}.pdf`;
      const targetFilePath = path.join(OUTPUT_DIR, fileName);

      if (mover.report_storage_path) {
        process.stdout.write(`⬇️  Downloading ${ticker} (${dateStr})... `);
        const { data, error } = await supabase.storage
          .from(REPORTS_BUCKET)
          .download(mover.report_storage_path);

        if (error || !data) {
          console.log(`❌ Failed: ${error?.message || "unknown error"}`);
          continue;
        }

        const buffer = Buffer.from(await data.arrayBuffer());
        fs.writeFileSync(targetFilePath, buffer);
        console.log(`✅ Saved (${(buffer.byteLength / 1024).toFixed(1)} KB)`);
        successCount++;
      } else if (mover.report_url) {
        process.stdout.write(`🌐 Fetching external URL for ${ticker} (${dateStr})... `);
        try {
          const res = await fetch(mover.report_url);
          if (!res.ok) {
            console.log(`❌ HTTP ${res.status}`);
            continue;
          }
          const buffer = Buffer.from(await res.arrayBuffer());
          fs.writeFileSync(targetFilePath, buffer);
          console.log(`✅ Saved (${(buffer.byteLength / 1024).toFixed(1)} KB)`);
          successCount++;
        } catch (err) {
          console.log(`❌ Error: ${err instanceof Error ? err.message : "failed"}`);
        }
      }
    }

    console.log("\n==========================================");
    console.log(`🎉 Download completed!`);
    console.log(`📁 Folder: ${OUTPUT_DIR}`);
    console.log(`📄 Total reports downloaded: ${successCount} / ${movers.length}`);
    console.log("==========================================");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
