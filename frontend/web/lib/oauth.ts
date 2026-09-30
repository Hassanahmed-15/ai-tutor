import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { createHash, randomBytes } from "node:crypto";
import type { OAuthProviderId } from "./db/cosmos";

/**
 * SIGN IN WITH GOOGLE, APPLE OR MICROSOFT — the OAuth 2.0 / OpenID Connect authorization-code flow.
 *
 * Owner's spec (2026-09-29): "Continue with Google / Apple / Microsoft", beside the email sign-up.
 * Each provider is ON only when its keys are in the environment (docs/social-sign-in.md); the
 * buttons stay visible either way and an unconfigured one says so instead of failing silently.
 *
 * The flow, per provider:
 *   /api/auth/oauth/<id>/start     → a short-lived signed cookie holds state + nonce + PKCE verifier,
 *                                    then a redirect to the provider;
 *   /api/auth/oauth/<id>/callback  → state checked against the cookie, the code exchanged for an ID
 *                                    token, the token's signature checked against the provider's
 *                                    published keys (issuer, audience, expiry, nonce), and the
 *                                    account found, linked or created (lib/oauthAccounts.ts).
 *
 * Linking (owner's choice): a provider email that is VERIFIED joins an existing Aria account with
 * that email. Microsoft work/school accounts only count as verified with the `xms_edov` claim, since
 * an Entra tenant can otherwise put any email on a user (the "nOAuth" takeover).
 */

export const OAUTH_PROVIDERS: OAuthProviderId[] = ["google", "apple", "microsoft"];
export const OAUTH_COOKIE = "aria_oauth";
const OAUTH_COOKIE_TTL_SECONDS = 10 * 60;
/** Microsoft's tenant for personal accounts (outlook.com, hotmail.com): their emails are verified. */
const MSA_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

type Env = Record<string, string | undefined>;

export type ProviderConfig = {
  id: OAuthProviderId;
  label: string;
  clientId: string;
  authorizeUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  scope: string;
  pkce: boolean;
  /** Apple returns the code by POSTing a form (needed for the name/email scopes). */
  formPost: boolean;
  /** The client secret sent to the token endpoint (Apple's is a JWT made per request). */
  clientSecret: () => Promise<string>;
  issuerOk: (iss: string, claims: JWTPayload) => boolean;
};

export function isProviderId(value: string): value is OAuthProviderId {
  return (OAUTH_PROVIDERS as string[]).includes(value);
}

/** The provider's config, or null when its keys are not set. */
export function providerConfig(id: OAuthProviderId, env: Env = process.env): ProviderConfig | null {
  if (id === "google") {
    const clientId = env.GOOGLE_CLIENT_ID, secret = env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !secret) return null;
    return {
      id, label: "Google", clientId,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
      scope: "openid email profile", pkce: true, formPost: false,
      clientSecret: async () => secret,
      issuerOk: (iss) => iss === "https://accounts.google.com" || iss === "accounts.google.com",
    };
  }
  if (id === "microsoft") {
    const clientId = env.MICROSOFT_CLIENT_ID, secret = env.MICROSOFT_CLIENT_SECRET;
    if (!clientId || !secret) return null;
    const tenant = env.MICROSOFT_TENANT_ID || "common";
    return {
      id, label: "Microsoft", clientId,
      authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      jwksUrl: "https://login.microsoftonline.com/common/discovery/v2.0/keys",
      scope: "openid email profile", pkce: true, formPost: false,
      clientSecret: async () => secret,
      // Multi-tenant: the issuer names the user's own tenant, which must be the token's `tid`.
      issuerOk: (iss, claims) => typeof claims.tid === "string" && iss === `https://login.microsoftonline.com/${claims.tid}/v2.0`,
    };
  }
  const clientId = env.APPLE_CLIENT_ID, teamId = env.APPLE_TEAM_ID, keyId = env.APPLE_KEY_ID, privateKey = env.APPLE_PRIVATE_KEY;
  if (!clientId || !teamId || !keyId || !privateKey) return null;
  return {
    id, label: "Apple", clientId,
    authorizeUrl: "https://appleid.apple.com/auth/authorize",
    tokenUrl: "https://appleid.apple.com/auth/token",
    jwksUrl: "https://appleid.apple.com/auth/keys",
    scope: "name email", pkce: false, formPost: true,
    // Apple's client secret is an ES256 JWT signed with the team's key (valid up to six months;
    // made fresh per sign-in here, so it never expires in place).
    clientSecret: async () => {
      const key = await importPKCS8(privateKey.replace(/\\n/g, "\n"), "ES256");
      return new SignJWT({})
        .setProtectedHeader({ alg: "ES256", kid: keyId })
        .setIssuer(teamId)
        .setSubject(clientId)
        .setAudience("https://appleid.apple.com")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(key);
    },
    issuerOk: (iss) => iss === "https://appleid.apple.com",
  };
}

