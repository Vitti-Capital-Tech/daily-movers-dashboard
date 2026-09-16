import {
  classifyAnnouncement,
  isRoutineFiling,
  type ClassifiedAnnouncement,
} from "./filings";

import type { Announcement } from "./provider";

/**
 * Following today's announcement back to the documents it cites.
 *
 * ## The failure this exists to fix
 *
 * A Daily Mover on a settled buy-back dispute pulled a long, well-behaved
 * corpus -- fifteen price-sensitive filings, the annual report -- and missed the
 * single document the story turned on: the Buy-Back Booklet from five weeks
 * earlier. Today's announcement said, in terms, that the buy-back would continue
 * *on the terms set out in that booklet*. The booklet held the mechanics and the
 * calculation date; nothing else in the corpus did. Meanwhile the ranking, which
 * was recency plus a price-sensitive flag, spent its budget on old dividend
 * notifications and a general strategic review.
 *
 * Recency is a proxy for relevance and a poor one. A document that today's
 * release points at by name is relevant by construction -- the company has said
 * so -- and that is a signal available for free in text already being read.
 *
 * ## What this module does
 *
 * 1. `extractDocumentReferences` reads today's announcement text for pointers to
 *    earlier documents: booklets, notices of meeting, scheme documents,
 *    presentations, or a plain "our announcement dated 12 August".
 * 2. `resolveReferences` matches each pointer to a real filing in the company's
 *    history, by date where the reference gives one and by headline otherwise.
 * 3. `buildEventChain` reconstructs the thread today's event sits on, so the
 *    report can open at the beginning of the story rather than in the middle:
 *    proposal -> approval -> challenge -> regulator -> resolution.
 * 4. `rankHistoricalFilings` scores everything and spends the corpus budget on
 *    the evidence that earns it, instead of on whatever happened to be recent.
 *
 * Deliberately pure and client-safe: regexes and arrays, no fetching. The
 * pipeline in `lib/drafts/generate.ts` decides what to download.
 */

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|" +
  "jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "12 August 2025", "12 Aug 25", "12 August" (year inferred). */
