"use client";

/**
 * The canvas's three sounds — a pencil scratch when ink goes down, a soft whoosh when the camera
 * flies, a tick when Aria's pen taps — synthesised with Web Audio, so there are no files to load.
 *
 * OFF BY DEFAULT and quiet when on. The research is blunt about sound under narration: added sound
 * effects and music lowered both retention and transfer (Moreno & Mayer 2000). These are brief cues
 * at moments of change, never a bed under Aria's voice, and the student switches them on.
 */

const KEY = "aria.canvas.sound";
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
const lastPlayed: Record<string, number> = {};

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // A blocked store just means the choice is not remembered.
  }
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    if (!noise) {
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return ctx;
  } catch {
    return null;
  }
}

/** One short, enveloped burst of filtered noise or tone. Throttled per kind. */
function play(kind: string, minGapMs: number, build: (a: AudioContext, out: GainNode) => void, volume: number) {
  if (!soundEnabled()) return;
  const now = performance.now();
  if (now - (lastPlayed[kind] ?? 0) < minGapMs) return;
  lastPlayed[kind] = now;
  const a = audio();
  if (!a) return;
  const out = a.createGain();
  out.gain.value = volume;
  out.connect(a.destination);
  build(a, out);
}

/** Graphite on paper: band-passed noise with a quick, uneven envelope. */
export function playScratch(): void {
  play("scratch", 650, (a, out) => {
    const src = a.createBufferSource();
    src.buffer = noise;
    const band = a.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 3200;
    band.Q.value = 0.9;
    const env = a.createGain();
    const t = a.currentTime;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.02);
    env.gain.linearRampToValueAtTime(0.45, t + 0.12);
    env.gain.linearRampToValueAtTime(0.8, t + 0.2);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    src.connect(band).connect(env).connect(out);
    src.start(t, Math.random() * 0.5, 0.4);
  }, 0.05);
}

/** Air past the camera: low-passed noise whose cutoff sweeps up and back. */
export function playWhoosh(): void {
  play("whoosh", 900, (a, out) => {
    const src = a.createBufferSource();
    src.buffer = noise;
    const low = a.createBiquadFilter();
    low.type = "lowpass";
    const env = a.createGain();
    const t = a.currentTime;
    low.frequency.setValueAtTime(300, t);
    low.frequency.exponentialRampToValueAtTime(1800, t + 0.35);
    low.frequency.exponentialRampToValueAtTime(400, t + 0.8);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.3);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
    src.connect(low).connect(env).connect(out);
    src.start(t, Math.random() * 0.3, 0.9);
  }, 0.07);
}

/** The pen touching the board: a tiny, high, soft click. */
export function playTick(): void {
  play("tick", 250, (a, out) => {
    const osc = a.createOscillator();
    osc.type = "sine";
    const env = a.createGain();
    const t = a.currentTime;
    osc.frequency.setValueAtTime(1900, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.05);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + 0.08);
  }, 0.06);
}
