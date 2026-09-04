import { fetchAsxAnnouncementPdf, fetchAsxAnnouncements } from "./announcements";
import { fetchAsxUniverse } from "./universe";

import type { AsxDataProvider } from "./provider";

/**
 * The ASX data source the drafting pipeline uses. Swapping to a licensed feed is
 * this one object — see `./provider.ts` for the contract a replacement
 * satisfies, and the NOTICE at the bottom of `./announcements.ts` for why that
 * might become necessary.
 */
export const asxData: AsxDataProvider = {
  name: "asx",
  fetchUniverse: fetchAsxUniverse,
  fetchAnnouncements: fetchAsxAnnouncements,
  fetchAnnouncementPdf: fetchAsxAnnouncementPdf,
};