const DAY_MONTH_YEAR = new RegExp(
  `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS})\\.?(?:\\s+(\\d{2,4}))?\\b`,
  "i",
);
/** "August 12, 2025". */
const MONTH_DAY_YEAR = new RegExp(
  `\\b(${MONTHS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{2,4}))?\\b`,
  "i",
);
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
/** Australian order: day first. */
const NUMERIC_DATE = /\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})\b/;

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const padded = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // Round-trips only for real calendar dates, so 31 February is rejected.
  const parsed = new Date(`${padded}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== padded
    ? null
    : padded;
}

/** Two-digit years in ASX prose are always this century. */
function fullYear(raw: string | undefined, fallbackYear: number): number {
  if (!raw) return fallbackYear;
  const value = Number(raw);
  if (raw.length <= 2) return 2000 + value;
  return value;
}

/**
 * The first date in a fragment, as ISO.
 *
 * `fallbackYear` fills in a bare "12 August". Announcements referring back
 * within the same year usually drop the year, and the reference is nearly always
 * backwards in time -- so a date that would land in the future is pulled back a
 * year rather than left to point at a document that cannot exist yet.
 */
export function parseDateFragment(
  fragment: string,
  fallbackYear: number,
  notAfter?: string,
): string | null {
  const isoMatch = ISO_DATE.exec(fragment);
  if (isoMatch) {
    return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const dmy = DAY_MONTH_YEAR.exec(fragment);
  if (dmy) {
    const month = MONTH_INDEX[dmy[2].toLowerCase().slice(0, 3)];
    const candidate = iso(fullYear(dmy[3], fallbackYear), month, Number(dmy[1]));
    return rollBackIfFuture(candidate, dmy[3], notAfter);
  }

  const mdy = MONTH_DAY_YEAR.exec(fragment);
  if (mdy) {
    const month = MONTH_INDEX[mdy[1].toLowerCase().slice(0, 3)];
    const candidate = iso(fullYear(mdy[3], fallbackYear), month, Number(mdy[2]));
    return rollBackIfFuture(candidate, mdy[3], notAfter);
  }

  const numeric = NUMERIC_DATE.exec(fragment);
  if (numeric) {
    return iso(
      fullYear(numeric[3], fallbackYear),
      Number(numeric[2]),
      Number(numeric[1]),
    );
  }

  return null;
}

function rollBackIfFuture(
  candidate: string | null,
  explicitYear: string | undefined,
  notAfter: string | undefined,
): string | null {
  if (!candidate || explicitYear || !notAfter) return candidate;
  if (candidate <= notAfter) return candidate;
  const year = Number(candidate.slice(0, 4)) - 1;
  return `${year}${candidate.slice(4)}`;
}

export type ReferenceKind =
  | "buy-back-booklet"
  | "scheme-booklet"
  | "notice-of-meeting"
  | "bidders-statement"
  | "targets-statement"
  | "explanatory-memorandum"
  | "prospectus"
  | "presentation"
  | "circular"
  | "announcement";

/**
 * Document types worth chasing when today's release names one.
 *
 * The headline pattern is how the reference is matched back to a filing; the
 * prose pattern is how it is spotted in today's text. They differ because a
 * company writes "the Buy-Back Booklet" in prose and lodges it as
 * "Off-Market Buy-Back Booklet" or "Buy-Back Booklet and Timetable".
 */
const REFERENCE_TYPES: {
  kind: ReferenceKind;
  prose: RegExp;
  headline: RegExp;
  /** Terms that must also appear in a candidate headline, if any. */
  label: string;
}[] = [
  {
    kind: "buy-back-booklet",
    prose: /buy[-\s]?back\s+(?:booklet|documentation|document|offer document)/gi,
    headline: /buy[-\s]?back\s+(?:booklet|documentation|offer|document)/i,
    label: "Buy-Back Booklet",
  },
  {
    kind: "scheme-booklet",
    prose: /scheme\s+(?:booklet|document)/gi,
    headline: /scheme\s+(?:booklet|document)/i,
    label: "Scheme Booklet",
  },
  {
    kind: "notice-of-meeting",
    prose:
      /notice\s+of\s+(?:annual\s+general\s+|general\s+|extraordinary\s+general\s+)?meeting/gi,
    headline:
      /notice\s+of\s+(?:annual\s+general\s+|general\s+|extraordinary\s+general\s+)?meeting/i,
    label: "Notice of Meeting",
  },
  {
    kind: "bidders-statement",
    prose: /(?:supplementary\s+)?bidder'?s\s+statement/gi,
    headline: /(?:supplementary\s+)?bidder'?s\s+statement/i,
    label: "Bidder's Statement",
  },
  {
    kind: "targets-statement",
    prose: /(?:supplementary\s+)?target'?s\s+statement/gi,
    headline: /(?:supplementary\s+)?target'?s\s+statement/i,
    label: "Target's Statement",
  },
  {
    kind: "explanatory-memorandum",
    prose: /explanatory\s+(?:memorandum|statement|booklet)/gi,
    headline: /explanatory\s+(?:memorandum|statement|booklet)/i,
    label: "Explanatory Memorandum",
  },
  {
    kind: "prospectus",
    prose: /(?:replacement\s+)?prospectus|product\s+disclosure\s+statement/gi,
    headline: /prospectus|product\s+disclosure\s+statement/i,
    label: "Prospectus",
  },
  {
    kind: "presentation",
    prose:
      /(?:investor|results|company|analyst|corporate|market)\s+presentation/gi,
    headline: /presentation/i,
    label: "Investor Presentation",
  },
  {
    kind: "circular",
    prose: /shareholder\s+circular|information\s+memorandum/gi,
    headline: /circular|information\s+memorandum/i,
    label: "Shareholder Circular",
  },
];

/**
 * A bare reference to an earlier release, which only counts when dated.
 *
 * "our announcement" on its own is not a pointer to anything findable -- a
 * results release mentions its own announcements constantly. With a date it is
 * precise, so the date is mandatory in the pattern rather than looked for
 * afterwards.
 */
const DATED_ANNOUNCEMENT = new RegExp(
  `\\b(?:asx\\s+)?(?:announcement|release|statement|update|disclosure)s?\\s+` +
    `(?:dated|of|on|released\\s+on|lodged\\s+on|made\\s+on|issued\\s+on|titled[^,.]{0,60}?\\s+dated)\\s+` +
    `((?:\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\.?(?:\\s+\\d{2,4})?)|` +
    `(?:(?:${MONTHS})\\.?\\s+\\d{1,2}(?:,?\\s+\\d{2,4})?)|` +
    `(?:\\d{4}-\\d{2}-\\d{2})|(?:\\d{1,2}[\\/.]\\d{1,2}[\\/.]\\d{2,4}))`,
  "gi",
);

/** "as announced on 12 August 2025", "announced to ASX on 5 May". */
const ANNOUNCED_ON = new RegExp(
  `\\bannounced\\s+(?:to\\s+(?:the\\s+)?asx\\s+)?on\\s+` +
    `((?:\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\.?(?:\\s+\\d{2,4})?)|` +
    `(?:(?:${MONTHS})\\.?\\s+\\d{1,2}(?:,?\\s+\\d{2,4})?))`,
  "gi",
);

export type DocumentReference = {
  kind: ReferenceKind;
  /** Human label for the prompt and the audit trail. */
  label: string;
  /** The sentence fragment the reference was found in, verbatim. */
  phrase: string;
  /** ISO date the reference named, when it named one. */
  date: string | null;
};

/** How far either side of a document mention to look for its date. */
const DATE_WINDOW = 140;

/**
 * Pointers to earlier documents, read out of today's announcement text.
 *
 * Case-insensitive and deduplicated on kind plus date, because a booklet is
 * typically referred to a dozen times in one release and they are all the same
 * pointer.
 */
export function extractDocumentReferences(
  text: string,
  options: { moveDate: string },
): DocumentReference[] {
  if (!text) return [];

  const fallbackYear = Number(options.moveDate.slice(0, 4));
  const found = new Map<string, DocumentReference>();

  const add = (reference: DocumentReference) => {
    const key = `${reference.kind}|${reference.date ?? "undated"}`;
    if (!found.has(key)) found.set(key, reference);
  };

  for (const type of REFERENCE_TYPES) {
    // `lastIndex` persists on a /g/ regex between calls; reset before reuse.
    type.prose.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = type.prose.exec(text)) !== null) {
      const start = Math.max(0, match.index - DATE_WINDOW);
      const window = text.slice(start, match.index + match[0].length + DATE_WINDOW);
      add({
        kind: type.kind,
        label: type.label,
        phrase: squeeze(window),
        date: parseDateFragment(
          // Prefer a date stated after the document name ("Booklet dated 12
          // August") over one before it, which usually belongs to another
          // clause entirely.
          text.slice(match.index, match.index + match[0].length + DATE_WINDOW),
          fallbackYear,
          options.moveDate,
        ) ?? parseDateFragment(window, fallbackYear, options.moveDate),
      });
    }
  }

  for (const pattern of [DATED_ANNOUNCEMENT, ANNOUNCED_ON]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const date = parseDateFragment(match[1], fallbackYear, options.moveDate);
      if (!date || date >= options.moveDate) continue;
      const start = Math.max(0, match.index - 60);
      add({
        kind: "announcement",
        label: "Earlier announcement",
        phrase: squeeze(
          text.slice(start, match.index + match[0].length + 60),
        ),
        date,
      });
    }
  }

  return [...found.values()];
}

function squeeze(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export type ResolvedReference = {
  reference: DocumentReference;
  /** The filing the reference points at, when one could be identified. */
  match: Announcement | null;
  /** Why it matched, for the audit trail. */
  because: string;
};

/** A date this far either side of the stated one still counts as the same document. */
const DATE_TOLERANCE_DAYS = 3;

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.abs(ms) / 86_400_000;
}

/**
 * Matches each reference to a filing in the company's history.
 *
 * Two signals, in this order:
 *
 * - **The date**, when the reference gave one. A company that says "the booklet
 *   dated 12 August" is naming a lodgement date, and a filing within a few days
 *   of it whose headline fits the document type is that document. The tolerance
 *   exists because the date printed on a document and the date it reaches the
 *   ASX platform are routinely a day or two apart.
 * - **The headline**, otherwise. "Buy-Back Booklet" mentioned without a date is
 *   still findable if the company lodged something called one.
 *
 * An unmatched reference is kept rather than discarded. It goes to the prompt as
 * "today's announcement refers to X, which is not in the corpus" -- which is a
 * more useful thing for the report to know than silence, and is the honest
 * answer when the referenced document predates the fetched window.
 */
export function resolveReferences(
  references: DocumentReference[],
  announcements: Announcement[],
  options: { moveDate: string },
): ResolvedReference[] {
  const earlier = announcements.filter((item) => item.date < options.moveDate);

  return references.map((reference) => {
    const type = REFERENCE_TYPES.find((entry) => entry.kind === reference.kind);

    const byType = type
      ? earlier.filter((item) => type.headline.test(item.headline))
      : earlier;

    if (reference.date) {
      const dated = (byType.length > 0 ? byType : earlier)
        .filter(
          (item) => daysBetween(item.date, reference.date as string) <= DATE_TOLERANCE_DAYS,
        )
        .sort(
          (a, b) =>
            daysBetween(a.date, reference.date as string) -
            daysBetween(b.date, reference.date as string),
        );

      if (dated[0]) {
        return {
          reference,
          match: dated[0],
          because:
            byType.length > 0
              ? `headline and date both match ${reference.date}`
              : `lodged ${dated[0].date}, within tolerance of the stated ${reference.date}`,
        };
      }
    }

    // Undated, or dated but nothing landed near it: fall back to the newest
    // filing of the right type, which is what "the Booklet" means when a
    // company says it without qualification.
    if (byType.length > 0 && type) {
      return {
        reference,
        match: byType[0],
        because: `headline matches ${type.label}`,
      };
    }

    return { reference, match: null, because: "no filing in the fetched window" };
  });
}

/**
 * Words too common in ASX headlines to say anything about what a filing is about.
 *
 * Without this, "Update" and "ASX" link every announcement a company has ever
 * made into one enormous chain.
 */
const TOPIC_STOPWORDS = new Set([
  "the", "and", "for", "of", "to", "in", "on", "at", "by", "a", "an", "is",
  "are", "as", "with", "from", "its", "their", "this", "that", "be", "will",
  "has", "have", "not", "no", "or", "it", "asx", "ltd", "limited", "plc",
  "announcement", "release", "update", "updates", "notice", "notification",
  "report", "results", "company", "companies", "shareholders", "shareholder",
  "securities", "security", "share", "shares", "market", "trading", "further",
  "new", "general", "letter", "presentation", "investor", "investors", "day",
  "half", "year", "quarterly", "monthly", "annual", "final", "interim",
  "appendix", "response", "statement", "change", "changes", "cleansing",
]);

/** Tokens of four or more letters that are not stopwords. */
export function topicTerms(text: string): Set<string> {
  const terms = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9-]+/)) {
    const token = raw.replace(/^-+|-+$/g, "");
    if (token.length < 4) continue;
    if (TOPIC_STOPWORDS.has(token)) continue;
    terms.add(token);
  }
  return terms;
}

function sharedTerms(a: Set<string>, b: Set<string>): string[] {
  const shared: string[] = [];
  for (const term of a) {
    if (b.has(term)) {
      shared.push(term);
      continue;
    }
    // "buy-back" vs "buyback", "proceeding" vs "proceedings".
    const squeezed = term.replace(/-/g, "");
    for (const other of b) {
      if (other.replace(/-/g, "") === squeezed) {
        shared.push(term);
        break;
      }
    }
  }
  return shared;
}

export type ChainEvent = {
  announcement: Announcement;
  /** Which of today's topic terms put it on the chain. */
  terms: string[];
  /** The earliest filing on the chain — where the story starts. */
  isOrigin: boolean;
};

/**
 * The thread today's announcement sits on, oldest first.
 *
 * A Daily Mover that opens at the resolution of a dispute without saying what
 * the dispute was is unreadable. The chain for the case this was built on runs
 * capital-management proposal -> EGM approval -> court challenge -> Takeovers
 * Panel application -> settlement today, and every step is in the company's own
 * filing history; nothing but recency ranking stopped them being read.
 *
 * Membership is topic-term overlap with today's headlines plus the labels of
 * whatever today's release referred back to, which is deliberately loose. The
 * chain is not the corpus -- it feeds the ranker as one signal among several,
 * and the report is shown the chain as a timeline regardless of which members
 * were read in full.
 */
export function buildEventChain(options: {
  todayHeadlines: string[];
  references: ResolvedReference[];
  announcements: Announcement[];
  moveDate: string;
  /** Chain members to return. The origin is always one of them. */
  limit?: number;
}): ChainEvent[] {
  const limit = options.limit ?? 8;

  /**
   * The seed is today's headline **plus the headlines of whatever today's
   * announcement referred back to**, and the second half is what makes the
   * chain reach the beginning of the story.
   *
   * Today's headline is written about today. "Settlement of Takeovers Panel
   * Proceedings and Buy-Back Update" shares not one word with "Capital
   * Management Proposal and Appointment of Antipodes" -- the thing that started
   * the whole affair four months earlier. Seeding from today alone found the
   * court filing and stopped there, which is the middle of the story.
   *
   * Pulling the vocabulary of the referenced documents in makes the match
   * transitive: today points at the May proposal, so "capital", "management",
   * "proposal" and "antipodes" join the seed, and the rest of that thread comes
   * with them. A document the company itself pointed at is the right place to
   * borrow vocabulary from.
   *
   * Generic labels are left out -- "Earlier announcement" would seed the word
   * "earlier" and match nothing useful.
   */
  const seed = topicTerms(
    [
      ...options.todayHeadlines,
      ...options.references
        .filter((entry) => entry.reference.kind !== "announcement")
        .map((entry) => entry.reference.label),
      ...options.references
        .map((entry) => entry.match?.headline)
        .filter((headline): headline is string => Boolean(headline)),
    ].join(" "),
  );
  if (seed.size === 0) return [];

  /**
   * A referenced document is on the chain whether or not its headline happens
   * to share a word with anything. The company said it was relevant; that is a
   * stronger signal than token overlap and must not be second-guessed by it.
   */
  const referencedIds = new Set(
    options.references
      .map((entry) => entry.match?.idsId)
      .filter((id): id is string => Boolean(id)),
  );

  const members: ChainEvent[] = [];
  for (const announcement of options.announcements) {
    if (announcement.date >= options.moveDate) continue;
    const isReferenced = referencedIds.has(announcement.idsId);
    if (isRoutineFiling(announcement) && !isReferenced) continue;
    const terms = sharedTerms(topicTerms(announcement.headline), seed);
    if (terms.length === 0 && !isReferenced) continue;
    members.push({
      announcement,
      terms: terms.length > 0 ? terms : ["referenced by today's announcement"],
      isOrigin: false,
    });
  }

  if (members.length === 0) return [];

  // Oldest first: a chain is read forwards.
  members.sort((a, b) =>
    a.announcement.date < b.announcement.date
      ? -1
      : a.announcement.date > b.announcement.date
        ? 1
        : 0,
  );
  members[0].isOrigin = true;

  if (members.length <= limit) return members;

  /**
   * Too many members: keep the shape of the story rather than a window of it.
   * The origin says what started it, the most recent say where it got to, and
   * the strongest-matching middle entries are the milestones in between.
   */
  const origin = members[0];
  const recent = members.slice(-Math.ceil((limit - 1) / 2));
  const middle = members.slice(1, members.length - recent.length);

  // Referenced documents survive trimming ahead of merely well-matching ones.
  const middlePool = middle
    .sort((a, b) => {
      const aRef = referencedIds.has(a.announcement.idsId) ? 1 : 0;
      const bRef = referencedIds.has(b.announcement.idsId) ? 1 : 0;
      if (aRef !== bRef) return bRef - aRef;
      return b.terms.length - a.terms.length;
    })
    .slice(0, Math.max(0, limit - 1 - recent.length));

  return [origin, ...middlePool, ...recent].sort((a, b) =>
    a.announcement.date < b.announcement.date
      ? -1
      : a.announcement.date > b.announcement.date
        ? 1
        : 0,
  );
}

export type RankedFiling = ClassifiedAnnouncement & {
  score: number;
  /** Why it scored what it did, in the draft's audit trail and the prompt. */
  reasons: string[];
};

const SCORE = {
  referenced: 1000,
  chainOrigin: 60,
  chain: 40,
  legalRegulatoryWhenTodayIs: 45,
  legalRegulatory: 15,
  accounts: 35,
  priceSensitive: 10,
  perSharedTerm: 8,
  sharedTermCap: 32,
  recencyMax: 12,
  routine: -500,
} as const;

/**
 * Chooses and orders the company's earlier filings by how much they explain
 * today.
 *
 * Replaces a pure recency-plus-flag ordering. The weights are ordinal rather
 * than tuned: a document today's announcement names beats everything, because
 * the company has told us it matters; the chain that leads to today beats
 * general history; the accounts are always worth one slot; and routine
 * paperwork is excluded unless referenced, which is the one thing that can pull
 * it back.
 *
 * `target` counts documents read in full. Referenced documents are admitted
 * *above* the target rather than competing for it -- there are rarely more than
 * two or three, and dropping the one document today's release points at in
 * order to respect a count is the exact failure this replaced.
 */
export function rankHistoricalFilings(options: {
  announcements: Announcement[];
  moveDate: string;
  todayHeadlines: string[];
  references: ResolvedReference[];
  chain: ChainEvent[];
  todayIsLegalRegulatory: boolean;
  target: number;
  /** Minimum accounts documents (annual/half-year/quarterly) to keep. */
  accountsTarget: number;
  seriesKeep?: number;
}): { keep: RankedFiling[]; dropped: RankedFiling[] } {
  const seriesKeep = options.seriesKeep ?? 1;

  const referencedIds = new Set(
    options.references
      .map((entry) => entry.match?.idsId)
      .filter((id): id is string => Boolean(id)),
  );
  const chainById = new Map(
    options.chain.map((event) => [event.announcement.idsId, event]),
  );

  const todayTerms = topicTerms(options.todayHeadlines.join(" "));

  const dates = options.announcements
    .filter((item) => item.date < options.moveDate)
    .map((item) => Date.parse(`${item.date}T00:00:00Z`));
  const oldest = dates.length > 0 ? Math.min(...dates) : 0;
  const newest = dates.length > 0 ? Math.max(...dates) : 1;
  const span = Math.max(newest - oldest, 1);

  const scored: RankedFiling[] = options.announcements
    .filter((item) => item.date < options.moveDate)
    .map((item) => {
      const classified = classifyAnnouncement(item);
      const reasons: string[] = [];
      let score = 0;

      if (referencedIds.has(item.idsId)) {
        score += SCORE.referenced;
        reasons.push("referenced by today's announcement");
      }

      const chainEvent = chainById.get(item.idsId);
      if (chainEvent) {
        score += chainEvent.isOrigin ? SCORE.chainOrigin : SCORE.chain;
        reasons.push(chainEvent.isOrigin ? "start of the event chain" : "event chain");
      }

      if (classified.filingClass === "legal-regulatory") {
        score += options.todayIsLegalRegulatory
          ? SCORE.legalRegulatoryWhenTodayIs
          : SCORE.legalRegulatory;
        reasons.push("legal / regulatory");
      }

      if (classified.filingClass === "background") {
        score += SCORE.accounts;
        reasons.push("accounts");
      }

      if (classified.filingClass === "routine") {
        score += SCORE.routine;
        reasons.push("routine paperwork");
      }

      if (item.isPriceSensitive) score += SCORE.priceSensitive;

      const shared = sharedTerms(topicTerms(item.headline), todayTerms);
      if (shared.length > 0) {
        score += Math.min(
          shared.length * SCORE.perSharedTerm,
          SCORE.sharedTermCap,
        );
        reasons.push(`shares "${shared.slice(0, 3).join('", "')}" with today`);
      }

      const age = Date.parse(`${item.date}T00:00:00Z`) - oldest;
      score += (age / span) * SCORE.recencyMax;

      return { ...classified, score, reasons };
    });

  scored.sort((a, b) => b.score - a.score);

  const keep: RankedFiling[] = [];
  const dropped: RankedFiling[] = [];
  const seenPerSeries = new Map<string, number>();
  let accountsKept = 0;

  for (const item of scored) {
    const isReferenced = referencedIds.has(item.idsId);

    // Series still collapse to their newest member, whatever they score --
    // except a referenced one, which is a specific document, not a step.
    if (item.seriesKey && !isReferenced) {
      const seen = seenPerSeries.get(item.seriesKey) ?? 0;
      if (seen >= seriesKeep) {
        dropped.push(item);
        continue;
      }
      seenPerSeries.set(item.seriesKey, seen + 1);
    }

    if (item.filingClass === "routine" && !isReferenced) {
      dropped.push(item);
      continue;
    }

    if (isReferenced) {
      keep.push(item);
      continue;
    }

    if (item.filingClass === "background") {
      if (accountsKept >= options.accountsTarget) {
        dropped.push(item);
        continue;
      }
      accountsKept += 1;
      keep.push(item);
      continue;
    }

    if (keep.length >= options.target + referencedIds.size + accountsKept) {
      dropped.push(item);
      continue;
    }

    keep.push(item);
  }

  // Read newest-first, as the prompt's history block has always been ordered.
  keep.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return { keep, dropped };
}
