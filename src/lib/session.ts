/**
 * Signed session cookie — no Supabase Auth, no emailed links.
 *
 * The cookie proves only that *this server* issued it. It does NOT prove the
 * person owns the email address inside it: sign-in accepts any allowlisted
 * address without verification. The signature stops a visitor from editing
 * their own cookie to become an admin; it cannot stop someone from typing a
 * colleague's address at the login screen. See README → Auth.
 *
 * Uses Web Crypto so the same code runs in middleware (edge runtime) and in
 * Node server components. `node:crypto` is not available on the edge.
 */

export const SESSION_COOKIE = "vitti_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

type SessionPayload = {
  /** Email address, lowercased. */
  e: string;
  /** Expiry, seconds since epoch. */
  x: number;
};

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "AUTH_SECRET is missing or too short (needs 32+ chars). Generate one with:\n" +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return value;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Length-independent comparison, so a mismatch leaks no timing signal. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function createSessionToken(email: string): Promise<string> {
  const payload: SessionPayload = {
    e: email.trim().toLowerCase(),
    x: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const body = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(),
    new TextEncoder().encode(body),
  );
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** Returns the email if the token is authentic and unexpired, else null. */
export async function readSessionToken(
  token: string | undefined | null,
): Promise<string | null> {
  if (!token) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  try {
    const expected = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await hmacKey(),
        new TextEncoder().encode(body),
      ),
    );
    if (!timingSafeEqual(expected, base64UrlDecode(signature))) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(body)),
    ) as SessionPayload;

    if (typeof payload.e !== "string" || typeof payload.x !== "number") {
      return null;
    }
    if (payload.x < Math.floor(Date.now() / 1000)) return null;

    return payload.e;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};
