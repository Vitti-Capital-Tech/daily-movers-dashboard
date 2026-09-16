import { parseDateFragment } from "./references";

/**
 * Two things a corpus reliably contains and a report reliably misses.
 *
 * Both were found the same way: by reading a draft beside the announcement it
 * came from and noting what the model had walked past.
 *
 * **Personnel.** A settlement announcement carried an entire board
 * reconstruction -- two directors joining immediately, four expected to leave
 * after completion, one becoming interim Chairman -- and the draft mentioned
 * none of it, because the headline was about a buy-back and the names were
 * eleven paragraphs down. Board and management change is one of the few things
 * that is always material and is almost never the headline.
 *
 * **Dates.** The same announcement had a buy-back closing on 21 September and
 * withdrawals running to 24 September. A reader skimming for "the date" finds
 * one of them and states it as the date. Two dates three days apart in one
 * document are nearly always two different deadlines, and collapsing them is a
 * factual error that reads perfectly fluently.
 *
 * Neither is a judgement call, so neither is left to the model to notice. These
 * are deterministic extractors: they surface the sentences and the dates as
 * evidence, with the source document named, and the prompt does the reasoning.
 * Nothing here decides what is true -- a regex that guessed at who was appointed
 * to what would be inventing findings, which is worse than missing them.
 */

export type SignalSource = {
  /** Headline of the document the text came from. */
  headline: string;
  text: string;
};

/** Sentence-ish split. ASX PDFs arrive with page markers and hard wraps. */
function sentences(text: string): string[] {
  return text
    .replace(/---\s*page\s*\d+\s*---/gi, " ")
    .split(/(?<=[.;!?])\s+|\n{2,}/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 25 && part.length <= 600);
}

/**
 * Built with `new RegExp` rather than a literal purely for legibility: these
 * alternations are long, and a literal cannot be broken across lines.
 */
const PERSONNEL_ACTIONS = new RegExp(
  "\\b(appoint(?:ed|ment|s|ing)?|resign(?:ed|ation|s|ing)?|retire(?:d|ment|s|ing)?" +
    "|step(?:ping|s|ped)?\\s+(?:down|aside)|depart(?:ure|ing|s|ed)?|join(?:ing|s|ed)?" +
    "|cease(?:d|s)?\\s+(?:to|as)|vacat(?:e|ed|ing)|succeed(?:s|ed|ing)?|promot(?:ed|ion)" +
    "|elevat(?:ed|ion)|terminat(?:ed|ion)|remov(?:ed|al)|transition(?:ing|s|ed)?" +
    "|will\\s+(?:leave|exit|stand\\s+down)|expected\\s+to\\s+(?:leave|retire|step|depart))\\b",
  "i",
);

/**
 * Plurals are spelled out on every noun, which is not fussiness.
 *
 * The trailing `\b` means `director` does not match "directors" -- the `s` is a
 * word character, so there is no boundary to anchor to. That silently broke the
 * single most common shape a board appointment takes: "are appointed as
 * non-executive directors with immediate effect" matched nothing at all, while
 * the sentence beside it matched only because it happened to contain the word
 * "Board". A missing `s?` here is indistinguishable from a company that made no
 * appointments.
 */
const PERSONNEL_ROLES = new RegExp(
  "\\b(chair(?:man|men|person|people|woman|women)?s?|chief\\s+executives?|ceos?|cfos?|coos?" +
    "|chief\\s+(?:financial|operating|investment|executive)\\s+officers?" +
    "|managing\\s+directors?|executive\\s+directors?|non-?executive\\s+directors?|directors?" +
    "|company\\s+secretar(?:y|ies)|boards?|investment\\s+managers?|portfolio\\s+managers?" +
    "|responsible\\s+entit(?:y|ies)|heads?\\s+of\\s+\\w+|presidents?|trustees?" +
    "|investment\\s+committees?)\\b",
  "i",
);

export type PersonnelSignal = {
  /** The sentence, verbatim. Never paraphrased — this is evidence. */
  sentence: string;
  /** Headline of the document it came from. */
  source: string;
};

/** How many personnel sentences to carry into the prompt. */
const PERSONNEL_LIMIT = 14;

