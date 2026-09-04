import { SourceShapeChangedError, type UniverseCompany } from "./provider";

/**
 * Every current ASX listing, from the exchange's own company directory CSV.
 *
 * This is the endpoint the ASX website's own company directory downloads, and
 * it returns the whole market in a single ~135 KB request: code, company name,
 * GICS industry group, listing date and market cap for ~1,830 listings.
 *
 * The `access_token` is not a secret. It is a fixed value the ASX ships in its
 * own public front-end, and every unauthenticated visitor's browser sends the
 * same one — which is also why it is hardcoded rather than pulled from the
 * environment: putting it in `.env` would imply it is a credential someone
 * needs to obtain and could rotate for us.
 */

const DIRECTORY_URL =
  "https://asx.api.markitdigital.com/asx-research/1.0/companies/directory/file";
const PUBLIC_ACCESS_TOKEN = "83ff96335c2d45a094df02a206a39ff4";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/csv,*/*;q=0.8",
};

/**
 * Six hours. Listings and admissions move on a scale of days, and the market-cap
 * column is a daily snapshot the screen only uses as a coarse pre-filter — so
 * re-fetching this more often buys nothing, while caching it keeps a retried
 * cron run from re-downloading the whole market.
 */
const UNIVERSE_REVALIDATE_SECONDS = 6 * 60 * 60;

/**
 * Splits one CSV line, honouring double-quoted fields.
 *
 * Hand-rolled rather than a dependency because this is the only CSV the app
 * reads and its shape is narrow: quoted text fields, one bare numeric field.
 * Company names legitimately contain commas ("BHP GROUP LIMITED" is fine, but
 * "XYZ HOLDINGS, LIMITED" is not unheard of), so splitting on `,` alone would
 * shift every later column by one for those rows.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      // A doubled quote inside a quoted field is an escaped literal quote.
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields.map((field) => field.trim());
}

/** The directory prints DD/MM/YYYY; everything downstream wants YYYY-MM-DD. */
function parseListingDate(text: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseUniverseCsv(csv: string): UniverseCompany[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new SourceShapeChangedError(DIRECTORY_URL, "CSV had no data rows");
  }

  // Header-driven so an added or reordered column doesn't silently put the
  // listing date into the market-cap field.
  const headers = splitCsvLine(lines[0]).map((header) => header.toLowerCase());
  const codeAt = headers.findIndex((header) => header.includes("asx code"));
  const nameAt = headers.findIndex((header) => header.includes("company name"));
  const sectorAt = headers.findIndex((header) => header.includes("industry"));
  const listedAt = headers.findIndex((header) => header.includes("listing date"));
  const capAt = headers.findIndex((header) => header.includes("market cap"));

  if (codeAt === -1 || nameAt === -1) {
    throw new SourceShapeChangedError(
      DIRECTORY_URL,
      `missing code or name column (saw: ${headers.join(", ")})`,
    );
  }

  const companies: UniverseCompany[] = [];
  const seen = new Set<string>();

  for (const line of lines.slice(1)) {
    if (line.trim() === "") continue;
    const fields = splitCsvLine(line);

    const ticker = (fields[codeAt] ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);

    const capRaw = capAt === -1 ? "" : (fields[capAt] ?? "").replace(/[$,\s]/g, "");
    const marketCap = capRaw === "" ? NaN : Number(capRaw);

    companies.push({
      ticker,
      name: fields[nameAt] ?? ticker,
      sector: sectorAt === -1 ? null : (fields[sectorAt] || null),
      listedOn: listedAt === -1 ? null : parseListingDate(fields[listedAt] ?? ""),
      // Zero is the directory's way of saying "not published", not a company
      // genuinely worth nothing — treating it as 0 would make it fail the
      // market-cap floor for the wrong reason, which is the right outcome but
      // for a reason worth not relying on.
      marketCap:
        Number.isFinite(marketCap) && marketCap > 0 ? marketCap : null,
    });
  }

  if (companies.length === 0) {
    throw new SourceShapeChangedError(
      DIRECTORY_URL,
      "CSV parsed but produced zero listings",
    );
  }

  return companies;
}

export async function fetchAsxUniverse(): Promise<UniverseCompany[]> {
  const url = `${DIRECTORY_URL}?access_token=${PUBLIC_ACCESS_TOKEN}&csv=true`;

  const response = await fetch(url, {
    headers: BROWSER_HEADERS,
    next: { revalidate: UNIVERSE_REVALIDATE_SECONDS },
  });

  if (!response.ok) {
    throw new Error(
      `ASX company directory returned ${response.status}. If this is a 401, ` +
        `the public access token in src/lib/asx/universe.ts has been rotated.`,
    );
  }

  return parseUniverseCsv(await response.text());
}
