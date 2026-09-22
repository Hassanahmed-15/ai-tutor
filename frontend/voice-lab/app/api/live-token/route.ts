import { NextResponse } from "next/server";

/**
 * Ephemeral Gemini Live token for the lab's future model adapter. Mirrors production's minting
 * (single use, generous window so a slow permission prompt cannot expire it) without any of the
 * lesson personas — the lab has no lesson. Returns 503 until GEMINI_API_KEY is set on Vercel,
 * which is fine: every turn-taking test in the lab runs against the local tutor voice.
 */
export async function POST() {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY is not set on this deployment." }, { status: 503 });
  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ uses: 1, expireTime, newSessionExpireTime }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.name !== "string") {
      return NextResponse.json({ error: typeof data.error?.message === "string" ? data.error.message : "token minting failed" }, { status: 502 });
    }
    return NextResponse.json({ token: data.name, model: process.env.GEMINI_LIVE_MODEL ?? "gemini-3.8-live", expireTime });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "token minting failed" }, { status: 502 });
  }
}
