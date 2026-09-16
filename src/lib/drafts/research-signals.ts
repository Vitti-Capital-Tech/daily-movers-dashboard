import { isLegalRegulatoryFiling } from "@/lib/asx/filings";
import {
  buildEventChain,
  extractDocumentReferences,
  rankHistoricalFilings,
  resolveReferences,
  type ChainEvent,
  type RankedFiling,
  type ResolvedReference,
} from "@/lib/asx/references";
import {
  extractKeyDates,
  extractPersonnelChanges,
  findDateCollisions,
  type DateCollision,
  type KeyDate,
  type PersonnelSignal,
} from "@/lib/asx/signals";

import type { Announcement } from "@/lib/asx";
import type { AnnouncementDocument } from "@/lib/ai/announcement-text";

/**
 * Everything that can be learned from today's announcement *before* deciding
 * what else to read.
 *
 * This is the hinge of the corpus build. The old order picked the company's
 * earlier filings from their headlines alone, then downloaded today's, then
 * wrote the report — so the one document guaranteed to say which history
 * mattered was read *after* the history had already been chosen. Today's
 * announcement names the documents that explain it, names the people changing
 * roles, and states the dates that matter; all of it was sitting in text the
 * pipeline already had and threw away.
 *
 * So today's filings are now read first, and this module turns them into the
 * four inputs the rest of the build needs:
 *
 * - **references** — earlier documents today's release points at, resolved to
 *   real filings. These are admitted to the corpus above the reading target.
 * - **chain** — the sequence today's event belongs to, oldest first, so the
 *   report can start the story at its beginning.
 * - **personnel** — sentences describing board and management change, which is
 *   always material and almost never the headline.
 * - **dates** — every date today's announcement states, and any two close
 *   enough together to be mistaken for each other.
 *
 * Nothing here calls a model or a network. It is regexes over text already
 * downloaded, which is why it can sit on the critical path of a 300-second
 * invocation without a budget of its own.
 */

export type ResolvedReferenceSummary = {
  label: string;
  /** The date today's announcement gave for it, if any. */
  statedDate: string | null;
  /** The sentence it was found in, verbatim. */
  phrase: string;
  /** The filing it resolved to, when one was found. */
  matched: { idsId: string; date: string; headline: string } | null;
  because: string;
  /** Whether the matched filing was actually read in full. */
  read: boolean;
};

export type ChainStep = {
  date: string;
  headline: string;
  isOrigin: boolean;
  isPriceSensitive: boolean;
  /** Whether this step was read in full, or is timeline-only. */
  read: boolean;
};

export type ResearchSignals = {
  references: ResolvedReferenceSummary[];
  chain: ChainStep[];
  personnel: PersonnelSignal[];
  keyDates: KeyDate[];
  dateCollisions: DateCollision[];
  /** True when today's filing is litigation, a regulator, or a shareholder vote. */
  todayIsLegalRegulatory: boolean;
};

export type CorpusPlan = {
  /** Earlier filings to read in full, newest first. */
  history: RankedFiling[];
  /** What was deliberately not read, and why. */
  dropped: { idsId: string; date: string; headline: string; reason: string }[];
  signals: ResearchSignals;
  /** Kept separately so callers can inspect the raw objects if they need to. */
  resolved: ResolvedReference[];
  chain: ChainEvent[];
};

/**
 * Reads today's filings and plans the rest of the corpus from them.
 *
 * `target` and `accountsTarget` mean the same as they did before: documents read
 * in full, and the minimum number of those that must be the company's accounts.
 * Referenced documents are additional to both — see `rankHistoricalFilings`.
 */
export function planCorpus(input: {
  moveDate: string;
  todayAnnouncements: Announcement[];
  todayDocuments: AnnouncementDocument[];
  allAnnouncements: Announcement[];
  target: number;
  accountsTarget: number;
}): CorpusPlan {
  const todayText = input.todayDocuments
    .map((document) => document.text)
    .filter((text) => text.length > 0)
    .join("\n\n");

  const todayHeadlines = input.todayAnnouncements.map((item) => item.headline);

  const references = extractDocumentReferences(todayText, {
    moveDate: input.moveDate,
  });
  const resolved = resolveReferences(references, input.allAnnouncements, {
    moveDate: input.moveDate,
  });

  const chain = buildEventChain({
    todayHeadlines,
    references: resolved,
    announcements: input.allAnnouncements,
    moveDate: input.moveDate,
  });

  const todayIsLegalRegulatory = input.todayAnnouncements.some((item) =>
    isLegalRegulatoryFiling(item),
  );

  const ranked = rankHistoricalFilings({
    announcements: input.allAnnouncements,
    moveDate: input.moveDate,
    todayHeadlines,
    references: resolved,
    chain,
    todayIsLegalRegulatory,
    target: input.target,
    accountsTarget: input.accountsTarget,
  });

  const readIds = new Set(ranked.keep.map((item) => item.idsId));

  /**
   * The signal extractors run over today's documents only.
   *
   * Personnel changes and stated dates are claims the report will make about
   * *today*, and a director who resigned in March is not today's news. History
   * is where the chain and the filing timeline do their work instead.
   */
  const signalSources = input.todayDocuments
    .filter((document) => document.text.length > 0)
    .map((document) => ({
      headline: document.announcement.headline,
      text: document.text,
    }));

  const keyDates = extractKeyDates(signalSources, { moveDate: input.moveDate });

  return {
    history: ranked.keep,
    dropped: ranked.dropped.map((item) => ({
      idsId: item.idsId,
      date: item.date,
      headline: item.headline,
      reason:
        item.filingClass === "routine"
          ? "routine paperwork"
          : item.seriesKey
            ? `superseded (${item.seriesKey})`
            : `outranked (score ${Math.round(item.score)})`,
    })),
    resolved,
    chain,
    signals: {
      references: resolved.map((entry) => ({
        label: entry.reference.label,
        statedDate: entry.reference.date,
        phrase: entry.reference.phrase,
        matched: entry.match
          ? {
              idsId: entry.match.idsId,
              date: entry.match.date,
              headline: entry.match.headline,
            }
          : null,
        because: entry.because,
        read: entry.match ? readIds.has(entry.match.idsId) : false,
      })),
      chain: chain.map((event) => ({
        date: event.announcement.date,
        headline: event.announcement.headline,
        isOrigin: event.isOrigin,
        isPriceSensitive: event.announcement.isPriceSensitive,
        read: readIds.has(event.announcement.idsId),
      })),
      personnel: extractPersonnelChanges(signalSources),
      keyDates,
      dateCollisions: findDateCollisions(keyDates),
      todayIsLegalRegulatory,
    },
  };
}

export type { PersonnelSignal, KeyDate, DateCollision };
