import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { databaseConfigured, ensureContainers, users, type UserDoc } from "@/lib/db/cosmos";
import { createSession, setAuthCookies, signAccessToken } from "@/lib/auth";
import { OAUTH_COOKIE, OAuthError, appOrigin, exchangeCode, isProviderId, providerConfig, readOAuthCookie, redirectUri, verifyIdToken } from "@/lib/oauth";
import { resolveOAuthAccount, type AccountStore } from "@/lib/oauthAccounts";
import { findUserByEmail, findUserByUsername } from "../../../signup/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cosmosStore: AccountStore = {
  async findByIdentity(provider, subject) {
    const { resources } = await users().items
      .query<UserDoc>({
        query: "SELECT TOP 1 * FROM c WHERE ARRAY_CONTAINS(c.identities, { provider: @p, subject: @s }, true)",
        parameters: [{ name: "@p", value: provider }, { name: "@s", value: subject }],
      })
      .fetchAll();
    return resources[0] ?? null;
  },
  findByEmail: (email) => findUserByEmail(email),
  usernameTaken: async (username) => Boolean(await findUserByUsername(username)),
  replace: async (user) => { await users().item(user.id, user.id).replace(user); },
  create: async (user) => { await users().items.create(user); },
};

/**
 * The provider sends the student back here: GET for Google and Microsoft, a form POST for Apple.
 * Every failure lands on the sign-in screen with a reason (`?auth_error=`), never on a raw error.
 */
async function handle(request: Request, provider: string, fields: URLSearchParams) {
  const origin = appOrigin(request);
  const fail = (code: string) => {
    const res = NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(code)}&auth_provider=${encodeURIComponent(provider)}`, 303);
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth/oauth" });
    return res;
  };
  if (!isProviderId(provider)) return fail("server");
  const cfg = providerConfig(provider);
  if (!cfg) return fail("not-configured");
  if (fields.get("error")) return fail(fields.get("error") === "access_denied" || fields.get("error") === "user_cancelled_authorize" ? "cancelled" : "token");
  if (!databaseConfigured()) return fail("server");

  const jar = await cookies();
  const saved = await readOAuthCookie(jar.get(OAUTH_COOKIE)?.value);
  const code = fields.get("code");
  if (!saved || saved.provider !== provider || !code || fields.get("state") !== saved.state) return fail("state");

  try {
    await ensureContainers();
    const idToken = await exchangeCode(cfg, code, saved.verifier, redirectUri(origin, provider));
    const identity = await verifyIdToken(cfg, idToken, saved.nonce);
    // Apple sends the name once, on the first sign-in, as a form field beside the code.
    if (!identity.name && provider === "apple") {
      try {
        const user = JSON.parse(fields.get("user") ?? "{}") as { name?: { firstName?: string; lastName?: string } };
        const name = [user.name?.firstName, user.name?.lastName].filter(Boolean).join(" ").trim();
        if (name) identity.name = name.slice(0, 80);
      } catch {}
    }
    const { user } = await resolveOAuthAccount(identity, cosmosStore);
    await setAuthCookies(await signAccessToken(user.id, user.email), await createSession(user.id));
    const res = NextResponse.redirect(`${origin}/`, 303);
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth/oauth" });
    return res;
  } catch (err) {
    console.error(`[oauth] ${provider} sign-in failed:`, err instanceof Error ? err.message : err);
    return fail(err instanceof OAuthError ? err.code : "server");
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  return handle(request, provider, new URL(request.url).searchParams);
}

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const form = await request.formData().catch(() => null);
  const fields = new URLSearchParams();
  form?.forEach((value, key) => { if (typeof value === "string") fields.set(key, value); });
  return handle(request, provider, fields);
}
