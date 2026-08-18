import { hash, verify } from "@node-rs/argon2";
import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "./db/client";
import { sessions, users } from "./db/schema";

/**
 * JWT access tokens with server-side refresh sessions.
 *
 * THE SPLIT AND WHY. The access token is a short-lived JWT, verified from its signature alone —
 * no database round trip on every request, which is the whole point of using a JWT. The refresh
 * token is a random opaque string whose HASH is stored, so a session can genuinely be revoked;
 * a stateless refresh token cannot be invalidated before it expires, which makes "log out
 * everywhere" and "this device was stolen" impossible to honour.
 *
 * Both live in httpOnly cookies. A token readable by JavaScript is a token any XSS on the page can
 * steal, and no amount of care elsewhere compensates for that.
 */

const ACCESS_TTL_SECONDS = 15 * 60; // 15 minutes
const REFRESH_TTL_DAYS = 30;

export const ACCESS_COOKIE = "aria_access";
export const REFRESH_COOKIE = "aria_refresh";

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    // Refusing to start is deliberate. A default or short secret means every token in production
    // is forgeable, and that fails silently — the app would look completely healthy.
    throw new Error("AUTH_SECRET must be set to a random string of at least 32 characters.");
  }
  return new TextEncoder().encode(value);
}

/** Argon2id — memory-hard, so a leaked hash is expensive to attack offline. */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

export async function signAccessToken(userId: string, email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(secret());
}

export async function readAccessToken(token: string): Promise<{ userId: string; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.sub !== "string") return null;
    return { userId: payload.sub, email: typeof payload.email === "string" ? payload.email : "" };
  } catch {
    return null;
  }
}

/** Refresh tokens are opaque and random; only their SHA-256 is stored. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000);
  await db().insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  return token;
}

/**
 * Exchange a refresh token for a new one, invalidating the old.
 *
 * Rotation on every use is what limits the damage of a stolen refresh token: the thief and the
 * real user cannot both keep using it, so the theft surfaces as an unexpected logout rather than
 * as silent indefinite access.
 */
export async function rotateSession(token: string): Promise<{ userId: string; token: string } | null> {
  const rows = await db()
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  await db().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, row.id));
  const next = await createSession(row.userId);
  return { userId: row.userId, token: next };
}

export async function revokeSession(token: string): Promise<void> {
  await db().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashToken(token)));
}

const COOKIE_BASE = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  // Secure in production only, so local http://localhost development still works.
  secure: process.env.NODE_ENV === "production",
};

export async function setAuthCookies(accessToken: string, refreshToken: string): Promise<void> {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, accessToken, { ...COOKIE_BASE, maxAge: ACCESS_TTL_SECONDS });
  jar.set(REFRESH_COOKIE, refreshToken, { ...COOKIE_BASE, maxAge: REFRESH_TTL_DAYS * 86_400 });
}

export async function clearAuthCookies(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

/**
 * The current user, or null.
 *
 * Tries the access token first (signature only, no query). If it has expired, silently rotates the
 * refresh token so a 15-minute access window never interrupts a lesson mid-flight.
 */
export async function currentUser(): Promise<{ userId: string; email: string } | null> {
  const jar = await cookies();
  const access = jar.get(ACCESS_COOKIE)?.value;
  if (access) {
    const payload = await readAccessToken(access);
    if (payload) return payload;
  }
  const refresh = jar.get(REFRESH_COOKIE)?.value;
  if (!refresh) return null;
  const rotated = await rotateSession(refresh);
  if (!rotated) return null;
  const rows = await db().select().from(users).where(eq(users.id, rotated.userId)).limit(1);
  const user = rows[0];
  if (!user) return null;
  const nextAccess = await signAccessToken(user.id, user.email);
  await setAuthCookies(nextAccess, rotated.token);
  return { userId: user.id, email: user.email };
}
