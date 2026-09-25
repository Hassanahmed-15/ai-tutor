"use client";

import { useEffect, useMemo, useState } from "react";
import { useGeminiLiveTutor } from "@/lib/useGeminiLiveTutor";

type Diagnostics = ReturnType<ReturnType<typeof useGeminiLiveTutor>["getVoiceDiagnostics"]>;

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3"><div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div><div className="mt-1 font-mono text-sm text-slate-100">{value}</div></div>;
}

export default function VoiceLabPage() {
  const tutor = useGeminiLiveTutor({
    topic: "Voice architecture diagnostics",
    getBeatContext: () => "Internal microphone, turn-taking, playback and reconnection diagnostic session.",
    onBoardRequest: () => undefined,
    gateProfile: "lecture",
    voiceSurface: "shared",
    debugVoice: true,
    alwaysOn: true,
  });
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(true);
  const getVoiceDiagnostics = tutor.getVoiceDiagnostics;

  useEffect(() => {
    const update = () => setDiagnostics(getVoiceDiagnostics());
    update();
    const id = window.setInterval(update, 150);
    return () => window.clearInterval(id);
  }, [getVoiceDiagnostics]);

  const events = useMemo(() => {
    const all = diagnostics?.events ?? [];
    return (showAll ? all : all.filter((event) => ["vad", "endpoint", "words", "turn", "watchdog", "conn"].includes(event.layer))).slice(-80).reverse();
  }, [diagnostics, showAll]);

  const gate = diagnostics?.gate;
  const session = diagnostics?.session ?? tutor.voiceSession;
  return (
    <main className="min-h-screen bg-[#080b12] px-5 py-8 text-slate-200">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-400">Internal tool</div><h1 className="mt-2 text-3xl font-semibold text-white">Arya Voice Lab</h1><p className="mt-2 max-w-3xl text-sm text-slate-400">The production microphone → Silero/heuristic VAD → adaptive endpoint → speaker/addressing arbiter → Gemini adapter. Audio remains local until the gate opens a turn.</p></div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void tutor.start()} disabled={tutor.status === "connecting" || tutor.status === "live"} className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">Start</button>
            <button onClick={tutor.stop} className="rounded-lg border border-white/15 px-4 py-2 text-sm">Stop</button>
            <button onClick={tutor.forceReconnect} className="rounded-lg border border-white/15 px-4 py-2 text-sm">Force reconnect</button>
            <button onClick={tutor.simulateInterruption} className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm text-amber-200">Simulate interruption</button>
            <button onClick={tutor.resetVoiceSession} className="rounded-lg border border-white/15 px-4 py-2 text-sm">Reset session</button>
            <button onClick={() => setDebugEnabled((value) => !value)} className="rounded-lg border border-white/15 px-4 py-2 text-sm">Debug {debugEnabled ? "on" : "off"}</button>
            <button onClick={() => tutor.setMicEnabled(tutor.muted)} className="rounded-lg border border-white/15 px-4 py-2 text-sm">{tutor.muted ? "Unmute mic" : "Mute mic"}</button>
          </div>
        </div>

        {tutor.errorMessage && <div className="mt-5 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{tutor.errorMessage}</div>}

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Session state" value={session.state} />
          <Metric label="Connection" value={`${tutor.status}${tutor.reconnecting ? " / recovering" : ""}`} />
          <Metric label="Mic" value={session.micActive ? (session.muted ? "muted" : "active") : "inactive"} />
          <Metric label="Gate / endpoint" value={`${gate?.stage ?? "idle"} / ${gate?.endpointState ?? "silent"}`} />
          <Metric label="Playback generation" value={diagnostics?.playback.generation ?? 0} />
          <Metric label="VAD" value={gate ? `${gate.vadSource} ${gate.vadProbability?.toFixed(3) ?? "—"}` : "—"} />
          <Metric label="Speech confidence" value={gate?.speechConfidence.toFixed(3) ?? "—"} />
          <Metric label="Interruption confidence" value={session.interruptionConfidence.toFixed(3)} />
          <Metric label="Accepted / played" value={`${diagnostics?.playback.acceptedSamples ?? 0} / ${diagnostics?.playback.playedSamples ?? 0}`} />
          <Metric label="Session ID" value={session.sessionId} />
        </section>

        {debugEnabled && <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.5fr]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
            <h2 className="text-sm font-semibold text-white">Latest decision</h2>
            <dl className="mt-4 space-y-3 text-sm"><div><dt className="text-slate-500">State reason</dt><dd className="mt-1 text-slate-200">{session.reason}</dd></div><div><dt className="text-slate-500">Detector reason</dt><dd className="mt-1 text-slate-200">{gate?.reason ?? "No frame yet"}</dd></div><div><dt className="text-slate-500">Transcript</dt><dd className="mt-1 min-h-14 rounded-lg bg-black/20 p-3 text-slate-300">{session.transcript || "No accepted transcript"}</dd></div></dl>
            <h2 className="mt-6 text-sm font-semibold text-white">State transitions</h2>
            <div className="mt-3 max-h-72 overflow-auto font-mono text-xs text-slate-400">{(diagnostics?.transitions ?? []).slice(-30).reverse().map((item) => <div key={`${item.index}-${item.at}`} className="border-t border-white/5 py-2"><span className="text-cyan-300">{item.from} → {item.to}</span><span className="ml-2">{item.reason}</span></div>)}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
            <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-white">Pipeline event stream</h2><label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />all layers</label></div>
            <div className="mt-3 max-h-[560px] overflow-auto font-mono text-xs">{events.map((event, index) => <div key={`${event.t}-${event.kind}-${index}`} className="grid grid-cols-[72px_70px_90px_1fr] gap-2 border-t border-white/5 py-2"><span className="text-slate-600">{event.t.toFixed(0)}ms</span><span className="text-cyan-300">{event.layer}</span><span className={event.level === "bad" ? "text-red-300" : event.level === "warn" ? "text-amber-300" : "text-slate-300"}>{event.kind}</span><span className="text-slate-400">{event.detail}</span></div>)}</div>
          </div>
        </section>}
      </div>
    </main>
  );
}