export function configuredProviders(env: Env = process.env): Record<OAuthProviderId, boolean> {
  // Without a usable AUTH_SECRET no sign-in attempt can be signed, so no provider is usable either —
  // the buttons then say so up front instead of failing after the click.
  const secretOk = Boolean(env.AUTH_SECRET && env.AUTH_SECRET.length >= 32);
  return {
    google: secretOk && Boolean(providerConfig("google", env)),
    apple: secretOk && Boolean(providerConfig("apple", env)),
    microsoft: secretOk && Boolean(providerConfig("microsoft", env)),
  };
}

/**
 * Where the app is served from, for the redirect URI the provider sends the user back to. APP_URL
 * wins (set it in production); otherwise the forwarded host from Azure's ingress, then the request.
 */
export function appOrigin(request: Request, env: Env = process.env): string {
  if (env.APP_URL) return env.APP_URL.replace(/\/+$/, "");
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
}

export function redirectUri(origin: string, id: OAuthProviderId): string {
  return `${origin}/api/auth/oauth/${id}/callback`;
}

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export type OAuthStart = { state: string; nonce: string; verifier: string; challenge: string };

export function newOAuthStart(): OAuthStart {
  const verifier = b64url(randomBytes(32));
  return {
    state: b64url(randomBytes(24)),
    nonce: b64url(randomBytes(24)),
    verifier,
    challenge: b64url(createHash("sha256").update(verifier).digest()),
  };
}

export function authorizeUrl(cfg: ProviderConfig, start: OAuthStart, redirect: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: cfg.scope,
    state: start.state,
    nonce: start.nonce,
  });
  if (cfg.pkce) {
    q.set("code_challenge", start.challenge);
    q.set("code_challenge_method", "S256");
  }
  if (cfg.formPost) q.set("response_mode", "form_post");
  if (cfg.id === "google") q.set("prompt", "select_account");
  if (cfg.id === "microsoft") q.set("prompt", "select_account");
  return `${cfg.authorizeUrl}?${q.toString()}`;
}

function cookieSecret(env: Env): Uint8Array {
  const value = env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET must be set to a random string of at least 32 characters.");
  return new TextEncoder().encode(`oauth:${value}`);
}

