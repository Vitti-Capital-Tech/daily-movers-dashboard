/**
 * Re-runs a stored draft through the current prompt, template and model.
 *
 *   npm run draft:regenerate -- 8          # dry run: says what it would do
 *   npm run draft:regenerate -- 8 --run    # spends real API money
 *
 * The new draft is written as `manual`, so it sits in the Mover Studio queue
 * beside the one it came from — which is the point: the two are read against
 * each other to see what a prompt change actually did. The subject, the screen
 * row, the rationale and the announcement list all come from the source draft,
 * so the code is the only thing that differs.
 *
 * Dry run by default because this is one of the few scripts in the repo that
 * costs money to run, and the cost depends on the corpus: the estimate below
 * is computed from the source draft's own measured token counts rather than
 * from a guess.
 */
import { eq } from "drizzle-orm";

import { getDb } from "../src/db";
import { moverDrafts } from "../src/db/schema";
import { draftModel } from "../src/lib/ai/client";
import { regenerateDraft } from "../src/lib/drafts/regenerate";

const [idArg, ...flags] = process.argv.slice(2);
const sourceDraftId = Number(idArg);
const commit = flags.includes("--run");

if (!Number.isInteger(sourceDraftId) || sourceDraftId <= 0) {
  console.error("usage: npm run draft:regenerate -- <draftId> [--run]");
  process.exit(1);
}

/** Opus 5 list rates, per million tokens. */
const RATES = { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 };

const [source] = await getDb()
  .select({
    ticker: moverDrafts.ticker,
    moveDate: moverDrafts.moveDate,
    status: moverDrafts.status,
    trigger: moverDrafts.trigger,
    model: moverDrafts.model,
    cacheWriteTokens: moverDrafts.cacheWriteTokens,
    outputTokens: moverDrafts.outputTokens,
  })
  .from(moverDrafts)
  .where(eq(moverDrafts.id, sourceDraftId))
  .limit(1);

if (!source) {
  console.error(`draft ${sourceDraftId} does not exist`);
  process.exit(1);
}

/**
 * The corpus is the bill, and it is the one quantity that carries over: the
 * same filings are read again. Output is estimated at half the source draft's,
 * because the report ceiling came down from nine pages to five.
 */
const corpus = source.cacheWriteTokens ?? 0;
const output = Math.round((source.outputTokens ?? 0) / 2);
const estimate =
  (corpus * RATES.cacheWrite +
    corpus * 2 * RATES.cacheRead +
    output * RATES.output) /
  1_000_000;

console.log(`source draft ${sourceDraftId}: ${source.ticker} ${source.moveDate}`);
console.log(`  status ${source.status} / trigger ${source.trigger} / model ${source.model}`);
console.log(`  corpus ${corpus.toLocaleString()} tok, output ${(source.outputTokens ?? 0).toLocaleString()} tok`);
console.log(`regenerating with ${draftModel()}`);
console.log(`estimated cost: ~$${estimate.toFixed(2)} (corpus re-read, output assumed halved)`);

if (!commit) {
  console.log("\ndry run — nothing spent. Add --run to regenerate for real.");
  process.exit(0);
}

console.log("\nrunning...");
const outcome = await regenerateDraft({
  sourceDraftId,
  actorEmail: "regenerate-script",
});

if (outcome.ok) {
  console.log(`done: draft ${outcome.draftId} (${outcome.ticker}) is pending review`);
  console.log("open /mover-studio to read it against the original");
} else {
  console.error(`failed: ${outcome.reason}`);
  process.exit(1);
}
