"use client";

/**
 * `/tts-lab` — Aria's narration on its own: no planning, no boards, no visuals (owner, 2026-11-07: "create a
 * testing environment so that I can test just TTS without making the entire lecture").
 *
 * Dev only. Text is pasted, or taken from a saved lecture's boards (each board's spoken sentences, as the
 * worker makes them: lib/narrationText.ts boardSpokenSentences). Then:
 *   - Make ahead: what the worker does before a board is ready (POST /api/tts/prepare), sentence by sentence.
 *   - Play: the real player (lib/voice.ts playNarration, Aria's voice only). Each clip shows where it came
 *     from (memory, stored, made live), how long it took to arrive, and the silence before it was heard.
 *   - Measure live: each sentence made fresh, bypassing memory and storage — today's live latency, to compare.
 * The only spend is narration.
 */
import { useEffect, useRef, useState } from "react";
import { playNarration, unlockAudio, type ClipReport, type NarrationHandle } from "@/lib/voice";
import { boardSpokenSentences, splitNarrationSentences } from "@/lib/narrationText";

type Row = {
  text: string;
  prepared?: { source: string; ms: number; costUsd: number };
  clip?: { source: string; ms: number; attempts: number; costUsd: number; status: number };
  heardAt?: number;
  gapMs?: number;
  live?: { ms: number; ok: boolean };
};
type Board = { title: string; sentences: string[] };

const SAMPLE =
  "An AVL tree keeps itself balanced. At every node, the heights of the left and right subtrees differ by at most one. " +
  "When an insertion breaks that rule, a rotation fixes it. The middle value rises, and the other two become its children.";

const SOURCE_LABEL: Record<string, string> = { hit: "memory", stored: "stored", shared: "shared", miss: "made live", made: "made now", later: "still being made", failed: "failed" };
const tone = (source?: string) =>
  source === "stored" || source === "hit" ? "text-emerald-300" : source === "miss" || source === "made" || source === "later" ? "text-amber-300" : source === "failed" ? "text-rose-300" : "text-slate-400";

