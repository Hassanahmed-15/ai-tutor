import { AsyncLocalStorage } from "node:async_hooks";
import { TEACHERS } from "./teachers";

/**
 * ARIA'S VOICES (owner 2026-11-28: "clone them and add in settings if someone wants to change the voice"). Each is
 * a cloned Gemini 3.8 Flash TTS voice, made from a recording with the speaker's own recorded consent. Only voices
 * whose id is set are offered:
 *   - "aria": GEMINI_TTS_VOICE, the voice every lecture has used since 2026-11-12 (the default);
 *   - "minahil": GEMINI_TTS_VOICE_MINAHIL, Minahil's voice, with her consent.
 * The student's choice is kept in their browser (lib/voiceChoice.ts) and sent with every voice request and every
 * lecture; on the server it is held for the request (or worker task) by `withVoice`, so narration code reads it
 * without being handed it. Clip paths include the voice id, so voices never mix, and "aria" keeps exactly the
 * paths it had, so no stored clip is made again.
 */
export type VoiceOption = { key: string; label: string; hint: string; voiceId: string };

export function voiceCatalog(env: Record<string, string | undefined> = process.env): VoiceOption[] {
  const out: VoiceOption[] = [];
  // The teachers (lib/teachers.ts): Aria on her own voice, Zara on Minahil's, Kai on Hassan's (both with consent).
  const ids: Record<string, string | undefined> = { aria: env.GEMINI_TTS_VOICE, zara: env.GEMINI_TTS_VOICE_MINAHIL, kai: env.GEMINI_TTS_VOICE_HASSAN };
  for (const t of TEACHERS) {
    const id = ids[t.key];
    if (id) out.push({ key: t.key, label: t.name, hint: t.trait, voiceId: id });
  }
  return out;
}

/** A voice key from a request: short, lower case; anything else is no choice. */
export function cleanVoiceKey(v: unknown): string | undefined {
  const s = String(v ?? "").trim().toLowerCase();
  return /^[a-z0-9-]{1,24}$/.test(s) ? s : undefined;
}

const scope = new AsyncLocalStorage<string>();

/** Runs `fn` with this voice chosen (no key: the default). */
export function withVoice<T>(key: string | undefined | null, fn: () => T): T {
  const k = cleanVoiceKey(key);
  return k ? scope.run(k, fn) : fn();
}

/** The voice chosen for this request or task: a known key, else "aria". */
export function chosenVoiceKey(env: Record<string, string | undefined> = process.env): string {
  const k = scope.getStore();
  return k && voiceCatalog(env).some((v) => v.key === k) ? k : "aria";
}

/** The Gemini voice id for this request or task. */
export function chosenVoiceId(env: Record<string, string | undefined> = process.env): string {
  const key = chosenVoiceKey(env);
  return voiceCatalog(env).find((v) => v.key === key)?.voiceId ?? env.GEMINI_TTS_VOICE ?? "";
}