/** The signed, short-lived cookie that carries this sign-in attempt across the provider's redirect. */
export async function signOAuthCookie(provider: OAuthProviderId, start: OAuthStart, env: Env = process.env): Promise<string> {
  return new SignJWT({ p: provider, s: start.state, n: start.nonce, v: start.verifier })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${OAUTH_COOKIE_TTL_SECONDS}s`)
    .sign(cookieSecret(env));
}

export async function readOAuthCookie(token: string | undefined, env: Env = process.env): Promise<{ provider: OAuthProviderId; state: string; nonce: string; verifier: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, cookieSecret(env));
    const p = String(payload.p ?? "");
    if (!isProviderId(p) || typeof payload.s !== "string" || typeof payload.n !== "string" || typeof payload.v !== "string") return null;
    return { provider: p, state: payload.s, nonce: payload.n, verifier: payload.v };
  } catch {
    return null;
  }
}

export function oauthCookieOptions(origin: string) {
  const secure = origin.startsWith("https://");
  // Apple returns by a cross-site form POST, which only carries a SameSite=None (and so Secure)
  // cookie. Over plain http (local development) that is impossible, and Lax is used instead.
  return { httpOnly: true, secure, sameSite: (secure ? "none" : "lax") as "none" | "lax", path: "/api/auth/oauth", maxAge: OAUTH_COOKIE_TTL_SECONDS };
}

/** Exchange the code for tokens; returns the ID token. */
export async function exchangeCode(
  cfg: ProviderConfig,
  code: string,
  verifier: string,
  redirect: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
    client_id: cfg.clientId,
    client_secret: await cfg.clientSecret(),
  });
  if (cfg.pkce) body.set("code_verifier", verifier);
  const res = await fetchImpl(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as { id_token?: unknown; error?: unknown; error_description?: unknown };
  if (!res.ok || typeof data.id_token !== "string") {
    throw new OAuthError("token", `token exchange failed: ${String(data.error_description ?? data.error ?? res.status)}`);
  }
  return data.id_token;
}

export class OAuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export type VerifiedIdentity = {
  provider: OAuthProviderId;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
};

const jwksCache = new Map<string, JWTVerifyGetKey>();
function remoteKeys(url: string): JWTVerifyGetKey {
  let keys = jwksCache.get(url);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(url));
    jwksCache.set(url, keys);
  }
  return keys;
}

/** Check the ID token's signature, issuer, audience, expiry and nonce; read who it is. */
export async function verifyIdToken(
  cfg: ProviderConfig,
  idToken: string,
  nonce: string,
  keys: JWTVerifyGetKey = remoteKeys(cfg.jwksUrl),
): Promise<VerifiedIdentity> {
  let claims: JWTPayload;
  try {
    ({ payload: claims } = await jwtVerify(idToken, keys, { audience: cfg.clientId, clockTolerance: 60 }));
  } catch (err) {
    throw new OAuthError("token", `ID token rejected: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof claims.iss !== "string" || !cfg.issuerOk(claims.iss, claims)) throw new OAuthError("token", "ID token from an unexpected issuer");
  // Apple only returns the nonce when one was sent; every provider here was sent one.
  if (claims.nonce !== nonce) throw new OAuthError("token", "ID token nonce does not match this sign-in");
  if (typeof claims.sub !== "string" || !claims.sub) throw new OAuthError("token", "ID token has no subject");

  const rawEmail = typeof claims.email === "string" ? claims.email : cfg.id === "microsoft" && typeof claims.preferred_username === "string" && claims.preferred_username.includes("@") ? claims.preferred_username : null;
  const email = rawEmail ? rawEmail.trim().toLowerCase() : null;
  let emailVerified = false;
  if (cfg.id === "google") emailVerified = claims.email_verified === true;
  if (cfg.id === "apple") emailVerified = claims.email_verified === true || claims.email_verified === "true";
  if (cfg.id === "microsoft") emailVerified = claims.tid === MSA_CONSUMER_TENANT || claims.xms_edov === true || claims.xms_edov === "1";
  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim().slice(0, 80) : null;
  return { provider: cfg.id, subject: claims.sub, email, emailVerified: Boolean(email) && emailVerified, name };
}

/** A friendly username from an email or name: lowercase, 3–24 of [a-z0-9_-]. `taken` checks uniqueness. */
export async function suggestUsername(seed: string, taken: (candidate: string) => Promise<boolean>): Promise<string> {
  let base = seed.split("@")[0].toLowerCase().normalize("NFKD").replace(/[^a-z0-9_-]+/g, "").slice(0, 18);
  if (base.length < 3) base = `learner${base}`.slice(0, 18);
  if (!(await taken(base))) return base;
  for (let i = 0; i < 20; i++) {
    const candidate = `${base}${Math.floor(100 + Math.random() * 9900)}`.slice(0, 24);
    if (!(await taken(candidate))) return candidate;
  }
  return `learner-${randomBytes(4).toString("hex")}`;
}

/** Messages for `?auth_error=` on the sign-in screen, in the student's terms. */
export const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  "not-configured": "isn't set up on this server yet — use email for now.",
  cancelled: "sign-in was cancelled.",
  state: "sign-in took too long or was opened in another window — please try again.",
  token: "couldn't confirm your account — please try again.",
  "email-unverified": "has an email that isn't verified, and an Aria account already uses it — sign in with your password instead.",
  "no-email": "didn't share an email address — allow email access and try again.",
  server: "sign-in failed on our side — please try again.",
};
