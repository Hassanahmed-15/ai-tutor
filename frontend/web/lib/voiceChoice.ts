/**
 * THE STUDENT'S CHOSEN VOICE in the browser (Settings → Preferences → Voice; lib/voices.ts has the voices). Kept on
 * this device, like the theme; sent with every voice request (/api/tts, /api/voice/say) and every new lecture, so
 * the board narration and the planning chat speak in it. No choice = Aria's own voice.
 */
const KEY = "aria.voice";

export function voiceChoice(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(KEY); } catch { return null; }
}

export function setVoiceChoice(key: string | null): void {
  try {
    if (key && key !== "aria") window.localStorage.setItem(KEY, key);
    else window.localStorage.removeItem(KEY);
  } catch { /* private mode: Aria's voice */ }
  window.dispatchEvent(new CustomEvent("aria:voice-changed", { detail: key ?? "aria" }));
}

/** The JSON body fields for a voice request: `{ voice }` when the student chose one. */
export function voiceField(): { voice?: string } {
  const v = voiceChoice();
  return v ? { voice: v } : {};
}