export default function TtsLab() {
  const [text, setText] = useState(SAMPLE);
  const [sessionId, setSessionId] = useState("");
  const [boards, setBoards] = useState<Board[]>([]);
  const [board, setBoard] = useState(-1);
  const [rows, setRows] = useState<Row[]>(() => splitNarrationSentences(SAMPLE).map((t) => ({ text: t })));
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [firstSoundMs, setFirstSoundMs] = useState<number | null>(null);
  // The lecture's last fallback, watched: paused on a sentence until Aria's voice is back (lib/voice.ts onVoiceWaiting).
  const [waitingOn, setWaitingOn] = useState<number | null>(null);
  const [pausedMs, setPausedMs] = useState(0);
  const waitStarted = useRef<number | null>(null);
  const handle = useRef<NarrationHandle | null>(null);
  const playStarted = useRef(0);
  const lastHeard = useRef<{ at: number; spokenMs: number } | null>(null);

  const sentences = rows.map((r) => r.text);
  const patch = (i: number, change: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...change } : r)));
  const applySentences = (list: string[]) => { handle.current?.cancel(); setRows(list.map((t) => ({ text: t }))); setFirstSoundMs(null); };

  // The player's clip fetches (lib/voice.ts reportClip): which sentence, where it came from, how long it took.
  useEffect(() => {
    const onClip = (event: Event) => {
      const r = (event as CustomEvent<ClipReport>).detail;
      setRows((rs) => rs.map((row) => (row.text === r.text.trim() ? { ...row, clip: { source: r.source || (r.status ? `error ${r.status}` : "no answer"), ms: r.ms, attempts: r.attempt + 1, costUsd: r.costUsd, status: r.status } } : row)));
    };
    window.addEventListener("aria:tts-clip", onClip);
    return () => window.removeEventListener("aria:tts-clip", onClip);
  }, []);

  async function loadLecture() {
    setBusy("load");
    setNote("");
    try {
      const res = await fetch(`/api/progressive-lectures/${encodeURIComponent(sessionId.trim())}`);
      if (!res.ok) throw new Error(`could not load the lecture (${res.status}) — is it yours, and are you signed in?`);
      const snap = (await res.json()) as { topic?: string; beats?: Array<{ title?: string; script?: string; draw?: { ops?: Array<{ kind?: string; spec?: unknown }> } } | null> };
      const list = (snap.beats ?? []).flatMap((b, i) => (b ? [{ title: `${i + 1}. ${b.title ?? "Board"}`, sentences: boardSpokenSentences(b) }] : []));
      setBoards(list);
      setBoard(list.length ? 0 : -1);
      if (list.length) applySentences(list[0].sentences);
      setNote(`${snap.topic ?? "Lecture"}: ${list.length} board(s) ready.`);
    } catch (error) {
      setNote((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function makeAhead() {
    setBusy("prepare");
    setNote("");
    try {
      const res = await fetch("/api/tts/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sentences }) });
      const data = (await res.json()) as { clips?: Array<{ text: string; source: string; ms: number; costUsd: number }>; ms?: number; costUsd?: number; error?: string };
      if (!res.ok || !data.clips) throw new Error(data.error ?? `prepare failed (${res.status})`);
      const byText = new Map(data.clips.map((c) => [c.text, c]));
      setRows((rs) => rs.map((r) => { const c = byText.get(r.text); return c ? { ...r, prepared: { source: c.source, ms: c.ms, costUsd: c.costUsd } } : r; }));
      setNote(`Made ahead in ${((data.ms ?? 0) / 1000).toFixed(1)} s, $${(data.costUsd ?? 0).toFixed(4)}.`);
    } catch (error) {
      setNote((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function play() {
    unlockAudio();
    setRows((rs) => rs.map((r) => ({ ...r, clip: undefined, heardAt: undefined, gapMs: undefined })));
    setFirstSoundMs(null);
    setWaitingOn(null);
    setPausedMs(0);
    waitStarted.current = null;
    playStarted.current = performance.now();
    lastHeard.current = null;
    setBusy("play");
    handle.current = playNarration(sentences.join(" "), {
      voiceFallback: "silent",
      onStart: () => {},
      onVoiceWaiting: (waiting, i) => {
        if (waiting) {
          waitStarted.current ??= performance.now();
          setWaitingOn(i);
        } else {
          const began = waitStarted.current;
          waitStarted.current = null;
          setWaitingOn(null);
          // How long the lecture stood paused, for a later look; the silence column shows it per sentence.
          if (began !== null) setPausedMs((ms) => ms + Math.round(performance.now() - began));
        }
      },
      onBlocked: () => setNote("The browser blocked sound — click Play again."),
      onSentenceHeard: (i, spokenMs) => {
        const now = performance.now();
        const prev = lastHeard.current;
        // The silence before this sentence: from where the last one ended to where this one became audible.
        const gap = prev ? Math.max(0, Math.round(now - (prev.at + prev.spokenMs))) : undefined;
        if (i === 0) setFirstSoundMs(Math.round(now - playStarted.current));
        patch(i, { heardAt: Math.round(now - playStarted.current), gapMs: gap });
        lastHeard.current = { at: now, spokenMs };
      },
      onEnd: () => setBusy(null),
    });
  }

  // The voice fails for 15 s on the server (dev only): Play shows the lecture pausing and going on once it is back.
  async function simulateOutage() {
    const res = await fetch("/api/tts/outage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ms: 15_000 }) }).catch(() => null);
    setNote(res?.ok ? "Voice outage for 15 s — new clips fail. Press Play on sentences not yet heard (or new text) to watch the lecture pause." : "Could not start the outage.");
  }

  async function measureLive() {
    setBusy("live");
    setNote("Each sentence is made fresh (paid), one at a time…");
    let cost = 0;
    for (let i = 0; i < sentences.length; i++) {
      const t0 = performance.now();
      const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json", "x-tts-fresh": "1" }, body: JSON.stringify({ text: sentences[i] }) }).catch(() => null);
      if (res?.ok) await res.blob();
      cost += Number(res?.headers.get("X-Cost-Usd") ?? 0);
      patch(i, { live: { ms: Math.round(performance.now() - t0), ok: Boolean(res?.ok) } });
    }
    setNote(`Live measure done, $${cost.toFixed(4)}.`);
    setBusy(null);
  }

  if (process.env.NODE_ENV === "production") return <main className="p-8 text-slate-300">Not available.</main>;

  const clipMs = rows.flatMap((r) => (r.clip ? [r.clip.ms] : []));
  const liveMs = rows.flatMap((r) => (r.live?.ok ? [r.live.ms] : []));
  const gaps = rows.flatMap((r) => (r.gapMs !== undefined ? [r.gapMs] : []));
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const stat = (label: string, value: string) => (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3"><div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div><div className="mt-1 font-mono text-sm text-slate-100">{value}</div></div>
  );

  return (
    <main className="min-h-screen bg-[#0b0d14] px-4 py-8 text-slate-200 sm:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-white">TTS lab</h1>
          <p className="mt-1 text-sm text-slate-400">Aria&apos;s narration only — make clips ahead, play them through the real player, and compare with a live call.</p>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.18em] text-slate-500" htmlFor="tts-text">Text</label>
            <textarea id="tts-text" value={text} onChange={(e) => setText(e.target.value)} rows={6} className="w-full rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm text-slate-100 outline-none focus:border-cyan-400/60" />
            <button type="button" onClick={() => { setBoards([]); setBoard(-1); applySentences(splitNarrationSentences(text)); }} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10">Use this text</button>
          </div>
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.18em] text-slate-500" htmlFor="tts-session">Or a saved lecture (session id)</label>
            <div className="flex gap-2">
              <input id="tts-session" value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="871d2de2-…" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400/60" />
              <button type="button" disabled={!sessionId.trim() || busy !== null} onClick={loadLecture} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-40">Load</button>
            </div>
            {boards.length > 0 && (
              <select value={board} onChange={(e) => { const i = Number(e.target.value); setBoard(i); applySentences(boards[i].sentences); }} className="w-full rounded-xl border border-white/10 bg-[#11141d] px-3 py-2 text-sm">
                {boards.map((b, i) => <option key={i} value={i}>{b.title} — {b.sentences.length} sentences</option>)}
              </select>
            )}
          </div>
        </section>

        <section className="flex flex-wrap gap-2">
          <button type="button" disabled={busy !== null || !rows.length} onClick={makeAhead} className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-40">{busy === "prepare" ? "Making…" : "Make ahead"}</button>
          <button type="button" disabled={(busy !== null && busy !== "play") || !rows.length} onClick={play} className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:opacity-40">{busy === "play" ? "Playing…" : "Play"}</button>
          {busy === "play" && <button type="button" onClick={() => { handle.current?.cancel(); setBusy(null); }} className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/10">Stop</button>}
          <button type="button" disabled={busy !== null || !rows.length} onClick={measureLive} className="rounded-lg border border-amber-400/40 px-4 py-2 text-sm text-amber-200 hover:bg-amber-400/10 disabled:opacity-40">{busy === "live" ? "Measuring…" : "Measure live (paid)"}</button>
          <button type="button" onClick={simulateOutage} className="rounded-lg border border-rose-400/40 px-4 py-2 text-sm text-rose-200 hover:bg-rose-400/10">Simulate 15 s voice outage</button>
          {waitingOn !== null && <span className="self-center rounded-full border border-cyan-400/40 bg-black/60 px-3 py-1 text-xs font-semibold text-cyan-200">Paused — waiting for Aria&apos;s voice (sentence {waitingOn + 1})…</span>}
          {note && <span className="self-center text-sm text-slate-400">{note}</span>}
        </section>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stat("First sound after Play", firstSoundMs === null ? "—" : `${firstSoundMs} ms`)}
          {stat("Paused waiting for voice", pausedMs ? `${(pausedMs / 1000).toFixed(1)} s` : "—")}
          {stat("Clip arrival (avg)", avg(clipMs) === null ? "—" : `${avg(clipMs)} ms`)}
          {stat("Silence between (max)", gaps.length ? `${Math.max(...gaps)} ms` : "—")}
          {stat("Live call (avg)", avg(liveMs) === null ? "—" : `${avg(liveMs)} ms`)}
        </section>

        <section className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-white/[0.04] text-[11px] uppercase tracking-[0.14em] text-slate-500">
              <tr><th className="p-2">#</th><th className="p-2">Sentence</th><th className="p-2">Made ahead</th><th className="p-2">Played from</th><th className="p-2">Arrived</th><th className="p-2">Heard at</th><th className="p-2">Silence before</th><th className="p-2">Live call</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-white/5 align-top">
                  <td className="p-2 font-mono text-slate-500">{i + 1}</td>
                  <td className="p-2 text-slate-200">{r.text}</td>
                  <td className={`p-2 font-mono ${tone(r.prepared?.source)}`}>{r.prepared ? `${SOURCE_LABEL[r.prepared.source] ?? r.prepared.source}${r.prepared.source === "made" ? ` ${r.prepared.ms} ms` : ""}` : "—"}</td>
                  <td className={`p-2 font-mono ${tone(r.clip?.source)}`}>{r.clip ? `${SOURCE_LABEL[r.clip.source] ?? r.clip.source}${r.clip.attempts > 1 ? ` (try ${r.clip.attempts})` : ""}` : "—"}</td>
                  <td className="p-2 font-mono">{r.clip ? `${r.clip.ms} ms` : "—"}</td>
                  <td className="p-2 font-mono">{r.heardAt !== undefined ? `${(r.heardAt / 1000).toFixed(1)} s` : "—"}</td>
                  <td className={`p-2 font-mono ${r.gapMs !== undefined && r.gapMs > 600 ? "text-rose-300" : ""}`}>{r.gapMs !== undefined ? `${r.gapMs} ms` : "—"}</td>
                  <td className="p-2 font-mono">{r.live ? (r.live.ok ? `${r.live.ms} ms` : "failed") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <p className="text-xs text-slate-500">&quot;Silence before&quot; includes the player&apos;s normal pause between sentences (about 240 ms). Stored and memory clips are free; &quot;made&quot; and &quot;live&quot; are paid.</p>
      </div>
    </main>
  );
}
