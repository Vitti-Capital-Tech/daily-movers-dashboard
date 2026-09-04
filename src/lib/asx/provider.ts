/**
 * The shape the rest of the app knows about the ASX listing universe and
 * company announcements.
 *
 * Same reasoning as `lib/market/provider.ts`, and it matters more here: the
 * announcement source is an undocumented legacy servlet, so nothing above this
 * line deals in its HTML. When it changes — or when the licensing question in
 * `./announcements.ts` is answered with a paid feed — the fix is one module
 * satisfying this interface, not a rewrite of the drafting pipeline.
 *
 * Note what is *not* here: the top-movers board. That is computed in
 * `./board.ts` from this universe plus the market-data provider's session
 * moves, rather than read off a published leaderboard — see that file for why.
 */

/** One ASX listing, from the exchange's own company directory. */
export type UniverseCompany = {
  /** ASX code, uppercase, no `.AX` suffix. */
  ticker: string;
  name: string;
  /** GICS industry group as the ASX classifies it. */
  sector: string | null;
  /** Listing date, YYYY-MM-DD. Null when the directory omits it. */
  listedOn: string | null
  /**
   * Market capitalisation in AUD, as at the directory's own snapshot.
   *
   * Deliberately used only for the *pre-filter* that decides which tickers are
   * worth quoting. The figure shown on a draft comes from the live quote, since
   * this one is a day or more stale.
   */
  marketCap: number | null;
};

/** One ASX company announcement. */
export type Announcement = {
  /**
   * The ASX's own document id. Both the PDF fetch and the audit trail key off
   * this, so it is the one field that must never be synthesised.
   */
  idsId: string;
  /** ASX local date of release, YYYY-MM-DD. */
  date: string;
  /** Release time as printed, e.g. "8:16 am". Null when not published. */
  time: string | null;
  headline: string;
  /**
   * Whether the ASX flagged this as price sensitive. This is the filter the
   * whole pipeline turns on: a company's substantial-holder notices and
   * capital-change forms are noise, and there are far more of them.
   */
  isPriceSensitive: boolean;
  pageCount: number | null;
  /** Size in bytes, parsed from the printed "1.3MB" / "14.3KB". */
  sizeBytes: number | null;
  /** Page an analyst can open to read it themselves. */
  sourceUrl: string;
};

export interface AsxDataProvider {
  /** Recorded on every draft, so mixed-source data stays traceable. */
  readonly name: string;

  /** Every current ASX listing. */
  fetchUniverse(): Promise<UniverseCompany[]>;

  /**
   * Announcements for one ticker, newest first.
   *
   * `minPriceSensitive` is a *target*, not a guarantee: the implementation keeps
   * reaching further back until it has that many price-sensitive releases or
   * runs out of history. A company listed last year simply has fewer, and that
   * is not an error.
   */
  fetchAnnouncements(
    ticker: string,
    options: { minPriceSensitive: number; maxYearsBack?: number },
  ): Promise<Announcement[]>;

  /**
   * The announcement PDF's bytes.
   *
   * Throws `AnnouncementUnavailableError` when the document can't be reached —
   * the caller drops that one announcement and carries on rather than failing
   * the whole draft, because one unreadable filing out of thirty should not cost
   * a day's report.
   */
  fetchAnnouncementPdf(idsId: string): Promise<Uint8Array>;
}

/** The document exists in the list but its bytes could not be retrieved. */
export class AnnouncementUnavailableError extends Error {
  constructor(idsId: string, reason: string) {
    super(`Announcement ${idsId} could not be downloaded: ${reason}`);
    this.name = "AnnouncementUnavailableError";
  }
}

/** The upstream page was reachable but didn't parse into anything usable. */
export class SourceShapeChangedError extends Error {
  constructor(source: string, detail: string) {
    super(
      `${source} did not parse as expected (${detail}). The page layout has ` +
        `probably changed — see src/lib/asx/.`,
    );
    this.name = "SourceShapeChangedError";
  }
}
