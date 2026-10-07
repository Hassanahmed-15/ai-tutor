"use client";

import { useEffect, useRef, useState } from "react";
import { AriaAvatar, ARIA_HEADS, type AriaHead } from "@/components/avatar/AriaAvatar";
import { appendSpeechText, attachMouthAnalyser, beginSpeechScript, detachMouthAnalyser, endSpeechScript, extendSpeechAudio, onMouthShape, speechScriptDebug, visemeWeights, type MouthShape, type MouthToken } from "@/lib/adhd/mouth";
import type { AvatarState } from "@/lib/avatar/face";

/**
 * THE AVATAR LAB (development): Aria's face with a voice you can switch on without Gemini — your
 * microphone, or a synthetic "speech" (a buzzing voice-like tone, shaped into syllables) — so the
 * lip-sync, blink, sway and the four states can be checked on their own. `?head=Sasha&state=speaking`
 * presets it for screenshots.
 */
export default function AvatarLab() {
  const [head, setHead] = useState<AriaHead>("Jane");
  const [state, setState] = useState<AvatarState>("idle");
  const [source, setSource] = useState<"none" | "synth" | "mic" | "file">("none");
  const [sentence, setSentence] = useState("Peter and Mary bought fresh figs. The moon was full, so we sat by the sea and talked about photosynthesis.");
  const [mouth, setMouth] = useState<MouthShape>({ open: 0, width: 0.5 });
  const [visemeLine, setVisemeLine] = useState("");
  useEffect(() => {
    const id = window.setInterval(() => {
      const live = Object.entries(visemeWeights()).filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const d = speechScriptDebug();
      setVisemeLine(live.map(([k, v]) => `${k} ${v.toFixed(2)}`).join("  ") + (d ? `   script ${d.cursor}/${d.visemes} @${d.progress}` : ""));
    }, 100);
    return () => window.clearInterval(id);
  }, []);
  const [note, setNote] = useState("");
  const audioRef = useRef<{ ctx: AudioContext; token: MouthToken; stop: () => void } | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    queueMicrotask(() => {
      const h = p.get("head");
      if (h && (ARIA_HEADS as string[]).includes(h)) setHead(h as AriaHead);
      const s = p.get("state");
      if (s && ["idle", "listening", "thinking", "speaking"].includes(s)) setState(s as AvatarState);
      if (p.get("synth") === "1") void startSynth();
    });
    return () => stopAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => onMouthShape(setMouth), []);

  function stopAudio() {
    audioRef.current?.stop();
    audioRef.current = null;
    endSpeechScript();
    setSource("none");
  }

  /**
   * A recording of the sentence, played the way a Gemini reply is: the words handed to the script
   * first, the audio scheduled on the context's clock, the listener on the same bus.
   */
  async function playFileWithScript(file: File) {
    stopAudio();
    const ctx = new AudioContext();
    await ctx.resume();
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const bus = ctx.createGain();
    bus.connect(ctx.destination);
    const token = attachMouthAnalyser(ctx, bus);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(bus);
    const startAt = ctx.currentTime + 0.15;
    beginSpeechScript(startAt);
    appendSpeechText(sentence);
    extendSpeechAudio(startAt + buffer.duration);
    src.start(startAt);
    src.onended = () => { endSpeechScript(); detachMouthAnalyser(token); setSource("none"); };
    audioRef.current = { ctx, token, stop: () => { try { src.stop(); } catch { /* ended */ } detachMouthAnalyser(token); void ctx.close(); } };
    setSource("file");
    setState("speaking");
  }

  /** A voice-like buzz (a sawtooth at ~140 Hz through a formant-ish filter), opened and closed in syllables. */
  async function startSynth() {
    stopAudio();
    const ctx = new AudioContext();
    await ctx.resume();
    const bus = ctx.createGain();
    bus.gain.value = 0.7;
    bus.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 140;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.2;
    const env = ctx.createGain();
    env.gain.value = 0;
    osc.connect(filter).connect(env).connect(bus);
    osc.start();
    // Syllables: ~4 a second, alternating "ah" (open, low formant), "ee" (bright), "oo" (dark), with pauses.
    const pattern: Array<[number, number, number]> = [[0.9, 700, 0.22], [0.7, 2200, 0.18], [0.8, 450, 0.2], [0, 0, 0.25], [1, 900, 0.22], [0.6, 2400, 0.16], [0, 0, 0.6]];
    let i = 0;
    let t = ctx.currentTime + 0.05;
    const schedule = () => {
      while (t < ctx.currentTime + 1.2) {
        const [level, formant, dur] = pattern[i % pattern.length];
        env.gain.setTargetAtTime(level, t, 0.03);
        if (formant) filter.frequency.setTargetAtTime(formant, t, 0.02);
        env.gain.setTargetAtTime(0, t + dur * 0.8, 0.04);
        t += dur;
        i++;
      }
    };
    schedule();
    const timer = window.setInterval(schedule, 400);
    const token = attachMouthAnalyser(ctx, bus);
    audioRef.current = { ctx, token, stop: () => { window.clearInterval(timer); osc.stop(); detachMouthAnalyser(token); void ctx.close(); } };
    setSource("synth");
    setState("speaking");
  }

  async function startMic() {
    stopAudio();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      await ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      const token = attachMouthAnalyser(ctx, src);
      audioRef.current = { ctx, token, stop: () => { stream.getTracks().forEach((t) => t.stop()); detachMouthAnalyser(token); void ctx.close(); } };
      setSource("mic");
      setState("speaking");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Microphone unavailable");
    }
  }

  return (
    <main className="hud-canvas min-h-screen px-6 py-8 text-[var(--hud-text)]">
      <div className="relative z-10 mx-auto flex max-w-5xl flex-col gap-6 lg:flex-row">
        <div className="flex-1">
          <AriaAvatar state={state} head={head} className="aspect-[4/5] w-full max-w-md rounded-[20px] border border-[var(--hud-line)] bg-[var(--hud-surface)]" background="0x13132A" onUnavailable={(r) => setNote(`Unavailable: ${r}`)} />
        </div>
        <div className="flex w-full max-w-sm flex-col gap-5 text-[0.9rem]">
          <h1 className="font-display text-[1.6rem]">Avatar lab</h1>
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--hud-text-dim)]">Head</span>
            <div className="flex flex-wrap gap-2">
              {ARIA_HEADS.map((h) => (
                <button key={h} type="button" onClick={() => setHead(h)} aria-pressed={head === h} className={`rounded-full border px-3 py-1.5 ${head === h ? "border-[var(--hud-cyan)] text-[var(--hud-text)]" : "border-[var(--hud-line)] text-[var(--hud-text-dim)]"}`}>{h}</button>
              ))}
            </div>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--hud-text-dim)]">State</span>
            <div className="flex flex-wrap gap-2">
              {(["idle", "listening", "thinking", "speaking"] as AvatarState[]).map((s) => (
                <button key={s} type="button" onClick={() => setState(s)} aria-pressed={state === s} className={`rounded-full border px-3 py-1.5 ${state === s ? "border-[var(--hud-cyan)] text-[var(--hud-text)]" : "border-[var(--hud-line)] text-[var(--hud-text-dim)]"}`}>{s}</button>
              ))}
            </div>
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-[var(--hud-text-dim)]">Voice</span>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void startSynth()} aria-pressed={source === "synth"} className={`rounded-full border px-3 py-1.5 ${source === "synth" ? "border-[var(--hud-cyan)]" : "border-[var(--hud-line)] text-[var(--hud-text-dim)]"}`}>Synthetic speech</button>
              <button type="button" onClick={() => void startMic()} aria-pressed={source === "mic"} className={`rounded-full border px-3 py-1.5 ${source === "mic" ? "border-[var(--hud-cyan)]" : "border-[var(--hud-line)] text-[var(--hud-text-dim)]"}`}>My microphone</button>
              <button type="button" onClick={stopAudio} className="rounded-full border border-[var(--hud-line)] px-3 py-1.5 text-[var(--hud-text-dim)]">Stop</button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[var(--hud-text-dim)]">Sentence + recording (as a Gemini reply)</span>
            <textarea value={sentence} onChange={(e) => setSentence(e.target.value)} rows={2} className="w-full rounded-[var(--radius)] border border-[var(--hud-line)] bg-[var(--hud-surface)] px-3 py-2 text-[0.85rem] text-[var(--hud-text)]" data-sentence />
            <input type="file" accept="audio/*" data-speech-file onChange={(e) => { const f = e.target.files?.[0]; if (f) void playFileWithScript(f); }} className="text-[0.8rem] text-[var(--hud-text-dim)]" />
          </div>
          <div className="rounded-[var(--radius-lg)] border border-[var(--hud-line)] p-3 font-[family-name:var(--font-hud-mono)] text-[0.75rem] text-[var(--hud-text-dim)]" data-mouth>
            open {mouth.open.toFixed(2)} · width {mouth.width.toFixed(2)}
            <div className="mt-1 h-4" data-visemes>{visemeLine || "visemes: listening…"}</div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-[var(--hud-surface-2)]"><div className="h-full rounded-full bg-[var(--hud-cyan)]" style={{ width: `${Math.round(mouth.open * 100)}%` }} /></div>
          </div>
          {note && <p className="text-[0.8rem] text-[var(--hud-warn)]">{note}</p>}
        </div>
      </div>
    </main>
  );
}
