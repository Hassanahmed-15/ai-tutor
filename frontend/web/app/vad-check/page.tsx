"use client";
/** Dev-only: proves the Silero model loads and separates speech from noise in a real browser. */
import { useEffect, useState } from "react";
import { SileroVad } from "@/lib/voice/sileroVad";

const RATE = 16_000;
/** A vowel: harmonic source shaped by three formants. A bare harmonic stack is not speech enough. */
function voice(f0: number, n: number) {
  const out = new Float32Array(n);
  const F = [[730, 90], [1090, 110], [2440, 140]];
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const syl = Math.max(0, Math.sin(2 * Math.PI * 3.5 * t)) ** 0.5;
    let s = 0;
    for (let h = 1; h <= 30; h++) {
      const hz = f0 * h;
      if (hz > 4000) break;
      let gain = 0;
      for (const [fc, bw] of F) gain += 1 / (1 + ((hz - fc) / bw) ** 2);
      s += (gain / h) * Math.sin(2 * Math.PI * hz * t);
    }
    out[i] = s * 0.12 * syl;
  }
  return out;
}
function fan(n: number) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / RATE; out[i] = 0.35 * (Math.sin(2*Math.PI*60*t)*0.6 + Math.sin(2*Math.PI*120*t)*0.3); }
  return out;
}
function hiss(n: number, seed = 7) {
  const out = new Float32Array(n); let x = seed|0;
  for (let i = 0; i < n; i++) { x ^= x<<13; x ^= x>>>17; x ^= x<<5; out[i] = ((x>>>0)/0xffffffff*2-1)*0.25; }
  return out;
}

export default function VadCheck() {
  const [log, setLog] = useState<string[]>(["loading model…"]);
  useEffect(() => {
    (async () => {
      const t0 = performance.now();
      const vad = await SileroVad.load();
      if (!vad) { setLog(["MODEL FAILED TO LOAD"]); return; }
      const loadMs = Math.round(performance.now() - t0);
      const lines: string[] = [`model loaded in ${loadMs}ms`];
      const cases: Array<[string, Float32Array]> = [
        ["speech 130Hz", voice(130, RATE)],
        ["speech 210Hz", voice(210, RATE)],
        ["fan / AC", fan(RATE)],
        ["hiss / noise", hiss(RATE)],
      ];
      for (const [name, pcm] of cases) {
        vad.reset();
        let peak = 0; const t = performance.now();
        for (let o = 0; o + 320 <= pcm.length; o += 320) {
          const r = await vad.push(pcm.subarray(o, o + 320));
          peak = Math.max(peak, r.speech);
        }
        const perFrame = ((performance.now() - t) / (pcm.length / 320)).toFixed(2);
        lines.push(`${name}: peak speech=${peak.toFixed(3)} (${perFrame}ms/frame)`);
      }
      const peakOf = (name: string) => Number(lines.find((l) => l.startsWith(name))?.match(/peak speech=([\d.]+)/)?.[1] ?? 0);
      const speech = Math.max(peakOf("speech 130Hz"), peakOf("speech 210Hz"));
      const noise = Math.max(peakOf("fan / AC"), peakOf("hiss / noise"));
      lines.push(speech > noise * 4 && speech > 0.3 ? `VERDICT: PASS (speech ${speech.toFixed(2)} vs noise ${noise.toFixed(2)})` : `VERDICT: FAIL (speech ${speech.toFixed(2)} vs noise ${noise.toFixed(2)})`);
      setLog(lines);
    })();
  }, []);
  return <pre data-vad style={{ padding: 20, fontFamily: "monospace", color: "#ddd", background: "#111", minHeight: "100vh" }}>{log.join("\n")}</pre>;
}
