"use client";

import { useEffect, useState } from "react";
import { SileroVad } from "@/lib/turn/sileroVad";
import { SPEECH_CAST, VOWEL_A, fan, formantVoice, music, noise, seq, speechVoice, traffic, voice } from "@/lib/turn/signals";

/**
 * Calibration: what the neural VAD actually scores for each synthetic signal in THIS browser.
 *
 * The scenario suite's verdicts depend on these numbers. A generator the model scores below the
 * 0.35 threshold cannot stand in for a student in a neural-VAD run, whatever the heuristics say.
 */
export default function VadCheck() {
  const [lines, setLines] = useState<string[]>(["loading Silero…"]);
  useEffect(() => {
    (async () => {
      const t0 = performance.now();
      const vad = await SileroVad.load();
      if (!vad) { setLines(["MODEL FAILED TO LOAD"]); return; }
      const out = [`model loaded in ${Math.round(performance.now() - t0)} ms`];
      const cases: Array<[string, Float32Array[]]> = [
        ["bare harmonic voice 130 Hz (old generator)", seq(75, (i) => voice(130, i))],
        ["held formant vowel 130 Hz, soft envelope", seq(75, (i) => formantVoice(130, i, 0.14, VOWEL_A, "soft"))],
        ["held formant vowel 130 Hz, hard envelope", seq(75, (i) => formantVoice(130, i, 0.14, VOWEL_A, "hard"))],
        ["speech-shaped voice 130 Hz (SPEECH_CAST student)", seq(75, (i) => SPEECH_CAST.STUDENT(i))],
        ["speech-shaped voice 215 Hz (SPEECH_CAST friend)", seq(75, (i) => SPEECH_CAST.FRIEND(i))],
        ["speech-shaped voice, whisper level 0.06", seq(75, (i) => speechVoice(130, i, 0.06, 1))],
        ["fan / AC", seq(75, (i) => fan(0.35, i))],
        ["traffic", seq(75, (i) => traffic(0.3, i))],
        ["TV chord", seq(75, (i) => music(0.12, i))],
        ["hiss", seq(75, (i) => noise(0.25, i + 7))],
      ];
      for (const [name, frames] of cases) {
        vad.reset();
        let peak = 0;
        let above = 0;
        const t = performance.now();
        for (const frame of frames) {
          const p = await vad.push(frame);
          peak = Math.max(peak, p);
          if (p >= 0.35) above += 1;
        }
        out.push(`${name}: peak ${peak.toFixed(3)} · ${above}/${frames.length} frames ≥ 0.35 · ${((performance.now() - t) / frames.length).toFixed(2)} ms/frame`);
        setLines([...out]);
      }
    })();
  }, []);
  return (
    <main style={{ padding: 24, fontFamily: "ui-monospace, monospace", fontSize: 13 }}>
      <h1 style={{ fontSize: 16 }}>Silero calibration</h1>
      {lines.map((line, i) => <div key={i} data-vad-line>{line}</div>)}
    </main>
  );
}
