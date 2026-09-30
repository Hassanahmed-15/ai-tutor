/**
 * Sign-up: password rules (lib/passwordRules.ts) and sign-in with Google / Apple / Microsoft
 * (lib/oauth.ts, lib/oauthAccounts.ts), with local keys standing in for the providers.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT, createLocalJWKSet, exportJWK, exportPKCS8, generateKeyPair, decodeProtectedHeader } from "jose";
import { passwordChecks, passwordProblem } from "../passwordRules";
import { authorizeUrl, configuredProviders, exchangeCode, newOAuthStart, providerConfig, readOAuthCookie, signOAuthCookie, verifyIdToken, OAuthError } from "../oauth";
import { resolveOAuthAccount, type AccountStore } from "../oauthAccounts";
import type { UserDoc } from "../db/cosmos";

const ENV = {
  AUTH_SECRET: "x".repeat(40),
  GOOGLE_CLIENT_ID: "g-client", GOOGLE_CLIENT_SECRET: "g-secret",
  MICROSOFT_CLIENT_ID: "m-client", MICROSOFT_CLIENT_SECRET: "m-secret",
};

test("password rules: length, not common, not personal — checked live and by the server", () => {
  const ok = passwordChecks("correct horse battery", { email: "sara@example.com", username: "sara_k" });
  assert.ok(ok.every((c) => c.ok));
  assert.equal(passwordProblem("short"), "Use at least 10 characters — length matters more than symbols.");
  assert.match(passwordProblem("password123") ?? "", /too common/);
  assert.match(passwordProblem("aaaaaaaaaaaa") ?? "", /too common/);
  assert.match(passwordProblem("hello-saraahmed-2024", { email: "saraahmed@x.com" }) ?? "", /email or username/);
  assert.equal(passwordProblem("a long unrelated passphrase", { email: "sara@x.com", username: "sara" }), null, "a 4-letter name inside a long phrase is only checked when ≥ 4 letters");
});

test("a provider is on only when its keys are set", () => {
  assert.deepEqual(configuredProviders({}), { google: false, apple: false, microsoft: false });
  assert.deepEqual(configuredProviders(ENV), { google: true, apple: false, microsoft: true });
});

test("the authorize URL carries state, nonce and PKCE; Apple returns by form POST", async () => {
  const start = newOAuthStart();
  const g = new URL(authorizeUrl(providerConfig("google", ENV)!, start, "https://app/cb"));
  assert.equal(g.searchParams.get("state"), start.state);
  assert.equal(g.searchParams.get("nonce"), start.nonce);
  assert.equal(g.searchParams.get("code_challenge_method"), "S256");
  assert.equal(g.searchParams.get("redirect_uri"), "https://app/cb");
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const apple = providerConfig("apple", { APPLE_CLIENT_ID: "com.aria.web", APPLE_TEAM_ID: "TEAM123", APPLE_KEY_ID: "KEY123", APPLE_PRIVATE_KEY: (await exportPKCS8(privateKey)).replace(/\n/g, "\\n") })!;
  const a = new URL(authorizeUrl(apple, start, "https://app/cb"));
  assert.equal(a.searchParams.get("response_mode"), "form_post");
  // Apple's client secret: an ES256 JWT from the team to Apple, with the key id.
  const secret = await apple.clientSecret();
  assert.equal(decodeProtectedHeader(secret).kid, "KEY123");
});

test("the sign-in cookie round-trips, and a tampered or foreign one is refused", async () => {
  const start = newOAuthStart();
  const token = await signOAuthCookie("google", start, ENV);
  assert.deepEqual(await readOAuthCookie(token, ENV), { provider: "google", state: start.state, nonce: start.nonce, verifier: start.verifier });
  assert.equal(await readOAuthCookie(token.slice(0, -3) + "abc", ENV), null);
  assert.equal(await readOAuthCookie(token, { AUTH_SECRET: "y".repeat(40) }), null);
});

test("the code is exchanged with the PKCE verifier", async () => {
  let sent = "";
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    sent = String(init.body);
    return new Response(JSON.stringify({ id_token: "the-id-token" }), { status: 200 });
  }) as unknown as typeof fetch;
  const idToken = await exchangeCode(providerConfig("google", ENV)!, "the-code", "the-verifier", "https://app/cb", fakeFetch);
  assert.equal(idToken, "the-id-token");
  assert.match(sent, /code_verifier=the-verifier/);
  assert.match(sent, /client_secret=g-secret/);
});

async function idTokenKit() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>) => new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  return { keys, sign };
}

test("an ID token is checked for issuer, audience and nonce, and read for who it is", async () => {
  const { keys, sign } = await idTokenKit();
  const google = providerConfig("google", ENV)!;
  const good = await sign({ iss: "https://accounts.google.com", aud: "g-client", sub: "123", email: "Sara@Gmail.com", email_verified: true, name: "Sara", nonce: "n1" });
  assert.deepEqual(await verifyIdToken(google, good, "n1", keys), { provider: "google", subject: "123", email: "sara@gmail.com", emailVerified: true, name: "Sara" });
  await assert.rejects(verifyIdToken(google, good, "other-nonce", keys), OAuthError);
  const wrongAud = await sign({ iss: "https://accounts.google.com", aud: "someone-else", sub: "1", nonce: "n1" });
  await assert.rejects(verifyIdToken(google, wrongAud, "n1", keys), OAuthError);
  const wrongIss = await sign({ iss: "https://evil.example", aud: "g-client", sub: "1", nonce: "n1" });
  await assert.rejects(verifyIdToken(google, wrongIss, "n1", keys), OAuthError);
});

test("Microsoft: the issuer must be the user's own tenant; work emails need xms_edov to count as verified", async () => {
  const { keys, sign } = await idTokenKit();
  const ms = providerConfig("microsoft", ENV)!;
  const tid = "11111111-2222-3333-4444-555555555555";
  const org = await sign({ iss: `https://login.microsoftonline.com/${tid}/v2.0`, tid, aud: "m-client", sub: "s1", preferred_username: "a@contoso.com", nonce: "n" });
  assert.equal((await verifyIdToken(ms, org, "n", keys)).emailVerified, false);
  const orgVerified = await sign({ iss: `https://login.microsoftonline.com/${tid}/v2.0`, tid, aud: "m-client", sub: "s1", email: "a@contoso.com", xms_edov: true, nonce: "n" });
  assert.equal((await verifyIdToken(ms, orgVerified, "n", keys)).emailVerified, true);
  const personal = "9188040d-6c67-4c5b-b112-36a304b66dad";
  const msa = await sign({ iss: `https://login.microsoftonline.com/${personal}/v2.0`, tid: personal, aud: "m-client", sub: "s2", email: "b@outlook.com", nonce: "n" });
  assert.equal((await verifyIdToken(ms, msa, "n", keys)).emailVerified, true);
  const spoof = await sign({ iss: `https://login.microsoftonline.com/${tid}/v2.0`, tid: personal, aud: "m-client", sub: "s3", nonce: "n" });
  await assert.rejects(verifyIdToken(ms, spoof, "n", keys), OAuthError, "issuer and tid must agree");
});

function memoryStore(initial: UserDoc[] = []) {
  const docs = [...initial];
  const store: AccountStore = {
    findByIdentity: async (p, s) => docs.find((d) => d.identities?.some((i) => i.provider === p && i.subject === s)) ?? null,
    findByEmail: async (e) => docs.find((d) => d.email === e) ?? null,
    usernameTaken: async (u) => docs.some((d) => d.username === u),
    replace: async (u) => { docs[docs.findIndex((d) => d.id === u.id)] = u; },
    create: async (u) => { docs.push(u); },
  };
  return { docs, store };
}
const existing = (email: string, username: string): UserDoc => ({ id: `id-${username}`, email, username, passwordHash: "hash", createdAt: "t", onboardedAt: "t", profile: null });

test("accounts: sign in by identity, link a verified email, refuse an unverified one, else create", async () => {
  const { docs, store } = memoryStore([existing("sara@gmail.com", "sara")]);
  const linked = await resolveOAuthAccount({ provider: "google", subject: "g1", email: "sara@gmail.com", emailVerified: true, name: "Sara" }, store);
  assert.equal(linked.linked, true);
  assert.equal(linked.user.id, "id-sara");
  assert.equal(docs[0].identities?.[0].provider, "google");
  assert.equal((await resolveOAuthAccount({ provider: "google", subject: "g1", email: "changed@x.com", emailVerified: true, name: null }, store)).user.id, "id-sara", "the identity wins over a changed email");
  await assert.rejects(resolveOAuthAccount({ provider: "microsoft", subject: "m1", email: "sara@gmail.com", emailVerified: false, name: null }, store), /verified/);
  const made = await resolveOAuthAccount({ provider: "apple", subject: "a1", email: "sara@icloud.com", emailVerified: true, name: "Sara K" }, store);
  assert.equal(made.created, true);
  assert.equal(made.user.passwordHash, "", "no password — password sign-in can never match");
  assert.equal(made.user.onboardedAt, null, "goes through onboarding");
  assert.equal(made.user.profile?.displayName, "Sara K");
  assert.notEqual(made.user.username, "sara", "a unique username");
  await assert.rejects(resolveOAuthAccount({ provider: "google", subject: "g9", email: null, emailVerified: false, name: null }, store), /email/);
});
