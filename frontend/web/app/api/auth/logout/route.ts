import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { REFRESH_COOKIE, clearAuthCookies, revokeSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const jar = await cookies();
  const refresh = jar.get(REFRESH_COOKIE)?.value;
  // Revoke server-side as well as clearing the cookies: dropping the cookie only stops THIS
  // browser from presenting the token, it does not stop a copied token from working.
  if (refresh) await revokeSession(refresh).catch(() => undefined);
  await clearAuthCookies();
  return NextResponse.json({ ok: true });
}
