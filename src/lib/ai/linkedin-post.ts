import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import {
  LINKEDIN_FOLD_CHARS,
  LINKEDIN_MAX_CHARS,
  type PostVariant,
  type PostVerdict,
} from "@/lib/posts/types";

import {
  addUsage,
  describeAnthropicError,
  draftModel,
  getAnthropicClient,
  type TokenUsage,
} from "./client";

/**
 * Turns one published Daily Mover's outcome into LinkedIn copy — but only after
 * deciding whether there is anything honest to say.
 *
 * The verdict is the whole point of this module, and it is why the job is one
 * call that judges *before* it writes rather than a straight "write me a post"
 * prompt.
 *
 * The naive version ranks the archive by post-event return and claims credit for
 * the top of the list. On the real archive that is wrong in both directions:
 * only 25 of 56 movers continued in the direction they moved on the day, and
 * among the 31 that reversed are calls the note got exactly right — a stock that
 * fell 14% on an equipment failure and has since risen 27% vindicates a note
 * arguing the disruption was temporary. Sign of the return says nothing on its
 * own.
 *
 * It matters beyond tidiness. Vitti Capital is a Corporate Authorised
 * Representative under an AFSL, so a post asserting "we called this" about a
 * call the note never made is a misleading past-performance representation.
 * Hence: the model must quote the clause from the takeaway it is relying on, and
 * copy is generated only for `validated`.
 */

export type PostJudgement = {
  verdict: PostVerdict;
  /** Why, in one or two sentences. Shown to the reviewer. */
  verdictReason: string;
  /**
   * The clause from the mover's own takeaway that the price action bears out.
   * Empty when nothing in the note supports a claim.
   */
  evidenceQuote: string;
  /** Drafted variants. Empty unless `verdict` is `validated`. */
  variants: PostVariant[];
};

const POST_TOOL: Anthropic.Tool = {
  name: "assess_and_draft_post",
  description:
    "Judges whether a published Daily Mover's view has been borne out by subsequent price action, and — only if it has — drafts LinkedIn copy about it.",
  input_schema: {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        enum: ["validated", "mixed", "contradicted", "too_early"],
        description:
          "Whether the price action since publication supports WHAT THE NOTE ARGUED — not whether the price went up. " +
          "'validated': the takeaway's central view is what happened. " +
          "'mixed': part of the view held and part did not. " +
          "'contradicted': the price action runs against the note's view. " +
          "'too_early': too little time or too small a move to judge.",
      },
      verdictReason: {
        type: "string",
        description:
          "One or two sentences naming the specific claim in the takeaway and what the price action did about it. This is read by the analyst deciding whether to publish, so be concrete and be willing to say the call did not work.",
      },
      evidenceQuote: {
        type: "string",
        description:
          "The clause from the takeaway, quoted VERBATIM, that the price action bears out. This is the audit trail for the claim. If nothing in the takeaway supports a claim, return an empty string and do not select 'validated'.",
      },
      variants: {
        type: "array",
        maxItems: 3,
        description:
          "Two or three LinkedIn posts, each taking a different angle. Return an EMPTY ARRAY unless verdict is 'validated' — there is nothing to publish about a call that did not work, and a post is not the place to spin one.",
        items: {
          type: "object",
          properties: {
            angle: {
              type: "string",
              description:
                "Three to six words naming what this version leads with: 'the detail behind the headline', 'the risk we flagged', 'what the market missed'.",
            },
            text: {
              type: "string",
              description:
                `The post body. Under ${LINKEDIN_MAX_CHARS} characters and ideally 500-900 — long enough to say something, short enough to read. Do NOT include a disclaimer or any general advice warning; one is appended automatically.`,
            },
          },
          required: ["angle", "text"],
        },
      },
    },
    required: ["verdict", "verdictReason", "evidenceQuote", "variants"],
  },
};

