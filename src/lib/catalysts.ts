/**
 * The closed catalyst vocabulary, in one place.
 *
 * It was already written out twice — once as the seed's `CATALYSTS` list, once
 * as an `enum` inside the PDF extraction tool schema in `lib/ai/anthropic.ts` —
 * and the drafting pipeline would have made it three. Two copies of a closed
 * list drift: adding a catalyst to the seed without adding it to the tool schema
 * gives you a model that can never choose it, silently, with everything falling
 * into `other`.
 *
 * Client-safe (no imports), because the review UI shows the catalyst label
 * beside a draft.
 */

export const CATALYST_SLUGS = [
  "earnings_result",
  "quarterly_update",
  "trading_update",
  "guidance_change",
  "contract_customer_win",
  "capital_raise",
  "ma_takeover",
  "capital_management",
  "clinical_trial_result",
  "exploration_drilling_result",
  "resource_reserve_update",
  "regulatory_approval",
  "project_milestone",
  "management_board_change",
  "strategic_operational_update",
  "other",
] as const;

export type CatalystSlug = (typeof CATALYST_SLUGS)[number];

/** Display labels, matching what the seed writes into `catalysts.label`. */
export const CATALYST_LABELS: Record<CatalystSlug, string> = {
  earnings_result: "Earnings Result",
  quarterly_update: "Quarterly Update",
  trading_update: "Trading Update",
  guidance_change: "Guidance Change",
  contract_customer_win: "Contract / Customer Win",
  capital_raise: "Capital Raise",
  ma_takeover: "M&A / Takeover",
  capital_management: "Dividend / Buyback / Capital Management",
  clinical_trial_result: "Clinical / Trial Result",
  exploration_drilling_result: "Exploration / Drilling Result",
  resource_reserve_update: "Resource / Reserve Update",
  regulatory_approval: "Regulatory / Approval",
  project_milestone: "Project / Development Milestone",
  management_board_change: "Management / Board Change",
  strategic_operational_update: "Strategic / Operational Update",
  other: "Other",
};

export function isCatalystSlug(value: unknown): value is CatalystSlug {
  return (
    typeof value === "string" &&
    (CATALYST_SLUGS as readonly string[]).includes(value)
  );
}
