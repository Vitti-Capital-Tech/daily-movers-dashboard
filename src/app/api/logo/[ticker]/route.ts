import type { NextRequest } from "next/server";

/**
 * Resolves a company logo from a ticker alone.
 *
 * Tickers arrive from uploaded PDFs, so the set is open-ended -- any hardcoded
 * ticker-to-domain table is stale the moment a new mover lands. So the primary
 * source is keyed by the ticker itself and needs nothing known in advance; the
 * domain guesses below it only run when that misses.
 *
 * Resolution happens here rather than in the browser because the fallback chain
 * needs to see upstream status codes: a cross-origin <img> only reports "it
 * failed", and every failed attempt is a visible flicker. Doing it server-side
 * also means one URL per ticker for the browser to cache, and third-party hosts
 * never see the user.
 */

const UPSTREAM_TIMEOUT_MS = 6_000;

/** Logos effectively never change, so let the browser hold them for a week. */
const HIT_CACHE_CONTROL = "public, max-age=604800, stale-while-revalidate=86400";

/**
 * Misses are cached too -- without this every render of a logo-less company is
 * another walk through the whole chain -- but briefly, so a logo that appears
 * upstream later gets picked up.
 */
const MISS_CACHE_CONTROL = "public, max-age=21600";

/** Below this, a 200 is a tracking pixel or an error page, not a logo. */
const MIN_IMAGE_BYTES = 100;

const TICKER_PATTERN = /^[A-Z0-9]{1,8}$/;

/** Legal-entity noise that never appears in a domain name. */
const ENTITY_SUFFIXES =
  /\b(limited|ltd|group|corporation|corp|holdings|holding|pty|inc|plc|nl|company|co)\b/g;

function faviconUrl(domain: string) {
  const target = encodeURIComponent(`https://${domain}`);
  return `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${target}&size=128`;
}

/**
 * Ordered best-first. The ticker-keyed source covers most of the ASX board
 * without being told anything about the company; the rest are guesses from the
 * company name, which is all we have when it doesn't.
 */
function candidateUrls(ticker: string, name: string | null): string[] {
  const urls = [`https://assets.parqet.com/logos/symbol/${ticker}.AX?format=png`];

  const stem = (name ?? "")
    .toLowerCase()
    .replace(ENTITY_SUFFIXES, "")
    .replace(/[^a-z0-9]/g, "");

  // ".com.au" first: these are ASX listings.
  if (stem.length >= 3) urls.push(faviconUrl(`${stem}.com.au`), faviconUrl(`${stem}.com`));

  // Deliberately no `{ticker}.com.au` guess. Three letters collide with whoever
  // owns them -- it served Apple's logo for MAC (Metals Acquisition) off
  // mac.com.au -- and a confidently wrong logo is worse than the monogram.
  return urls;
}

async function fetchLogo(url: string) {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: { Accept: "image/*" },
    });
  } catch {
    // A dead host or a timeout is just this candidate failing; try the next.
    return null;
  }

  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) return null;

  const body = await response.arrayBuffer();
  if (body.byteLength < MIN_IMAGE_BYTES) return null;

  return { body, contentType };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker: rawTicker } = await params;
  const ticker = decodeURIComponent(rawTicker).trim().toUpperCase();

  // Also the SSRF guard: every upstream URL is built from a ticker matching
  // this and from a name stripped to [a-z0-9], so nothing user-supplied can
  // steer the request at a host of its own choosing.
  if (!TICKER_PATTERN.test(ticker)) {
    return new Response("Not found", { status: 404 });
  }

  const name = request.nextUrl.searchParams.get("name");

  for (const url of candidateUrls(ticker, name)) {
    const logo = await fetchLogo(url);
    if (!logo) continue;

    return new Response(logo.body, {
      headers: {
        "Content-Type": logo.contentType,
        "Cache-Control": HIT_CACHE_CONTROL,
      },
    });
  }

  return new Response("No logo found", {
    status: 404,
    headers: { "Cache-Control": MISS_CACHE_CONTROL },
  });
}
