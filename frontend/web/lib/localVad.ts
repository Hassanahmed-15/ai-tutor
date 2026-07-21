"use client";

export type VadState = "idle" | "listening" | "speaking" | "cooldown";

export type VadEvent =
  | { type: "state"; state: VadState }
  | { type: "volume"; volume: number; noiseFloor: number }
  | { type: "speechstart"; volume: number; noiseFloor: number }
  | { type: "speechend"; volume: number; noiseFloor: number };

export type LocalVadOptions = {
  minSpeechMs?: number;
  silenceMs?: number;
  cooldownMs?: number;
  thresholdMultiplier?: number;
  minThreshold?: number;
  onEvent?: (event: VadEvent) => void;
  shouldDetectSpeech?: () => boolean;
};

export type LocalVadController = {
  start: () => Promise<boolean>;
  stop: () => void;
  setCooldown: (ms?: number) => void;
  getState: () => VadState;
};

const DEFAULTS = {
  minSpeechMs: 180,
  silenceMs: 650,
  cooldownMs: 900,
  thresholdMultiplier: 2.2,
  minThreshold: 0.035,
};

export function createLocalVad(options: LocalVadOptions = {}): LocalVadController {
  const config = { ...DEFAULTS, ...options };
  let state: VadState = "idle";
  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let frame: number | null = null;
  let running = false;
  let session = 0;
  let noiseFloor = 0.018;
  let speechCandidateSince = 0;
  let silenceSince = 0;
  let cooldownUntil = 0;
  let lastVolumeEventAt = 0;

  const emit = (event: VadEvent) => options.onEvent?.(event);
  const setState = (next: VadState) => {
    if (state === next) return;
    state = next;
    emit({ type: "state", state });
  };

  const stop = () => {
    running = false;
    session += 1;
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    void audioContext?.close();
    audioContext = null;
    speechCandidateSince = 0;
    silenceSince = 0;
    setState("idle");
  };

  const setCooldown = (ms = config.cooldownMs) => {
    cooldownUntil = Date.now() + ms;
    speechCandidateSince = 0;
    silenceSince = 0;
    if (running) setState("cooldown");
  };

  const start = async () => {
    if (running || stream) return true;
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;
    running = true;
    const currentSession = session + 1;
    session = currentSession;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (!running || session !== currentSession) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
        return false;
      }

      const AudioContextCtor =
        window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        stop();
        return false;
      }

      audioContext = new AudioContextCtor();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.35;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      setState("listening");

      const tick = () => {
        if (!running || session !== currentSession || !audioContext) return;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i += 1) {
          const centered = (samples[i] - 128) / 128;
          sum += centered * centered;
        }

        const volume = Math.sqrt(sum / samples.length);
        const now = Date.now();
        const threshold = Math.max(config.minThreshold, noiseFloor * config.thresholdMultiplier);
        const canDetect = options.shouldDetectSpeech?.() ?? true;

        if (now - lastVolumeEventAt > 120) {
          lastVolumeEventAt = now;
          emit({ type: "volume", volume, noiseFloor });
        }

        if (!canDetect || now < cooldownUntil) {
          noiseFloor = noiseFloor * 0.97 + volume * 0.03;
          speechCandidateSince = 0;
          silenceSince = 0;
          if (state !== "cooldown") setState(now < cooldownUntil ? "cooldown" : "listening");
          frame = requestAnimationFrame(tick);
          return;
        }

        if (state !== "speaking" && volume < threshold * 0.85) {
          noiseFloor = noiseFloor * 0.965 + volume * 0.035;
        }

        if (volume > threshold) {
          silenceSince = 0;
          speechCandidateSince ||= now;
          if (state !== "speaking" && now - speechCandidateSince >= config.minSpeechMs) {
            setState("speaking");
            emit({ type: "speechstart", volume, noiseFloor });
          }
        } else {
          speechCandidateSince = 0;
          if (state === "speaking") {
            silenceSince ||= now;
            if (now - silenceSince >= config.silenceMs) {
              emit({ type: "speechend", volume, noiseFloor });
              setCooldown(config.cooldownMs);
            }
          } else if (state !== "listening") {
            setState("listening");
          }
        }

        frame = requestAnimationFrame(tick);
      };

      frame = requestAnimationFrame(tick);
      return true;
    } catch {
      stop();
      return false;
    }
  };

  return {
    start,
    stop,
    setCooldown,
    getState: () => state,
  };
}
