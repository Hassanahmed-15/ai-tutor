import { NextResponse } from "next/server";
import { voiceCatalog } from "@/lib/voices";
import { geminiVoiceOn } from "@/lib/geminiVoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The voices a student may choose in Settings (lib/voices.ts): labels only, never the voice ids. */
export async function GET() {
  const voices = geminiVoiceOn() ? voiceCatalog().map(({ key, label, hint }) => ({ key, label, hint })) : [];
  return NextResponse.json({ voices });
}
