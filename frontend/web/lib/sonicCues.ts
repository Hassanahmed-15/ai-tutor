/**
 * Non-speech audio cues for the blind-accessible player. Generated directly via the Web
 * Audio API (oscillators), not audio files — zero asset loading, instant playback, and
 * each cue is distinct enough to build real intuition through sound alone (e.g. you learn
 * "double chime = checkpoint" the same way you'd learn a doorbell, without needing to
 * parse speech for it).
 */

export type SonicCueName = "new-concept" | "checkpoint" | "correct" | "incorrect" | "transition" | "wake";

let ctx: AudioContext | null = null;
function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  return ctx;
}

function tone(when: number, freq: number, durationSec: number, gainPeak = 0.18, type: OscillatorType = "sine") {
  const audioCtx = getContext();
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, when);
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(gainPeak, when + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + durationSec);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(when);
  osc.stop(when + durationSec + 0.02);
}

/** Plays one of the five named cues. Safe to call with no audio context available (SSR/no-op). */
export function playCue(name: SonicCueName) {
  const audioCtx = getContext();
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") void audioCtx.resume();
  const t0 = audioCtx.currentTime;

  switch (name) {
    case "new-concept":
      // a short rising tone — "something new just appeared"
      tone(t0, 420, 0.18);
      tone(t0 + 0.1, 620, 0.22);
      break;
    case "checkpoint":
      // a distinct double-chime — unmistakably "your turn now"
      tone(t0, 740, 0.16, 0.2, "triangle");
      tone(t0 + 0.18, 980, 0.22, 0.2, "triangle");
      break;
    case "correct":
      // a warm major-third rise
      tone(t0, 523.25, 0.16, 0.2);
      tone(t0 + 0.1, 659.25, 0.26, 0.2);
      break;
    case "incorrect":
      // a low, brief buzz — clearly not punitive, just "try again"
      tone(t0, 180, 0.28, 0.16, "sawtooth");
      break;
    case "transition":
      // a soft tick between beats
      tone(t0, 300, 0.08, 0.1);
      break;
    case "wake":
      // a bright two-note "I'm listening" chime — the assistant just woke on the wake-word
      tone(t0, 660, 0.12, 0.22, "triangle");
      tone(t0 + 0.11, 990, 0.18, 0.22, "triangle");
      break;
  }
}

/** Must be called from inside a real user gesture (a click/keydown handler) to satisfy
 *  the browser's autoplay gate — mirrors lib/voice.ts's unlockAudio(). */
export function unlockSonicCues() {
  const audioCtx = getContext();
  if (audioCtx && audioCtx.state === "suspended") void audioCtx.resume();
}