const SYSTEM = `You write LinkedIn copy for Vitti Capital, an Australian equities research firm, about its own published "Daily Mover" notes — short institutional notes on ASX companies that moved sharply, explaining what happened and what it meant.

You will be given one published note and what the share price has done since. Your job has two parts, in order.

## PART 1 — JUDGE, HONESTLY

Decide whether the price action since publication bears out WHAT THE NOTE ARGUED. This is not the same question as "did the price go up".

Work from the takeaway's own words:
- A note on a stock that FELL, arguing the sell-off was overdone or the problem was temporary, is VALIDATED by a subsequent RISE.
- A note on a stock that FELL, arguing the outlook had deteriorated, is VALIDATED by a subsequent FURTHER FALL.
- A note on a stock that ROSE, arguing the re-rating was justified by the fundamentals, is VALIDATED by the price HOLDING OR RISING.
- A note on a stock that ROSE, arguing the market was now pricing in flawless execution — i.e. a note of caution — is VALIDATED by the price FALLING BACK, and CONTRADICTED by a further rise.

Note that many Daily Movers are explanatory rather than directional: they say what happened and what to watch, without arguing the price should go one way. If the takeaway made no directional claim, the verdict is 'too_early' or 'mixed', never 'validated' — a note that did not make a call cannot have been right about one.

Be willing to return 'contradicted'. An analyst is reading your reason to decide whether to put the firm's name behind it, and a false positive here is worse than a missed post.

## PART 2 — WRITE (only if validated)

If and only if the verdict is 'validated', draft two or three posts. Audience: professional investors, portfolio managers, founders and business heads. They are sceptical, time-poor, and can smell promotion.

VOICE — the firm's, not an individual's. "Our Daily Mover note flagged...", "We wrote at the time...", "Our view was...". Never "I".

WHAT GOOD LOOKS LIKE
- The first line must earn the second. LinkedIn hides everything past roughly ${LINKEDIN_FOLD_CHARS} characters behind "…see more", so open with the specific tension, not a preamble. "When X fell 11.5%, the headline was the earnings miss. It wasn't the reason." — not "We are pleased to share..."
- Lead with the INSIGHT, not the result. The interesting thing is what the note saw that the tape didn't; the return is the evidence, not the story. A post that is mostly a number reads as boasting and persuades nobody.
- Use the real figures given to you, exactly as given. Never round in your favour, never estimate, never add a figure you were not given.
- State the timeframe plainly: "in the N days since" or "since our note on <date>". A return with no period attached is meaningless and, in this context, misleading.
- Be specific about the mechanism. "The market priced the headline and re-priced the detail two weeks later" is worth reading; "our research adds value" is not.
- End on something transferable — the general lesson a PM can use on the next company, not a call to action.
- Concede what is uncertain if it is material. Acknowledging that the thesis is not fully played out reads as confidence, not weakness.

HARD RULES
- No recommendation, price target, or any suggestion to buy, sell or hold. This is explanatory commentary, not advice.
- No disclaimer or general advice warning — one is appended automatically, and writing your own would put unapproved compliance text in a published document.
- No hashtag spam. At most two, and only if they are genuinely the topic (#ASX, the sector). None is fine.
- No emoji.
- Do not imply the firm predicted the price level, only that it identified the cause or the risk. The claim must not exceed the quote in evidenceQuote.
- No claims about the firm's overall track record, hit rate, or other clients' returns. This post is about one note.`;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const VERDICTS: PostVerdict[] = [
  "validated",
  "mixed",
  "contradicted",
  "too_early",
];

export async function assessAndDraftPost(
  input: {
    ticker: string;
    companyName: string;
    sector: string | null;
    moveDate: string;
    catalystLabel: string;
    movePct: number;
    moveType: "intraday" | "closing";
    moveWindowLabel: string | null;
    reasonForMove: string;
    mainTakeaway: string;
    anchorPrice: number;
    currentPrice: number;
    postEventReturn: number;
    priceAsOf: Date | null;
    daysSince: number;
  },
  usage: TokenUsage,
): Promise<{ judgement: PostJudgement; usage: TokenUsage }> {
  const anthropic = getAnthropicClient();

  const direction = input.movePct > 0 ? "rose" : "fell";
  const sinceDirection = input.postEventReturn >= 0 ? "risen" : "fallen";

  const prompt = `THE PUBLISHED NOTE

Company:        ${input.companyName} (ASX: ${input.ticker})${input.sector ? ` — ${input.sector}` : ""}
Published:      ${input.moveDate}
Catalyst:       ${input.catalystLabel}
Move on the day: the shares ${direction} ${Math.abs(input.movePct).toFixed(2)}% (${input.moveWindowLabel ?? input.moveType})

What we said caused the move:
${input.reasonForMove}

Our takeaway at the time — this is the claim you are judging:
${input.mainTakeaway}

WHAT HAS HAPPENED SINCE

Price at publication:  A$${input.anchorPrice.toFixed(4)}
Price now:             A$${input.currentPrice.toFixed(4)}${input.priceAsOf ? ` (as at ${input.priceAsOf.toISOString().slice(0, 10)})` : ""}
Return since:          ${input.postEventReturn >= 0 ? "+" : ""}${input.postEventReturn.toFixed(2)}%
Elapsed:               ${input.daysSince} calendar days

So the shares have ${sinceDirection} ${Math.abs(input.postEventReturn).toFixed(2)}% since we published, over ${input.daysSince} days.

Judge whether that bears out what our takeaway argued, then draft the posts if — and only if — it does. Use the assess_and_draft_post tool.`;

  try {
    const response = await anthropic.messages.create({
      model: draftModel(),
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      tools: [POST_TOOL],
      tool_choice: { type: "tool", name: POST_TOOL.name },
    });

    const nextUsage = addUsage(usage, response.usage);

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === POST_TOOL.name,
    );
    if (!toolUse) {
      throw new Error("Claude did not return a post assessment.");
    }

    const raw = toolUse.input as Record<string, unknown>;
    const rawVerdict = asString(raw.verdict) as PostVerdict;
    const verdict = VERDICTS.includes(rawVerdict) ? rawVerdict : "too_early";

    const variants = (Array.isArray(raw.variants) ? raw.variants : [])
      .map((item) => {
        const entry = item as Record<string, unknown>;
        return {
          angle: asString(entry?.angle),
          text: asString(entry?.text),
        };
      })
      .filter((variant) => variant.text.length > 0)
      /**
       * Enforced here, not just asked for in the prompt. The whole design rests
       * on copy existing only for a call the note actually made — so a model
       * that returns a polished post alongside a `contradicted` verdict must not
       * be able to get that post in front of a reviewer.
       */
      .filter(() => verdict === "validated")
      .map((variant) => ({
        ...variant,
        text: variant.text.slice(0, LINKEDIN_MAX_CHARS),
      }));

    return {
      judgement: {
        verdict,
        verdictReason: asString(raw.verdictReason),
        evidenceQuote: asString(raw.evidenceQuote),
        variants,
      },
      usage: nextUsage,
    };
  } catch (error) {
    throw new Error(describeAnthropicError(error));
  }
}
