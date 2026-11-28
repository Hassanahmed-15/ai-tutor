"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Play, Square } from "lucide-react";
import { setVoiceChoice, voiceChoice } from "@/lib/voiceChoice";
import { teacherOf } from "@/lib/teachers";

/**
 * YOUR TEACHER (Settings → Preferences; owner 2026-11-28; lib/teachers.ts): Aria, Zara or Kai, each a voice and a personality. The voices this server has (/api/voices, lib/voices.ts), each
 * with a short sample to hear first. The choice applies at once and lives on this device, like Appearance; the
 * next lecture and the planning chat speak in it. Hidden while there is only one voice.
 */
type Voice = { key: string; label: string; hint: string };

export function VoicePicker({ labelClass, choiceStyle }: { labelClass: string; choiceStyle: (on: boolean) => React.CSSProperties }) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [chosen, setChosen] = useState<string>("aria");
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setChosen(voiceChoice() ?? "aria");
    const c = new AbortController();
    fetch("/api/voices", { cache: "no-store", signal: c.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setVoices(Array.isArray(d?.voices) ? d.voices : []))
      .catch(() => {});
    return () => { c.abort(); audio.current?.pause(); };
  }, []);

  if (voices.length < 2) return null;

  async function play(key: string) {
    audio.current?.pause();
    if (playing === key) { setPlaying(null); return; }
    setLoading(key);
    try {
      const res = await fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: teacherOf(key).sample, voice: key }) });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      const a = new Audio(url);
      audio.current = a;
      a.onended = () => { setPlaying(null); URL.revokeObjectURL(url); };
      setPlaying(key);
      await a.play();
    } catch {
      setPlaying(null);
    } finally {
      setLoading(null);
    }
  }

  return (
    <>
      <p id="set-voice-label" className={`${labelClass} mt-7`}>Your teacher</p>
      <div role="radiogroup" aria-labelledby="set-voice-label" className="grid gap-2 sm:grid-cols-3" data-voice-picker="">
        {voices.map((v) => {
          const on = chosen === v.key;
          return (
            <div key={v.key} className="flex items-center gap-2 rounded-[var(--radius)] border px-3.5 py-3 transition-colors" style={choiceStyle(on)}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => { setChosen(v.key); setVoiceChoice(v.key); }}
                className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
              >
                <span className="text-[0.875rem] font-medium text-[var(--hud-text)]">{v.label}</span>
                <span className="text-[0.75rem] leading-relaxed text-[var(--hud-text-dim)]">{v.hint}</span>
                <span className="text-[0.6875rem] leading-snug text-[var(--hud-text-faint)]">{teacherOf(v.key).description}</span>
              </button>
              <button
                type="button"
                onClick={() => void play(v.key)}
                aria-label={playing === v.key ? `Stop ${v.label}'s sample` : `Hear ${v.label}`}
                className="grid size-9 shrink-0 place-items-center rounded-full border border-[var(--hud-line)] text-[var(--hud-text-dim)] transition-colors hover:text-[var(--hud-text)]"
              >
                {loading === v.key ? <Loader2 size={15} className="animate-spin" aria-hidden /> : playing === v.key ? <Square size={13} aria-hidden /> : <Play size={14} aria-hidden />}
              </button>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[0.75rem] text-[var(--hud-text-dim)]">Their voice and their way of teaching, from your next lesson, on this device. Aria also asks at the end of planning.</p>
    </>
  );
}