/**
 * Sentences that describe someone arriving, leaving or changing role.
 *
 * Requires an action *and* a role, because either alone is far too common: "the
 * Board resolved" and "the transaction completed" both match one half and say
 * nothing about personnel.
 */
export function extractPersonnelChanges(
  sources: SignalSource[],
): PersonnelSignal[] {
  const found: PersonnelSignal[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    for (const sentence of sentences(source.text)) {
      if (!PERSONNEL_ACTIONS.test(sentence)) continue;
      if (!PERSONNEL_ROLES.test(sentence)) continue;

      const key = sentence.toLowerCase().slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);

      found.push({ sentence, source: source.headline });
      if (found.length >= PERSONNEL_LIMIT) return found;
    }
  }

  return found;
}

export type KeyDate = {
  /** ISO form, for collision detection. */
  iso: string;
  /** As printed in the document. */
  printed: string;
  /** The surrounding clause, so the prompt can see what the date is *for*. */
  clause: string;
  source: string;
};

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|" +
  "jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";

const DATE_MENTION = new RegExp(
  `\\b(?:\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\.?(?:\\s+\\d{4})?` +
    `|(?:${MONTHS})\\.?\\s+\\d{1,2}(?:,?\\s+\\d{4})?` +
    `|\\d{4}-\\d{2}-\\d{2})\\b`,
  "gi",
);

const CLAUSE_WINDOW = 110;
const KEY_DATE_LIMIT = 18;

/**
 * Every date today's announcement states, with the words around it.
 *
 * Bounded to a window around the move so that page furniture, an ABN, or a
 * reference to the 2019 financial year does not arrive as a deadline. The clause
 * is carried because a bare list of dates is not usable -- "21 September" means
 * nothing without "the Buy-Back closes on".
 */
export function extractKeyDates(
  sources: SignalSource[],
  options: { moveDate: string },
): KeyDate[] {
  const year = Number(options.moveDate.slice(0, 4));
  const floor = `${year - 1}-01-01`;
  const ceiling = `${year + 2}-12-31`;

  const found: KeyDate[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    const text = source.text.replace(/---\s*page\s*\d+\s*---/gi, " ");
    DATE_MENTION.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = DATE_MENTION.exec(text)) !== null) {
      const printed = match[0].replace(/\s+/g, " ").trim();
      // Forward-looking dates are the point here, so no `notAfter` clamp: a
      // buy-back closing date is deliberately after the announcement.
      const isoDate = parseDateFragment(printed, year);
      if (!isoDate || isoDate < floor || isoDate > ceiling) continue;

      const key = isoDate;
      if (seen.has(key)) continue;
      seen.add(key);

      const start = Math.max(0, match.index - CLAUSE_WINDOW);
      found.push({
        iso: isoDate,
        printed,
        clause: text
          .slice(start, match.index + printed.length + CLAUSE_WINDOW)
          .replace(/\s+/g, " ")
          .trim(),
        source: source.headline,
      });

      if (found.length >= KEY_DATE_LIMIT) break;
    }
  }

  return found.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
}

export type DateCollision = {
  a: KeyDate;
  b: KeyDate;
  daysApart: number;
};

/** Dates closer together than this are the ones that get merged by mistake. */
const COLLISION_WINDOW_DAYS = 10;

/**
 * Pairs of distinct dates close enough to be mistaken for each other.
 *
 * Reported, not resolved. The extractor has no idea whether 21 and 24 September
 * are a close and a withdrawal deadline or the same event restated -- but it can
 * say "these are two different dates, check which is which", and that is enough
 * to stop the sentence that states one as both.
 */
export function findDateCollisions(dates: KeyDate[]): DateCollision[] {
  const collisions: DateCollision[] = [];

  for (let i = 0; i < dates.length; i += 1) {
    for (let j = i + 1; j < dates.length; j += 1) {
      const daysApart =
        (Date.parse(`${dates[j].iso}T00:00:00Z`) -
          Date.parse(`${dates[i].iso}T00:00:00Z`)) /
        86_400_000;
      if (daysApart === 0) continue;
      if (daysApart > COLLISION_WINDOW_DAYS) break;
      collisions.push({ a: dates[i], b: dates[j], daysApart });
    }
  }

  return collisions;
}
