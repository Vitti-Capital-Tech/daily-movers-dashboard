import "server-only";

/**
 * pg_cron (through pg_net) sends `Authorization: Bearer $CRON_SECRET`, and so
 * does the draft route when it hands off to the email route. Without the secret
 * a cron endpoint would be an unauthenticated way for anyone to spend the
 * desk's Claude budget or mail out unreviewed drafts, so a missing secret
 * disables the route rather than leaving it open.
 */
export function isAuthorisedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/** The header a route sends when it calls another cron route itself. */
export function cronAuthHeader(): Record<string, string> {
  return { Authorization: `Bearer ${process.env.CRON_SECRET?.trim() ?? ""}` };
}
