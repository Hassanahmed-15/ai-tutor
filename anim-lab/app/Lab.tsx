"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { CONCURRENCY, ENGINES, ENGINE_INFO, TYPICAL, sentences, sentenceState, type Beat, type BoardResult, type Engine, type Lecture, type Run } from "../lib/lecture";
import type { EngineProps } from "../lib/engines/shared";
import { MotionBoard } from "../lib/engines/MotionBoard";
import { GsapBoard } from "../lib/engines/GsapBoard";
import { RemotionBoard } from "../lib/engines/RemotionBoard";
import { LottieBoard } from "../lib/engines/LottieBoard";
import { SandboxBoard } from "../lib/engines/SandboxBoard";

const RENDERERS: Record<Engine, ComponentType<EngineProps>> = {
  sandbox: SandboxBoard,
  motion: MotionBoard,
  gsap: GsapBoard,
  remotion: RemotionBoard,
  lottie: LottieBoard,
};

/** Same pacing for every column: the lesson's sentence clock. */
const MS_PER_SENTENCE = 4000;

/** Production's lecture lengths (beatCountForDepth), plus short ones for quick checks. */
const LENGTHS = [
  { beats: 1, label: "1 board (quick test)" },
  { beats: 3, label: "3 boards" },
  { beats: 6, label: "Full — concise (6)" },
  { beats: 8, label: "Full — standard (8)" },
  { beats: 10, label: "Full — deep (10)" },
];

type Cell = BoardResult & { pending?: boolean; queued?: boolean; runtimeError?: string | null; startedAt?: number };
type Boards = Record<string, Partial<Record<Engine, Cell>>>;
type View = "side" | "overview";

