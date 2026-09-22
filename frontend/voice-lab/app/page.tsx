"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EventLog, type EventLayer, type LabEvent } from "@/lib/turn/events";
import { LiveLab, type LabMode, type LiveStatus } from "@/lib/turn/livePipeline";
import { NOISE_BEDS } from "@/lib/turn/signals";
import { SCENARIOS, runScenario, scoreScenario, type Scenario } from "@/lib/turn/scenarios";

const LAYERS: EventLayer[] = ["mic", "vad", "endpoint", "speaker", "words", "turn", "tutor", "conn", "watchdog", "scenario", "ui"];

type ScenarioResult = { id: number; name: string; expect: string; verdict: string; pass: boolean; why: string; ms: number };

export default function VoiceLabPage() {
  const log = useMemo(() => new EventLog(4000), []);
  const labRef = useRef<LiveLab | null>(null);
  const [mode, setMode] = useState<LabMode>("normal");
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [events, setEvents] = useState<LabEvent[]>([]);
  const [filters, setFilters] = useState<Set<EventLayer>>(new Set(LAYERS));
  const [bed, setBed] = useState("none");
  const [bedLevel, setBedLevel] = useState(0.3);
  const [results, setResults] = useState<ScenarioResult[] | null>(null);
  const [running, setRunning] = useState<"" | "heuristic" | "silero">("");
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const flush = () => setEvents([...log.events]);
    const unsubscribe = log.subscribe(() => { window.clearTimeout((flush as unknown as { t?: number }).t); (flush as unknown as { t?: number }).t = window.setTimeout(flush, 60); });
    return unsubscribe;
  }, [log]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  const lab = () => {
    if (!labRef.current) labRef.current = new LiveLab({ mode, log, onStatus: setStatus });
    return labRef.current;
  };

  const start = async () => { lab().setMode(mode); await lab().start(); };
  const stop = () => lab().stop();

  const runSuite = async (withSilero: boolean) => {
    setRunning(withSilero ? "silero" : "heuristic");
    setResults([]);
    const vad = withSilero ? await lab().vadForScenarios() : null;
    if (withSilero && !vad) { log.log("scenario", "silero-unavailable", 0, "the neural VAD did not load; run the heuristic suite", "warn"); setRunning(""); return; }
    const out: ScenarioResult[] = [];
    for (const s of SCENARIOS) {
      await new Promise((r) => setTimeout(r, 0));
      const t0 = performance.now();
      const o = runScenario(s, vad ? { vad } : {});
      const { pass, why } = scoreScenario(s, o);
      out.push({ id: s.id, name: s.name, expect: s.expect, verdict: o.verdict, pass, why, ms: Math.round(performance.now() - t0) });
      log.log("scenario", pass ? "pass" : "FAIL", 0, `#${s.id} ${s.name}${why ? ` — ${why}` : ""}`, pass ? "ok" : "bad");
      setResults([...out]);
    }
    setRunning("");
  };

  const visible = events.filter((e) => filters.has(e.layer)).slice(-600);
  const chip = (label: string, tone: "ok" | "warn" | "bad" | "live" | "", text: string) => (
    <span className={`chip ${tone}`}><i className="dot" />{label}: <b>{text}</b></span>
  );
  const micTone = status?.mic === "connected" ? "ok" : status?.mic === "reconnecting" || status?.mic === "requesting" ? "warn" : status?.mic === "idle" ? "" : "bad";
  const turnTone = status?.turn === "committed" ? "bad" : status?.turn === "listening" ? "live" : status?.turn === "attending" ? "warn" : status?.turn === "processing" ? "warn" : "";

  return (
    <main className="lab">
      <section>
        <div className="panel">
          <h2>Aria Voice Lab — separate from production</h2>
          <div className="row">
            <select value={mode} onChange={(e) => { setMode(e.target.value as LabMode); labRef.current?.setMode(e.target.value as LabMode); }} disabled={status?.running}>
              <option value="normal">Normal lecture</option>
              <option value="pdf">PDF lecture</option>
              <option value="chat">Chat / WhatsApp</option>
              <option value="planning">Planning</option>
            </select>
            {!status?.running ? <button className="primary" onClick={() => void start()}>Start session</button> : <button onClick={stop}>Stop</button>}
          </div>
          <p className="small">Start, then talk. Say her name (“Aria”), ask about the board, or give a command to interrupt. Talk to someone else, cough, or type: she should carry on.</p>
        </div>

        <div className="panel" style={{ marginTop: 12 }}>
          <h2>Live state</h2>
          <div className="state">{status?.turn ?? "idle"}</div>
          <div className="row">
            {chip("mic", micTone, `${status?.mic ?? "idle"}${status?.micDetail ? ` · ${status.micDetail}` : ""}`)}
          </div>
          <div className="row">
            {chip("VAD", status?.vad.speech ? "ok" : "", `${status?.vad.source ?? "heuristic"} ${status?.vad.probability.toFixed(2) ?? "0.00"}${status?.vad.ready ? ` · ${status.vad.inferMs.toFixed(1)} ms` : ""}`)}
            {chip("endpoint", status?.endpoint === "speaking" ? "live" : status?.endpoint === "onset" || status?.endpoint === "paused" ? "warn" : "", status?.endpoint ?? "silent")}
          </div>
          <div className="meter" style={{ marginTop: 6 }}><i style={{ width: `${Math.min(100, (status?.level ?? 0) * 400)}%` }} /></div>
          <div className="meter vad" style={{ marginTop: 4 }}><i style={{ width: `${Math.min(100, (status?.vad.probability ?? 0) * 100)}%` }} /></div>
          <div className="row" style={{ marginTop: 8 }}>
            {chip("turn", turnTone, status?.turn ?? "idle")}
            {chip("tutor", status?.tutor.audible ? "live" : status?.tutor.paused ? "warn" : "", status?.tutor.audible ? `speaking (${status.tutor.as})` : status?.tutor.paused ? "paused" : status?.tutor.expectingAnswer ? "waiting for answer" : "silent")}
          </div>
          <div className="row">
            {chip("words", status?.transcriber.available ? (status?.transcriber.status === "started" ? "ok" : "warn") : "bad", status?.transcriber.available ? status?.transcriber.status ?? "idle" : "recogniser unavailable in this browser")}
            {chip("speaker", status?.speaker.enrolled ? "ok" : "", status?.speaker.enrolled ? `enrolled · ${status.speaker.verdict}` : `enrolling ${status?.speaker.enrolledFrames ?? 0}/40`)}
          </div>
          <div className="row">
            {chip("connection", status?.connection.state === "connected" ? "ok" : status?.connection.state === "reconnecting" ? "bad" : "", `${status?.connection.state ?? "disconnected"}${status?.connection.detail ? ` · ${status.connection.detail}` : ""}`)}
          </div>
          <p className="small" style={{ minHeight: 34 }}>{status?.tutor.sentence ? `Tutor: “${status.tutor.sentence}”` : ""}<br />{status?.transcriber.last ? `You (${status.transcriber.lastFinal ? "final" : "interim"}): “${status.transcriber.last}”` : ""}</p>
          <p className="small">{status?.vad.reason}</p>
        </div>

        <div className="panel" style={{ marginTop: 12 }}>
          <h2>Stress &amp; faults</h2>
          <div className="row">
            <select value={bed} onChange={(e) => { setBed(e.target.value); labRef.current?.setNoiseBed(e.target.value, bedLevel); }}>
              {Object.keys(NOISE_BEDS).map((name) => <option key={name} value={name}>{name === "none" ? "no noise bed" : `noise: ${name}`}</option>)}
            </select>
            <input type="range" min={0} max={0.6} step={0.02} value={bedLevel} onChange={(e) => { const v = Number(e.target.value); setBedLevel(v); labRef.current?.setNoiseBed(bed, v); }} />
            <span className="small">{bedLevel.toFixed(2)}</span>
          </div>
          <div className="row">
            <button onClick={() => labRef.current?.simulateMicDrop()} disabled={!status?.running}>Drop the microphone</button>
            <button onClick={() => labRef.current?.simulateConnectionDrop()} disabled={!status?.running}>Drop the model connection</button>
          </div>
          <div className="row">
            <button onClick={() => labRef.current?.markFalseInterruption()} disabled={!status?.running}>Mark: false interruption</button>
            <button onClick={() => labRef.current?.markMissedSpeech()} disabled={!status?.running}>Mark: she missed me</button>
          </div>
          <p className="small">
            turns {status?.stats.turns ?? 0} · barge-ins {status?.stats.bargeIns ?? 0} · ducks {status?.stats.ducks ?? 0} · discards {status?.stats.discards ?? 0} · watchdogs {status?.stats.watchdogs ?? 0} · reconnects {status?.stats.reconnects ?? 0}
            <br />tester-reported: false interruptions {status?.stats.falseInterruptions ?? 0} · missed speech {status?.stats.missedSpeech ?? 0}
          </p>
        </div>

        <div className="panel" style={{ marginTop: 12 }}>
          <h2>Scenario suite ({SCENARIOS.length} scenarios)</h2>
          <div className="row">
            <button onClick={() => void runSuite(false)} disabled={running !== ""}>{running === "heuristic" ? "Running…" : "Run (acoustic detector)"}</button>
            <button onClick={() => void runSuite(true)} disabled={running !== ""}>{running === "silero" ? "Running…" : "Run (neural VAD)"}</button>
            <button onClick={() => { const blob = new Blob([labRef.current?.exportLog() ?? JSON.stringify(log.toJSON())], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `voice-lab-${Date.now()}.json`; a.click(); }}>Export log</button>
          </div>
          {results && (
            <>
              <p className="small">{results.filter((r) => r.pass).length}/{results.length} pass{running ? " (running)" : ""}</p>
              <div style={{ maxHeight: 260, overflow: "auto" }}>
                <table className="results">
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.id}><td>{r.id}</td><td>{r.name}</td><td className={r.pass ? "pass" : "fail"}>{r.pass ? "PASS" : "FAIL"}</td><td className="small">{r.pass ? `${r.verdict}` : r.why}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Decision trail</h2>
        <div className="row">
          {LAYERS.map((layer) => (
            <button key={layer} className={filters.has(layer) ? "active" : ""} style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => setFilters((f) => { const n = new Set(f); if (n.has(layer)) n.delete(layer); else n.add(layer); return n; })}>{layer}</button>
          ))}
          <button style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => { log.clear(); setEvents([]); }}>clear</button>
        </div>
        <div className="log" ref={logRef}>
          {visible.map((e, i) => (
            <div key={i} className={`e ${e.level ?? "info"}`}>
              <span className="t">{(e.t / 1000).toFixed(2)}s</span>
              <span className="k">{e.layer}/{e.kind}</span>
              <span>{e.detail}{e.data ? ` ${JSON.stringify(e.data)}` : ""}</span>
            </div>
          ))}
          {visible.length === 0 && <div className="small">Start a session or run the scenario suite. Every layer reports what it saw and why it decided what it did.</div>}
        </div>
      </section>
    </main>
  );
}

export type { Scenario };
