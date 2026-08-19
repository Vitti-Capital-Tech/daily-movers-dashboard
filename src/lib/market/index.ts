import { yahooProvider } from "./yahoo";

import type { MarketDataProvider } from "./provider";

/**
 * The provider the app uses. Swapping feeds is this one line -- see
 * `./provider.ts` for the contract a replacement has to satisfy.
 */
export const marketData: MarketDataProvider = yahooProvider;

export type { DailyClose, MarketDataProvider, Quote } from "./provider";
export { UnknownSymbolError } from "./provider";
