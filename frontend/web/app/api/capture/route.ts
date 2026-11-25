import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { lessonCaller } from "@/lib/auth";
import { createSession } from "@/lib/capture/session";
import { captureBaseUrl } from "@/lib/capture/lanUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A NEW PHONE CAPTURE: the QR code the computer shows. Its link opens /capture/<id> on the phone with the secret in
 * the URL's fragment (#t=…), so it never reaches a server log or a Referer. The QR is drawn here as SVG.
 */
export async function POST(request: Request) {
  const auth = await lessonCaller();
  if (!auth) return NextResponse.json({ error: "Sign in to use your phone." }, { status: 401 });
  const spendTag = request.headers.get("x-aria-spend")?.slice(0, 80) || null;
  const { session, token } = await createSession(auth.userId, spendTag);
  const { base, lan } = captureBaseUrl(request.url);
  const url = `${base}/capture/${session.id}#t=${token}`;
  const qrSvg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1, width: 240 });
  // In development the phone page is compiled on its first visit (10 s or more): start that now, not when the phone arrives.
  if (process.env.NODE_ENV !== "production") void fetch(new URL(`/capture/${session.id}`, request.url)).catch(() => undefined);
  return NextResponse.json({ id: session.id, url, qrSvg, lan, expiresAt: session.expiresAt });
}
