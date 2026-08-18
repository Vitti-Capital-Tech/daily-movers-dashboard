/**
 * Idempotent seed: run it as many times as you like.
 *
 *   npm run db:seed
 */
import { config } from "dotenv";
import { eq } from "drizzle-orm";

config({ path: ".env.local" });

import { getDb } from "./index";
import { analysts, catalysts, companies, dailyMovers } from "./schema";

/** The closed catalyst list. Order here is the order shown in the dropdown. */
const CATALYSTS = [
  ["earnings_result", "Earnings Result"],
  ["quarterly_update", "Quarterly Update"],
  ["trading_update", "Trading Update"],
  ["guidance_change", "Guidance Change"],
  ["contract_customer_win", "Contract / Customer Win"],
  ["capital_raise", "Capital Raise"],
  ["ma_takeover", "M&A / Takeover"],
  ["capital_management", "Dividend / Buyback / Capital Management"],
  ["clinical_trial_result", "Clinical / Trial Result"],
  ["exploration_drilling_result", "Exploration / Drilling Result"],
  ["resource_reserve_update", "Resource / Reserve Update"],
  ["regulatory_approval", "Regulatory / Approval"],
  ["project_milestone", "Project / Development Milestone"],
  ["management_board_change", "Management / Board Change"],
  ["strategic_operational_update", "Strategic / Operational Update"],
  ["other", "Other"],
] as const;

const ANALYSTS = ["Prasham Doshi"];

const COMPANIES = [
  { ticker: "JBH", name: "JB Hi-Fi Limited", sector: "Consumer Discretionary" },
  { ticker: "SPZ", name: "Smart Parking Limited", sector: "Industrials" },
];

async function main() {
  const db = getDb();

  console.log("Seeding catalysts...");
  for (const [index, [slug, label]] of CATALYSTS.entries()) {
    await db
      .insert(catalysts)
      .values({ slug, label, sortOrder: index })
      .onConflictDoUpdate({
        target: catalysts.slug,
        set: { label, sortOrder: index },
      });
  }

  console.log("Seeding analysts...");
  for (const name of ANALYSTS) {
    await db
      .insert(analysts)
      .values({ name })
      .onConflictDoNothing({ target: analysts.name });
  }

  console.log("Seeding companies...");
  for (const company of COMPANIES) {
    await db
      .insert(companies)
      .values(company)
      .onConflictDoUpdate({
        target: companies.ticker,
        set: { name: company.name, sector: company.sector },
      });
  }

  // --- Sample movers, transcribed from the two source PDFs ---------------

  const catalystId = async (slug: string) => {
    const [row] = await db
      .select({ id: catalysts.id })
      .from(catalysts)
      .where(eq(catalysts.slug, slug));
    if (!row) throw new Error(`Missing catalyst: ${slug}`);
    return row.id;
  };

  const companyId = async (ticker: string) => {
    const [row] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.ticker, ticker));
    if (!row) throw new Error(`Missing company: ${ticker}`);
    return row.id;
  };

  const [analyst] = await db
    .select({ id: analysts.id })
    .from(analysts)
    .where(eq(analysts.name, "Prasham Doshi"));

  const samples = [
    {
      companyId: await companyId("JBH"),
      // NOTE: open question. JBH *announced* FY26 results, but the sell-off
      // followed the weak July FY27 trading update ("Why Shares Actually
      // Fell"). Seeded as the price-moving event; change to
      // "earnings_result" if the convention should be the announcement.
      catalystId: await catalystId("trading_update"),
      analystId: analyst?.id ?? null,
      moveDate: "2026-08-17",
      // Negative: the PDF prints "~11.5%" with the direction in the headline
      // ("Shares Fall as Much as...").
      movePct: -11.5,
      moveType: "intraday" as const,
      moveWindowLabel: "Intraday",
      reasonForMove:
        "Record FY26 results were overshadowed by a much weaker start to FY27. The July 2026 trading update showed JB Hi-Fi Australia sales -0.5% (comp -1.4%), The Good Guys -1.7% and e&s -2.7% (comp -4.0%), after comparable sales growth had already slowed through H2 FY26.",
      mainTakeaway:
        "Strong business and balance sheet — record FY26 sales of $11.06b, underlying NPAT of $489.9m and a 337c dividend. But JB Hi-Fi Australia has gone from +6.0% sales growth in Q1 FY26 to -0.5% in July FY27. FY27 depends on whether promotional periods can bring sales back into growth without too much margin pressure.",
      reportPrice: null,
      asxAnnouncementUrl: null,
    },
    {
      companyId: await companyId("SPZ"),
      catalystId: await catalystId("earnings_result"),
      analystId: analyst?.id ?? null,
      moveDate: "2026-08-18",
      movePct: 20.6,
      moveType: "intraday" as const,
      // The PDF says "MORNING TRADE" -- mapped to intraday, wording kept here.
      moveWindowLabel: "Morning Trade",
      reasonForMove:
        "Record FY26 result — revenue $126.0m (+63%), adjusted EBITDA $30.8m (+50%) and underlying NPATA $11.4m (+73%) — announced alongside a new $5 million on-market share buy-back starting 1 September.",
      mainTakeaway:
        "Record FY26 across revenue, earnings, cash flow and sites, plus a $5m buy-back. SPZ enters FY27 with a larger US business and continued site growth. The key question is whether underlying growth can offset a lower UK debt-recovery benefit, falling from ~$7.0m in FY26 to ~$5.0m in FY27.",
      reportPrice: null,
      asxAnnouncementUrl: null,
    },
  ];

  console.log("Seeding sample daily movers...");
  for (const sample of samples) {
    const existing = await db
      .select({ id: dailyMovers.id })
      .from(dailyMovers)
      .where(eq(dailyMovers.companyId, sample.companyId));

    if (existing.some(() => true)) {
      console.log(`  - skipped (already has rows): company ${sample.companyId}`);
      continue;
    }
    await db.insert(dailyMovers).values(sample);
  }

  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
