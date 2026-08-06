import { useCallback, useEffect, useRef } from "react";

/**
 * Environmental audio, synthesised rather than sampled.
 *
 * Every sound here is generated with WebAudio oscillators and filtered noise — no audio files.
 * That is a deliberate choice: shipping a set of free sound effects would mean several megabytes
 * of download, inconsistent recording quality between sources, and licence tracking, for sounds
 * the listener should barely consciously notice. Synthesised footsteps and room tone are
 * indistinguishable at the volume they play at, cost zero bytes, and can be parameterised — so a
 * footstep on carpet genuinely differs from one on concrete rather than being a different file.
 *
 * Everything is gated behind the accessibility profile: `quietWorld` silences ambience entirely,
 * because unpredictable background sound is a real barrier for sensory-sensitive and autistic
 * users, not a nice-to-have setting.
 */

export type FloorMaterial = "concrete" | "oak" | "carpet" | "rubber" | "grass";

/** Per-surface footstep character: brightness, decay, and level. */
const FOOTSTEP_PROFILE: Record<FloorMaterial, { cutoff: number; decay: number; gain: number; tone: number }> = {
  concrete: { cutoff: 2600, decay: 0.16, gain: 0.32, tone: 190 },
  oak: { cutoff: 1900, decay: 0.13, gain: 0.26, tone: 150 },
  carpet: { cutoff: 750, decay: 0.09, gain: 0.14, tone: 95 },
  rubber: { cutoff: 1100, decay: 0.1, gain: 0.17, tone: 120 },
  grass: { cutoff: 1500, decay: 0.11, gain: 0.15, tone: 110 },
};

export function useAmbientAudio({
  enabled,
  quiet,
}: {
  enabled: boolean;
  quiet: boolean;
}) {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const roomToneRef = useRef<{ source: AudioBufferSourceNode; gain: GainNode } | null>(null);
  const noiseBufferRef = useRef<AudioBuffer | null>(null);
  const lastStepRef = useRef(0);

  const context = useCallback(() => {
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      ctxRef.current = ctx;
      masterRef.current = master;

      // One reusable noise buffer — regenerating white noise per footstep would allocate a fresh
      // multi-thousand-sample array dozens of times a minute for no audible benefit.
      const length = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      noiseBufferRef.current = buffer;
    }
    if (ctxRef.current.state === "suspended") void ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  // Master level follows the accessibility profile.
  useEffect(() => {
    const master = masterRef.current;
    if (!master || !ctxRef.current) return;
    const target = !enabled || quiet ? 0 : 0.5;
    master.gain.setTargetAtTime(target, ctxRef.current.currentTime, 0.25);
  }, [enabled, quiet]);

  /**
   * Continuous room tone: filtered noise standing in for HVAC hum and building background.
   * Real interiors are never silent, and total silence is one of the strongest cues that a space
   * is simulated. Cutoff shifts per room so a big atrium sounds different from a small classroom.
   */
  const setRoomTone = useCallback(
    (size: "small" | "large" | "outdoor") => {
      if (!enabled || quiet) return;
      const ctx = context();
      const buffer = noiseBufferRef.current;
      const master = masterRef.current;
      if (!buffer || !master) return;

      roomToneRef.current?.source.stop();
      roomToneRef.current?.gain.disconnect();

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = size === "large" ? 320 : size === "outdoor" ? 900 : 480;
      filter.Q.value = 0.4;

      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(size === "outdoor" ? 0.035 : 0.022, ctx.currentTime, 0.6);

      source.connect(filter).connect(gain).connect(master);
      source.start();
      roomToneRef.current = { source, gain };
    },
    [context, enabled, quiet],
  );

  /**
   * A footstep. Two layers: a filtered noise transient (the scuff) and a short low sine (the
   * body/impact). Slight random pitch and level variation per step, because perfectly identical
   * repeated footsteps are immediately recognisable as synthetic.
   */
  const footstep = useCallback(
    (material: FloorMaterial, running: boolean) => {
      if (!enabled || quiet) return;
      const now = performance.now();
      const interval = running ? 260 : 430;
      if (now - lastStepRef.current < interval) return;
      lastStepRef.current = now;

      const ctx = context();
      const buffer = noiseBufferRef.current;
      const master = masterRef.current;
      if (!buffer || !master) return;

      const profile = FOOTSTEP_PROFILE[material];
      const variation = 0.86 + Math.random() * 0.28;
      const level = profile.gain * (running ? 1.35 : 1) * variation * 0.5;
      const t = ctx.currentTime;

      // Scuff layer.
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      noise.playbackRate.value = 0.8 + Math.random() * 0.4;
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = "bandpass";
      noiseFilter.frequency.value = profile.cutoff * variation;
      noiseFilter.Q.value = 0.7;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(level, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + profile.decay);
      noise.connect(noiseFilter).connect(noiseGain).connect(master);
      noise.start(t);
      noise.stop(t + profile.decay + 0.02);

      // Impact body.
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(profile.tone * variation, t);
      osc.frequency.exponentialRampToValueAtTime(profile.tone * 0.55, t + profile.decay);
      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(level * 0.5, t);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, t + profile.decay * 0.9);
      osc.connect(oscGain).connect(master);
      osc.start(t);
      osc.stop(t + profile.decay);
    },
    [context, enabled, quiet],
  );

  /** Door latch/swing — a short wooden knock plus a brief air sweep. */
  const doorSound = useCallback(
    (opening: boolean) => {
      if (!enabled || quiet) return;
      const ctx = context();
      const buffer = noiseBufferRef.current;
      const master = masterRef.current;
      if (!buffer || !master) return;
      const t = ctx.currentTime;

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(opening ? 700 : 460, t);
      filter.frequency.exponentialRampToValueAtTime(opening ? 320 : 190, t + 0.24);
      filter.Q.value = 1.1;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
      noise.connect(filter).connect(gain).connect(master);
      noise.start(t);
      noise.stop(t + 0.3);
    },
    [context, enabled, quiet],
  );

  useEffect(() => {
    return () => {
      roomToneRef.current?.source.stop();
      void ctxRef.current?.close();
      ctxRef.current = null;
    };
  }, []);

  return { footstep, doorSound, setRoomTone, unlock: context };
}
