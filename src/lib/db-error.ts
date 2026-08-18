/**
 * Turns a postgres.js failure into one short line worth showing on screen.
 * Deliberately does not include the connection string — that carries the
 * password.
 */
export function describeDbError(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown database error.";

  const cause = (error as { cause?: unknown }).cause;
  const causeCode =
    cause instanceof Error
      ? (cause as Error & { code?: string }).code
      : undefined;
  const code = (error as Error & { code?: string }).code ?? causeCode;

  switch (code) {
    case "28P01":
      return "28P01: password authentication failed — the database password is wrong.";
    case "ENOTFOUND":
      return "ENOTFOUND: the database host could not be resolved from this network.";
    case "ETIMEDOUT":
    case "CONNECT_TIMEOUT":
      return "Connection timed out — check the host and port.";
    case "ECONNREFUSED":
      return "ECONNREFUSED: nothing is listening on that host and port.";
    case "3D000":
      return "3D000: that database does not exist.";
    case "42P01":
      return "42P01: a table is missing — run `npm run db:push`.";
    default:
      break;
  }

  const message = cause instanceof Error ? cause.message : error.message;
  return code ? `${code}: ${message}` : message;
}
