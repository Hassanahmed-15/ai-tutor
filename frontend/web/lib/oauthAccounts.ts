import { randomUUID } from "node:crypto";
import type { UserDoc } from "./db/cosmos";
import { OAuthError, suggestUsername, type VerifiedIdentity } from "./oauth";

/**
 * WHICH ARIA ACCOUNT A PROVIDER SIGN-IN BELONGS TO (lib/oauth.ts has the flow).
 *
 *  1. An account already linked to this provider identity (provider + subject) — sign in.
 *  2. Else, a VERIFIED provider email matching an existing account — link the identity to it and
 *     sign in (owner's choice, 2026-09-29), so history, profile and lessons carry over.
 *  3. Else, an unverified email that matches an existing account is refused: linking on an email
 *     the provider has not confirmed would let anyone claim that account.
 *  4. Else, a new account: username made from the email, no password (password sign-in can never
 *     match an empty hash), onboarding not yet done — they go through onboarding like anyone else.
 *
 * Written against a small store so the rules are tested without a database.
 */
export type AccountStore = {
  findByIdentity(provider: VerifiedIdentity["provider"], subject: string): Promise<UserDoc | null>;
  findByEmail(email: string): Promise<UserDoc | null>;
  usernameTaken(username: string): Promise<boolean>;
  replace(user: UserDoc): Promise<void>;
  create(user: UserDoc): Promise<void>;
};

export async function resolveOAuthAccount(
  identity: VerifiedIdentity,
  store: AccountStore,
  now = new Date().toISOString(),
): Promise<{ user: UserDoc; created: boolean; linked: boolean }> {
  const existing = await store.findByIdentity(identity.provider, identity.subject);
  if (existing) return { user: existing, created: false, linked: false };

  if (!identity.email) throw new OAuthError("no-email", "the provider shared no email");
  const link = { provider: identity.provider, subject: identity.subject, email: identity.email, linkedAt: now };

  const byEmail = await store.findByEmail(identity.email);
  if (byEmail) {
    if (!identity.emailVerified) throw new OAuthError("email-unverified", "an account uses this email and the provider has not verified it");
    const user: UserDoc = { ...byEmail, identities: [...(byEmail.identities ?? []), link] };
    await store.replace(user);
    return { user, created: false, linked: true };
  }

  const user: UserDoc = {
    id: randomUUID(),
    email: identity.email,
    username: await suggestUsername(identity.email, store.usernameTaken),
    passwordHash: "",
    createdAt: now,
    onboardedAt: null,
    identities: [link],
    // The provider's name, so onboarding opens with it filled in.
    profile: identity.name
      ? { displayName: identity.name, age: null, accessibility: null, reducedMotion: null, captions: null, slowerPace: null, simplerLanguage: null, notes: null, updatedAt: now }
      : null,
  };
  await store.create(user);
  return { user, created: true, linked: false };
}
