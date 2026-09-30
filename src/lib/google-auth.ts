import { OAuth2Client } from "google-auth-library";

const TRUSTED_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

/** Thrown when the Google ID token fails verification (bad signature, expired, wrong audience, ...). Maps to HTTP 401. */
export class GoogleTokenInvalidError extends Error {
  constructor(message = "google_token_invalid") {
    super(message);
    this.name = "GoogleTokenInvalidError";
  }
}

/** Thrown when the server is misconfigured (missing GOOGLE_WEB_CLIENT_ID). Maps to HTTP 500. */
export class GoogleConfigError extends Error {
  constructor(message = "google_client_id_not_configured") {
    super(message);
    this.name = "GoogleConfigError";
  }
}

export interface VerifiedGoogleAccount {
  sub: string;
  email: string;
  name?: string;
  emailVerified: boolean;
}

let sharedClient: OAuth2Client | null = null;

/** Singleton OAuth2Client so Google's public-key fetches stay cached across requests. */
export function getGoogleAuthClient(): OAuth2Client {
  if (!sharedClient) sharedClient = new OAuth2Client();
  return sharedClient;
}

/** Test hook: replace the singleton (used to inject a mock client in tests). */
export function setGoogleAuthClientForTests(client: OAuth2Client | null): void {
  sharedClient = client;
}

/**
 * Verifies a Google ID token meant for this backend.
 * Never trusts client-supplied email/name — everything comes from the verified payload.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedGoogleAccount> {
  // Read per request (not at import time) so dotenv/import order can never
  // silently misconfigure verification.
  const clientId = process.env.GOOGLE_WEB_CLIENT_ID || "";
  if (!clientId) throw new GoogleConfigError();
  if (!idToken || typeof idToken !== "string") throw new GoogleTokenInvalidError();

  let payload;
  try {
    const ticket = await getGoogleAuthClient().verifyIdToken({
      idToken,
      audience: clientId,
    });
    payload = ticket.getPayload();
  } catch {
    throw new GoogleTokenInvalidError();
  }

  if (
    !payload ||
    !payload.sub ||
    !payload.email ||
    payload.email_verified !== true ||
    !payload.iss ||
    !TRUSTED_ISSUERS.has(payload.iss)
  ) {
    throw new GoogleTokenInvalidError();
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    emailVerified: true,
  };
}

const USERNAME_UNSAFE_CHARS = /[^\p{L} ]+/gu;

function cleanUsernameCandidate(value: unknown): string {
  if (typeof value !== "string") return "";
  // Strip everything outside Unicode letters/spaces so the result always
  // satisfies the signup username rule: /^\p{L}+(?:[ ]+\p{L}+)*$/u
  const cleaned = value.replace(USERNAME_UNSAFE_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, 100).trim();
  return /^[\p{L}]+(?: [\p{L}]+)*$/u.test(cleaned) ? cleaned : "";
}

/**
 * Derives a valid Athletica username from the Google display name.
 * Falls back to the email prefix, then to a generic default — never throws,
 * never returns a value that fails username validation.
 */
export function sanitizeGoogleUsername(name: unknown, email: string): string {
  return (
    cleanUsernameCandidate(name) ||
    cleanUsernameCandidate(typeof email === "string" ? email.split("@")[0] : "") ||
    "Athletica User"
  );
}
