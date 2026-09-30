# Social sign-in (Google, Microsoft, Apple)

The sign-in screen always shows **Continue with Google / Apple / Microsoft**. A provider works as
soon as its keys are set in the environment; until then its button tells the student that it
isn't set up yet and to use email. `GET /api/auth/providers` reports which are configured.

## How it works

- `GET /api/auth/oauth/{provider}/start` → redirects to the provider (authorization-code flow;
  PKCE for Google and Microsoft; Apple uses `response_mode=form_post`). State, nonce and the PKCE
  verifier travel in a signed, 10-minute `aria_oauth` cookie scoped to `/api/auth/oauth`.
- `GET|POST /api/auth/oauth/{provider}/callback` → checks state, exchanges the code, verifies the
  ID token against the provider's published keys (issuer, audience, expiry, nonce), then:
  1. an account already linked to that provider identity → signed in;
  2. otherwise an account with the same email **and the provider says the email is verified** →
     the identity is linked to it (Microsoft work/school accounts count only with the `xms_edov`
     claim; personal Microsoft accounts are verified);
  3. same email but not verified → refused, with a message to sign in with the password first;
  4. otherwise a new account (auto-generated username, editable in settings) → onboarding.
- Errors come back as `/?auth_error=<code>&auth_provider=<id>` and are shown on the sign-in screen.

Code: `lib/oauth.ts`, `lib/oauthAccounts.ts`, `app/api/auth/oauth/[provider]/`. Tests:
`lib/anim/socialSignIn.test.ts`.

## Redirect URIs

Register exactly these (swap in `http://localhost:3000` for local development — Apple requires
https, so test Apple on the deployment):

```
{APP_URL}/api/auth/oauth/google/callback
{APP_URL}/api/auth/oauth/microsoft/callback
{APP_URL}/api/auth/oauth/apple/callback
```

Set `APP_URL` to the public origin in production so the redirect URI never depends on proxy headers.

## Google

1. Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID →
   *Web application*.
2. Authorised redirect URI: `{APP_URL}/api/auth/oauth/google/callback`.
3. OAuth consent screen: scopes `openid`, `email`, `profile`; publish the app when ready.
4. Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

## Microsoft

1. Microsoft Entra admin center → App registrations → New registration.
   Supported account types: *Accounts in any organizational directory and personal Microsoft
   accounts* (for `MICROSOFT_TENANT_ID=common`).
2. Platform *Web*, redirect URI `{APP_URL}/api/auth/oauth/microsoft/callback`.
3. Certificates & secrets → New client secret (copy the **value**).
4. Token configuration → Add optional claim → ID token → `email` and `xms_edov` (so work/school
   emails can be linked to existing accounts).
5. Env: `MICROSOFT_CLIENT_ID` (Application ID), `MICROSOFT_CLIENT_SECRET`, optionally
   `MICROSOFT_TENANT_ID`.

## Apple

1. Apple Developer → Identifiers → an App ID with *Sign in with Apple* enabled.
2. Identifiers → Services IDs → new Services ID (this is `APPLE_CLIENT_ID`) → enable Sign in with
   Apple → domain = the app's host, return URL = `{APP_URL}/api/auth/oauth/apple/callback`.
3. Keys → new key with *Sign in with Apple* → download the `.p8` (only downloadable once).
4. Env: `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the `.p8`
   contents with newlines written as `\n`).

Apple sends the student's name only on their first sign-in; it is saved as the display name then.
Students who choose *Hide my email* get a private relay address, which becomes the account email.

## Azure

Add the variables to the web container app with a **containers-only** REST PATCH (see the deploy
notes) and keep secrets as Container Apps secrets referenced by `secretRef`.