function runId(title: string) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug || "lecture"}`;
}

/** A per-engine queue, so a 10-board lecture does not fire 10 production refine loops at once. */
function makeLimiter(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T,>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

export default function Lab() {
  const [prompt, setPrompt] = useState("How does the heart pump blood around the body?");
  const [beatCount, setBeatCount] = useState(8);
  const [enabled, setEnabled] = useState<Set<Engine>>(new Set(ENGINES));
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [boards, setBoards] = useState<Boards>({});
  const [votes, setVotes] = useState<Record<string, Engine>>({});
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [narrate, setNarrate] = useState(true);
  const [continuous, setContinuous] = useState(true);
  const [view, setView] = useState<View>("side");
  const [shown, setShown] = useState<Set<Engine>>(new Set(ENGINES));
  const [runs, setRuns] = useState<{ id: string; createdAt: string; title: string }[]>([]);
  const [, tick] = useState(0);
  const limiters = useRef(Object.fromEntries(ENGINES.map((e) => [e, makeLimiter(CONCURRENCY[e])])) as Record<Engine, ReturnType<typeof makeLimiter>>);

  const loadRuns = useCallback(() => {
    fetch("/api/runs").then((r) => r.json()).then((d) => setRuns(d.runs ?? [])).catch(() => undefined);
  }, []);
  useEffect(loadRuns, [loadRuns]);

  // Persist the run whenever a board lands or a vote changes, so it can be reopened without paying again.
  useEffect(() => {
    if (!lecture || !id) return;
    const t = setTimeout(() => {
      const clean: Run["boards"] = {};
      for (const [beatId, cells] of Object.entries(boards)) {
        clean[beatId] = {};
        for (const [engine, cell] of Object.entries(cells ?? {})) {
          if (cell && !cell.pending) {
            const { pending: _p, queued: _q, startedAt: _s, ...rest } = cell;
            clean[beatId]![engine as Engine] = { ...rest, error: cell.error ?? cell.runtimeError ?? null };
          }
        }
      }
      const run: Run = { id, createdAt: id.slice(0, 24), lecture, boards: clean, votes };
      void fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(run) }).then(loadRuns);
    }, 800);
    return () => clearTimeout(t);
  }, [boards, votes, lecture, id, loadRuns]);

  // Elapsed timers on pending cells.
  const counts = useMemo(() => {
    let total = 0, pending = 0;
    for (const cells of Object.values(boards)) for (const c of Object.values(cells ?? {})) {
      total++;
      if (c?.pending) pending++;
    }
    return { total, pending, done: total - pending };
  }, [boards]);
  useEffect(() => {
    if (!counts.pending) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [counts.pending]);

  const setCell = useCallback((beatId: string, engine: Engine, patch: Partial<Cell>) => {
    setBoards((prev) => ({ ...prev, [beatId]: { ...prev[beatId], [engine]: { ...(prev[beatId]?.[engine] as Cell), ...patch } } }));
  }, []);

  const generateBoard = useCallback(async (beat: Beat, engine: Engine, repair?: { error: string; code: string }) => {
    setCell(beat.id, engine, { engine, pending: true, queued: true, runtimeError: null, code: null, error: null, ms: 0, costUsd: 0, model: "" });
    await limiters.current[engine](async () => {
      setCell(beat.id, engine, { queued: false, startedAt: Date.now() });
      try {
        const res = await fetch("/api/board", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine, beat, repair }) });
        const data = (await res.json()) as BoardResult;
        setCell(beat.id, engine, { ...data, pending: false });
      } catch (err) {
        setCell(beat.id, engine, { pending: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  }, [setCell]);

  const estimate = useMemo(() => {
    const picked = ENGINES.filter((e) => enabled.has(e));
    const usd = picked.reduce((s, e) => s + TYPICAL[e].usd * beatCount, 0);
    const s = Math.max(0, ...picked.map((e) => Math.ceil(beatCount / CONCURRENCY[e]) * TYPICAL[e].s));
    return { usd, min: Math.max(1, Math.round(s / 60)) };
  }, [enabled, beatCount]);

  const start = async () => {
    setPlanning(true);
    setPlanError(null);
    setLecture(null);
    setBoards({});
    setVotes({});
    setPlaying(false);
    try {
      const res = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, beats: beatCount }) });
      const data = await res.json();
      if (!data.lecture) throw new Error(data.error ?? "planning failed");
      const plan = data.lecture as Lecture;
      setLecture(plan);
      setId(runId(plan.title));
      setActive(0);
      setProgress(0);
      setView("side");
      // Beat-major, so board 1 finishes in every engine first and can be watched while the rest draw.
      for (const beat of plan.beats) for (const engine of ENGINES) if (enabled.has(engine)) void generateBoard(beat, engine);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : String(err));
    } finally {
      setPlanning(false);
    }
  };

  const openRun = async (runIdToOpen: string) => {
    if (!runIdToOpen) return;
    const run = (await fetch(`/api/runs?id=${encodeURIComponent(runIdToOpen)}`).then((r) => r.json())) as Run;
    if (!run.lecture) return;
    setLecture(run.lecture);
    setId(run.id);
    setBoards(run.boards as Boards);
    setVotes(run.votes ?? {});
    setPrompt(run.lecture.prompt);
    setActive(0);
    setProgress(1);
    setPlaying(false);
    setView(run.lecture.beats.length > 1 ? "overview" : "side");
  };

  const beat = lecture?.beats[active] ?? null;
  const beatTotal = lecture?.beats.length ?? 0;
  const lines = useMemo(() => (beat ? sentences(beat.script) : []), [beat]);
  const clock = sentenceState(progress, Math.max(1, lines.length));

  // The transport: one clock for every column; in continuous mode it rolls into the next beat.
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const activeRef = useRef(active);
  activeRef.current = active;
  const continuousRef = useRef(continuous);
  continuousRef.current = continuous;
  useEffect(() => {
    if (!playing || !lines.length) return;
    let raf = 0;
    let hold: ReturnType<typeof setTimeout> | undefined;
    let last: number | null = null;
    const step = (now: number) => {
      const dt = last == null ? 0 : now - last;
      last = now;
      const next = Math.min(1, progressRef.current + dt / (lines.length * MS_PER_SENTENCE));
      if (next < 1) {
        setProgress(next);
        raf = requestAnimationFrame(step);
        return;
      }
      if (continuousRef.current && activeRef.current < beatTotal - 1) {
        // Hold the finished board for a beat, as a teacher does, then move on.
        setProgress(1);
        hold = setTimeout(() => {
          setActive((a) => Math.min(beatTotal - 1, a + 1));
          setProgress(0);
        }, 1200);
      } else {
        setProgress(1);
        setPlaying(false);
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(hold);
    };
  }, [playing, lines.length, active, beatTotal]);

  // Browser TTS reads each sentence as the boards reach it.
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    if (!playing || !narrate || progress >= 1 || !lines[clock.sentenceIndex]) return;
    const u = new SpeechSynthesisUtterance(lines[clock.sentenceIndex]);
    u.rate = 1.08;
    speechSynthesis.speak(u);
    // Only re-speak on a new sentence or beat, not on every progress tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock.sentenceIndex, active, playing, narrate]);

  const selectBeat = (i: number) => {
    setActive(i);
    setPlaying(false);
    setProgress(0);
  };

  const vote = (beatId: string, engine: Engine) => setVotes((prev) => {
    const next = { ...prev };
    if (next[beatId] === engine) delete next[beatId]; else next[beatId] = engine;
    return next;
  });

  const summary = useMemo(() => {
    if (!lecture) return [];
    return ENGINES.map((engine) => {
      const cells = lecture.beats.map((b) => boards[b.id]?.[engine]).filter(Boolean) as Cell[];
      const done = cells.filter((c) => !c.pending);
      const ok = done.filter((c) => c.code && !c.error && !c.runtimeError);
      const scores = engine === "sandbox"
        ? done.map((c) => (c.meta as { trial?: { score?: number | null } } | undefined)?.trial?.score).filter((s): s is number => typeof s === "number")
        : [];
      return {
        engine,
        count: cells.length,
        ok: ok.length,
        done: done.length,
        wins: Object.values(votes).filter((v) => v === engine).length,
        avgS: done.length ? done.reduce((s, c) => s + c.ms, 0) / done.length / 1000 : 0,
        cost: done.reduce((s, c) => s + (c.costUsd || 0), 0),
        critic: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      };
    }).filter((row) => row.count > 0);
  }, [lecture, boards, votes]);

  const onRuntimeError = useCallback((beatId: string, engine: Engine, message: string) => setCell(beatId, engine, { runtimeError: message }), [setCell]);

  return (
    <main>
      <header className="top">
        <div className="brand">
          <h1>Animation Lab</h1>
          <p>Same prompt, same lecture, same model — React sandbox vs Motion, GSAP, Remotion and Lottie.</p>
        </div>
        <select className="runs" value="" onChange={(e) => void openRun(e.target.value)}>
          <option value="">Open a saved run…</option>
          {runs.map((r) => (
            <option key={r.id} value={r.id}>{r.title} — {r.createdAt.slice(0, 16).replace("T", " ")}</option>
          ))}
        </select>
      </header>

      <section className="compose">
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder="What should the lecture teach?" />
        <div className="compose-row">
          <label>
            Length
            <select value={beatCount} onChange={(e) => setBeatCount(Number(e.target.value))}>
              {LENGTHS.map((l) => <option key={l.beats} value={l.beats}>{l.label}</option>)}
            </select>
          </label>
          {ENGINES.map((engine) => (
            <label key={engine} className="chip">
              <input
                type="checkbox"
                checked={enabled.has(engine)}
                onChange={(e) => setEnabled((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(engine); else next.delete(engine);
                  return next;
                })}
              />
              {ENGINE_INFO[engine].label}
            </label>
          ))}
          <span className="mono">≈ ${estimate.usd.toFixed(2)} · ~{estimate.min} min</span>
          <button className="primary" onClick={() => void start()} disabled={planning || !prompt.trim() || !enabled.size}>
            {planning ? "Planning lecture…" : "Generate lecture"}
          </button>
        </div>
        {planError ? <p className="err">{planError}</p> : null}
      </section>

      {lecture && beat ? (
        <>
          <section className="lecture">
            <div className="lecture-head">
              <h2>{lecture.title}</h2>
              {counts.total ? (
                <div className="progress-pill mono">
                  boards {counts.done}/{counts.total}
                  <span className="bar"><span style={{ width: `${(counts.done / counts.total) * 100}%` }} /></span>
                </div>
              ) : null}
              <div className="views">
                <button className={view === "side" ? "on" : ""} onClick={() => setView("side")}>Watch side by side</button>
                <button className={view === "overview" ? "on" : ""} onClick={() => { setView("overview"); setPlaying(false); }}>Overview — all boards</button>
              </div>
            </div>
            <nav className="beats">
              {lecture.beats.map((b, i) => {
                const cells = Object.values(boards[b.id] ?? {});
                const ready = cells.filter((c) => c && !c.pending).length;
                return (
                  <button key={b.id} className={i === active && view === "side" ? "on" : ""} onClick={() => { setView("side"); selectBeat(i); }}>
                    {i + 1}. {b.title}
                    <span className="mono"> {ready}/{cells.length}</span>
                    {votes[b.id] ? <span className="star"> ★ {ENGINE_INFO[votes[b.id]!].label.split(" ")[0]}</span> : null}
                  </button>
                );
              })}
            </nav>
          </section>

          {view === "side" ? (
            <>
              <section className="lecture">
                <p className="point"><b>Board {active + 1}/{beatTotal} must show:</b> {beat.teachingPoint}</p>
                <ol className="script">
                  {lines.map((line, k) => (
                    <li key={k} className={k === clock.sentenceIndex && progress < 1 ? "now" : k < clock.sentenceIndex || progress >= 1 ? "said" : ""}>{line}</li>
                  ))}
                </ol>
              </section>

              <section className="transport">
                <button onClick={() => selectBeat(Math.max(0, active - 1))} disabled={active === 0}>◀</button>
                <button className="primary" onClick={() => {
                  if (progress >= 1) setProgress(0);
                  setPlaying((p) => !p);
                }}>
                  {playing ? "Pause" : progress >= 1 ? "Replay" : "Play"}
                </button>
                <button onClick={() => selectBeat(Math.min(beatTotal - 1, active + 1))} disabled={active >= beatTotal - 1}>▶</button>
                <button onClick={() => { setActive(0); setProgress(0); setContinuous(true); setPlaying(true); }}>Play whole lecture</button>
                <input type="range" min={0} max={1} step={0.001} value={progress} onChange={(e) => { setPlaying(false); setProgress(Number(e.target.value)); }} />
                <span className="mono">board {active + 1}/{beatTotal} · sentence {Math.min(lines.length, clock.sentenceIndex + 1)}/{lines.length}</span>
                <label className="chip"><input type="checkbox" checked={continuous} onChange={(e) => setContinuous(e.target.checked)} /> continue to next board</label>
                <label className="chip"><input type="checkbox" checked={narrate} onChange={(e) => setNarrate(e.target.checked)} /> narrate</label>
              </section>

              <section className="showing">
                <span className="mono">Show:</span>
                {ENGINES.filter((e) => boards[beat.id]?.[e]).map((engine) => (
                  <label key={engine} className="chip">
                    <input
                      type="checkbox"
                      checked={shown.has(engine)}
                      onChange={(e) => setShown((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(engine); else next.delete(engine);
                        return next;
                      })}
                    />
                    {ENGINE_INFO[engine].label}
                  </label>
                ))}
                <span className="fine">Untick all but one to watch a single library&apos;s whole lecture full-width.</span>
              </section>

              <section className={`grid ${ENGINES.filter((e) => shown.has(e) && boards[beat.id]?.[e]).length === 1 ? "solo" : ""}`}>
                {ENGINES.filter((engine) => shown.has(engine) && boards[beat.id]?.[engine]).map((engine) => (
                  <BoardCell
                    key={`${beat.id}-${engine}`}
                    beatId={beat.id}
                    engine={engine}
                    cell={boards[beat.id]![engine]!}
                    progress={progress}
                    clock={clock}
                    playing={playing}
                    best={votes[beat.id] === engine}
                    onVote={() => vote(beat.id, engine)}
                    onRuntimeError={onRuntimeError}
                    onRegenerate={(repair) => void generateBoard(beat, engine, repair)}
                  />
                ))}
                {shown.size > 1 ? (
                  <article className="cell rive">
                    <header><h3>Rive</h3></header>
                    <div className="note">
                      <p><b>Not generated — by design, not by failure.</b></p>
                      <p>A Rive animation is a binary <code>.riv</code> file authored in the Rive editor (artboards, bones, state machines). There is no text/code format a model can write, so it cannot draw a new board per lecture beat.</p>
                      <p>Where it would fit: hand-made reusable pieces — Aria&apos;s avatar, reactions, a handful of interactive widgets — driven by state-machine inputs from the lesson.</p>
                    </div>
                  </article>
                ) : null}
              </section>
            </>
          ) : (
            <Overview
              lecture={lecture}
              boards={boards}
              votes={votes}
              onVote={vote}
              onRuntimeError={onRuntimeError}
              onOpen={(i) => { setView("side"); selectBeat(i); }}
            />
          )}

          {summary.length ? (
            <section className="summary">
              <h3>Whole lecture — {beatTotal} boards</h3>
              <table>
                <thead><tr><th>Library</th><th>Your picks ★</th><th>Boards rendered</th><th>Avg time / board</th><th>Lecture cost</th><th>Notes</th></tr></thead>
                <tbody>
                  {summary.map((row) => (
                    <tr key={row.engine}>
                      <td>{ENGINE_INFO[row.engine].label}</td>
                      <td>{row.wins}/{Object.keys(votes).length}</td>
                      <td>{row.ok}/{row.count}{row.done < row.count ? ` (${row.count - row.done} pending)` : ""}</td>
                      <td>{row.avgS.toFixed(1)} s</td>
                      <td>${row.cost.toFixed(3)}</td>
                      <td className="fine">{row.critic != null ? `production critic avg ${row.critic.toFixed(1)}/5` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="fine">&quot;Rendered&quot; = code came back and nothing threw; it is not a quality score. Judge quality by eye and mark the best board per beat with ★ — the picks column is the comparison. The sandbox column includes its critic/refine rounds and may refuse a board it scores too low; the other columns are one shot plus at most one compile-error repair.</p>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

/** Every board of the lecture at its finished frame: rows are beats, columns are libraries. */
function Overview({ lecture, boards, votes, onVote, onRuntimeError, onOpen }: {
  lecture: Lecture;
  boards: Boards;
  votes: Record<string, Engine>;
  onVote: (beatId: string, engine: Engine) => void;
  onRuntimeError: (beatId: string, engine: Engine, message: string) => void;
  onOpen: (beatIndex: number) => void;
}) {
  const engines = ENGINES.filter((e) => lecture.beats.some((b) => boards[b.id]?.[e]));
  return (
    <section className="overview">
      <p className="fine">Each board at its last frame. Click ★ to pick the best board for a beat; click a board to watch it play.</p>
      <div className="ov-table" style={{ gridTemplateColumns: `minmax(140px, 200px) repeat(${engines.length}, minmax(220px, 1fr))` }}>
        <div className="ov-head" />
        {engines.map((e) => <div key={e} className="ov-head">{ENGINE_INFO[e].label}</div>)}
        {lecture.beats.map((b, i) => (
          <OverviewRow key={b.id} index={i} beat={b} engines={engines} cells={boards[b.id] ?? {}} vote={votes[b.id]} onVote={onVote} onRuntimeError={onRuntimeError} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function OverviewRow({ index, beat, engines, cells, vote, onVote, onRuntimeError, onOpen }: {
  index: number;
  beat: Beat;
  engines: Engine[];
  cells: Partial<Record<Engine, Cell>>;
  vote?: Engine;
  onVote: (beatId: string, engine: Engine) => void;
  onRuntimeError: (beatId: string, engine: Engine, message: string) => void;
  onOpen: (beatIndex: number) => void;
}) {
  const total = sentences(beat.script).length;
  return (
    <>
      <div className="ov-beat">
        <b>{index + 1}. {beat.title}</b>
      </div>
      {engines.map((engine) => {
        const cell = cells[engine];
        const failure = cell?.error ?? cell?.runtimeError ?? null;
        return (
          <div key={engine} className={`ov-cell ${vote === engine ? "best" : ""}`}>
            <div className="stage small" onClick={() => onOpen(index)} role="button" tabIndex={0}>
              {cell?.code && !cell.pending ? (
                <MiniBoard beatId={beat.id} engine={engine} cell={cell} total={total} onRuntimeError={onRuntimeError} />
              ) : (
                <div className="placeholder">{!cell ? "—" : cell.pending ? (cell.queued ? "queued…" : "generating…") : failure ?? "no board"}</div>
              )}
            </div>
            <div className="ov-foot">
              <span className="mono">{cell && !cell.pending ? `${(cell.ms / 1000).toFixed(0)}s · $${(cell.costUsd || 0).toFixed(3)}` : ""}</span>
              {failure && cell?.code ? <span className="err" title={failure}>⚠</span> : null}
              {cell?.code && !cell.pending ? (
                <button className={`star-btn ${vote === engine ? "on" : ""}`} onClick={() => onVote(beat.id, engine)} title="Best board for this beat">★</button>
              ) : null}
            </div>
          </div>
        );
      })}
    </>
  );
}

function MiniBoard({ beatId, engine, cell, total, onRuntimeError }: {
  beatId: string;
  engine: Engine;
  cell: Cell;
  total: number;
  onRuntimeError: (beatId: string, engine: Engine, message: string) => void;
}) {
  const Renderer = RENDERERS[engine];
  const reported = useRef<string | null>(null);
  const report = useRef(onRuntimeError);
  report.current = onRuntimeError;
  const onError = useCallback((message: string) => {
    if (reported.current === message) return;
    reported.current = message;
    report.current(beatId, engine, message);
  }, [beatId, engine]);
  return (
    <Renderer
      code={cell.code!}
      progress={1}
      sentenceIndex={total - 1}
      sentenceProgress={1}
      sentenceTotal={total}
      playing={false}
      assetIds={(cell.meta as { assetIds?: string[] } | undefined)?.assetIds}
      onError={onError}
    />
  );
}

function BoardCell({ beatId, engine, cell, progress, clock, playing, best, onVote, onRuntimeError, onRegenerate }: {
  beatId: string;
  engine: Engine;
  cell: Cell;
  progress: number;
  clock: { sentenceIndex: number; sentenceProgress: number; sentenceTotal: number };
  playing: boolean;
  best: boolean;
  onVote: () => void;
  onRuntimeError: (beatId: string, engine: Engine, message: string) => void;
  onRegenerate: (repair?: { error: string; code: string }) => void;
}) {
  const [showCode, setShowCode] = useState(false);
  const Renderer = RENDERERS[engine];
  // Stable per cell: renderers re-run their setup effects when this identity changes.
  const report = useRef(onRuntimeError);
  report.current = onRuntimeError;
  const reported = useRef<string | null>(null);
  const onError = useCallback((message: string) => {
    if (reported.current === message) return;
    reported.current = message;
    report.current(beatId, engine, message);
  }, [beatId, engine]);
  useEffect(() => {
    reported.current = null;
  }, [cell.code]);

  const meta = (cell.meta ?? {}) as { repairs?: number; runtimeRepair?: boolean; assetIds?: string[]; trial?: { score?: number | null; outcome?: string; attempts?: number } };
  const elapsed = cell.pending && cell.startedAt ? Math.round((Date.now() - cell.startedAt) / 1000) : null;
  const failure = cell.error ?? cell.runtimeError ?? null;

  return (
    <article className={`cell ${best ? "best" : ""}`}>
      <header>
        <h3>{ENGINE_INFO[engine].label}</h3>
        <span className="stats mono">
          {cell.pending
            ? cell.queued ? "queued…" : `generating… ${elapsed ?? 0}s`
            : `${(cell.ms / 1000).toFixed(1)}s · $${(cell.costUsd || 0).toFixed(3)}${cell.code ? ` · ${(cell.code.length / 1024).toFixed(1)} KB` : ""}`}
          {meta.repairs ? ` · ${meta.repairs} repair` : ""}
          {engine === "sandbox" && meta.trial ? ` · critic ${meta.trial.score ?? "–"}/5 ${meta.trial.outcome ?? ""}` : ""}
        </span>
      </header>
      <p className="blurb">{ENGINE_INFO[engine].blurb}</p>
      <div className="stage">
        {cell.code && !cell.pending ? (
          <Renderer
            code={cell.code}
            progress={progress}
            sentenceIndex={clock.sentenceIndex}
            sentenceProgress={clock.sentenceProgress}
            sentenceTotal={clock.sentenceTotal}
            playing={playing}
            assetIds={meta.assetIds}
            onError={onError}
          />
        ) : (
          <div className="placeholder">{cell.pending ? (cell.queued ? "queued…" : "generating…") : cell.error ?? "no board"}</div>
        )}
      </div>
      <footer>
        {failure && !cell.pending ? <span className="err" title={failure}>⚠ {failure.slice(0, 140)}</span> : <span />}
        <div className="actions">
          {cell.code && !cell.pending ? <button className={`star-btn ${best ? "on" : ""}`} onClick={onVote} title="Best board for this beat">★ {best ? "Best" : "Pick"}</button> : null}
          {cell.code ? <button onClick={() => setShowCode((s) => !s)}>{showCode ? "Hide code" : "Code"}</button> : null}
          {cell.runtimeError && cell.code && engine !== "sandbox" ? (
            <button onClick={() => onRegenerate({ error: cell.runtimeError!, code: cell.code! })}>Repair error</button>
          ) : null}
          <button onClick={() => onRegenerate()} disabled={cell.pending}>Regenerate</button>
        </div>
      </footer>
      {showCode && cell.code ? <pre className="code">{cell.code}</pre> : null}
    </article>
  );
}
