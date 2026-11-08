/**
 * A simulated voice outage for the TTS test page (app/api/tts/outage). Dev only — in production it is
 * never on. Kept on globalThis so the outage route and /api/tts see the same switch across hot reloads.
 */
const state = globalThis as typeof globalThis & { __ariaTtsOutageUntil?: number };

export function simulateTtsOutage(ms: number): void {
  if (process.env.NODE_ENV === "production") return;
  state.__ariaTtsOutageUntil = Date.now() + ms;
}

export function ttsOutageLeftMs(): number {
  if (process.env.NODE_ENV === "production") return 0;
  return Math.max(0, (state.__ariaTtsOutageUntil ?? 0) - Date.now());
}
