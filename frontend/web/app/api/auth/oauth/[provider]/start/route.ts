import { NextResponse } from "next/server";
import { OAUTH_COOKIE, appOrigin, authorizeUrl, isProviderId, newOAuthStart, oauthCookieOptions, providerConfig, redirectUri, signOAuthCookie } from "@/lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Continue with Google/Apple/Microsoft": remember this attempt in a signed cookie, go to the provider. */
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const origin = appOrigin(request);
  if (!isProviderId(provider)) return NextResponse.redirect(`${origin}/?auth_error=server`, 303);
  const cfg = providerConfig(provider);
  if (!cfg) return NextResponse.redirect(`${origin}/?auth_error=not-configured&auth_provider=${provider}`, 303);
  try {
    const start = newOAuthStart();
    const response = NextResponse.redirect(authorizeUrl(cfg, start, redirectUri(origin, provider)), 303);
    response.cookies.set(OAUTH_COOKIE, await signOAuthCookie(provider, start), oauthCookieOptions(origin));
    return response;
  } catch (error) {
    // e.g. AUTH_SECRET missing or too short: back to the sign-in screen with a message, never a raw 500.
    console.error(`[oauth] ${provider} sign-in could not start:`, error);
    return NextResponse.redirect(`${origin}/?auth_error=not-configured&auth_provider=${provider}`, 303);
  }
}
