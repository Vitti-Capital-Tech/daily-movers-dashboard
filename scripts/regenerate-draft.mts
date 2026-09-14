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
import { estimateDraftCostUsd } from "../src/lib/drafts/types";

const [idArg, ...flags] = process.argv.slice(2);
const sourceDraftId = Number(idArg);
const commit = flags.includes("--run");

if (!Number.isInteger(sourceDraftId) || sourceDraftId <= 0) {
  console.error("usage: npm run draft:regenerate -- <draftId> [--run]");
  process.exit(1);
}

/**
 * The estimate is priced by the model that will actually run — which is not
 * necessarily the one the source draft used, since the point of a regenerate is
 * often that something changed. `estimateDraftCostUsd` owns the rate table;
 * passing `model: null` prices at the current tier.
 */
const priceAtCurrentTier = (usage: {
  cacheWriteTokens: number;
  outputTokens: number;
}) =>
  estimateDraftCostUsd({
    inputTokens: 0,
    cacheWriteTokens: usage.cacheWriteTokens,
    cacheReadTokens: usage.cacheWriteTokens * 2,
    outputTokens: usage.outputTokens,
    model: null,
  }) ?? 0;

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
 * The corpus is the bill, and it is the one quantity that carries over exactly:
 * the same filings are read again. Output is taken from the source draft
 * unchanged, which over-estimates when re-running a draft written before the
 * page ceiling came down and is right for everything since — the direction an
 * estimate shown before spending money should err in.
 */
const corpus = source.cacheWriteTokens ?? 0;
const output = source.outputTokens ?? 0;
const estimate = priceAtCurrentTier({
  cacheWriteTokens: corpus,
  outputTokens: output,
});

console.log(`source draft ${sourceDraftId}: ${source.ticker} ${source.moveDate}`);
console.log(`  status ${source.status} / trigger ${source.trigger} / model ${source.model}`);
console.log(`  corpus ${corpus.toLocaleString()} tok, output ${(source.outputTokens ?? 0).toLocaleString()} tok`);
console.log(`regenerating with ${draftModel()}`);
console.log(`estimated cost: ~$${estimate.toFixed(2)} (the same corpus, re-read)`);

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
