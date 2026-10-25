"use client";

/**
 * THE LESSON CANVAS LAB — a development tool (app/canvas-lab/layout.tsx; CANVAS_LAB=1 in production).
 * Students meet the canvas in the ordinary flow: every typed-prompt lecture is taught on it
 * (lib/canvas/progressive.ts). This page makes one straight from a topic, for working on boards.
 *
 * Type a topic, and a canvas lecture is generated end to end (lib/canvas/generate.ts) and played in
 * the REAL LessonPlayer: same narration, same Aria, same pause/resume and questions — the only thing
 * that changes is the board. Each student's lectures are saved to their own storage, so a replay
 * costs nothing. `?scrub=1` (development only) shows the canvas alone for checking boards;
 * `&fixture=dsa` loads hand-written data-structure boards (lib/canvas/dsaFixtures.ts) instead (`&fixture=math`: equation boards, lib/canvas/equationFixtures.ts), and
 * `&session=<id>` one of the student's real typed-prompt lectures (the boards it has so far).
 */
import { predictCardFor } from "@/lib/canvas/predictCard";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Play, Sparkles } from "lucide-react";
import { LessonPlayer } from "@/components/LessonPlayer";
import { LessonCanvas } from "@/components/canvas/LessonCanvas";
import type { Beat } from "@/lib/lessonContent";
import type { CanvasBoardSpec } from "@/lib/canvas/types";
import { DSA_FIXTURES, SEQUENCE_FIXTURES, OS_FIXTURES } from "@/lib/canvas/dsaFixtures";
import { EQUATION_FIXTURES } from "@/lib/canvas/equationFixtures";
import { CS_VISUAL_FIXTURES, LOGIC_FIXTURES, MATHS_VISUAL_FIXTURES, SKETCH_FIXTURES } from "@/lib/canvas/mathsVisualFixtures";
import { canvasSentences } from "@/lib/canvas/plan";
import { validateCanvasSpec } from "@/lib/canvas/validate";

type Lecture = { id: string; title: string; topic: string; beats: Beat[]; costUsd: number; ms: number; log: string[] };
type Listed = { id: string; title: string; topic: string; createdAt: string };

export default function CanvasLab() {
  const [topic, setTopic] = useState("What is photosynthesis");
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [recent, setRecent] = useState<Listed[]>([]);
  const [progress, setProgress] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [voice, setVoice] = useState(true);
  const [scrub, setScrub] = useState(false);
  const [quota, setQuota] = useState<{ dailyLimit: number; usedToday: number } | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [apparatusFixture, setApparatusFixture] = useState(false);

  const load = useCallback(async (id: string) => {
    setError("");
    const res = await fetch(`/api/canvas-lecture?id=${encodeURIComponent(id)}`);
    if (res.status === 401) return setSignedOut(true);
    if (!res.ok) return setError("That lecture couldn't be found.");
    setLecture((await res.json()) as Lecture);
    const url = new URL(window.location.href);
    url.searchParams.set("id", id);
    window.history.replaceState(null, "", url.toString());
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("fixture") === "electrolytic-cell" && process.env.NODE_ENV !== "production") queueMicrotask(() => setApparatusFixture(true));
    if (params.get("voice") === "0") queueMicrotask(() => setVoice(false));
    if (params.get("scrub") === "1" && process.env.NODE_ENV !== "production") queueMicrotask(() => setScrub(true));
    const id = params.get("id");
    const session = params.get("session");
    const fixture = params.get("fixture");
    if (fixture === "sketch" && process.env.NODE_ENV !== "production") queueMicrotask(() => setLecture(fixtureLecture(SKETCH_FIXTURES, "Completing the square, graphs and sorting algorithms")));
    else if (fixture === "sequence" && process.env.NODE_ENV !== "production") queueMicrotask(() => setLecture(fixtureLecture(SEQUENCE_FIXTURES, "TCP three way handshake")));
    else if (fixture === "os" && process.env.NODE_ENV !== "production") queueMicrotask(() => setLecture(fixtureLecture(OS_FIXTURES, "Operating systems: processes and threads")));
    else if (fixture === "logic" && process.env.NODE_ENV !== "production") queueMicrotask(() => setLecture(fixtureLecture(LOGIC_FIXTURES, "Logic gates and truth tables")));
    else if ((fixture === "dsa" || fixture === "math" || fixture === "visuals") && process.env.NODE_ENV !== "production") queueMicrotask(() => setLecture(fixture === "visuals" ? fixtureLecture([...MATHS_VISUAL_FIXTURES, ...CS_VISUAL_FIXTURES], "Algebra, Pythagoras and recursion: solving equations") : fixtureLecture(fixture === "math" ? EQUATION_FIXTURES : DSA_FIXTURES)));
    else if (session && process.env.NODE_ENV !== "production") {
      fetch(`/api/progressive-lectures/${encodeURIComponent(session)}`)
        .then((r) => r.json())
        .then((snap: { title?: string; topic?: string; beats?: Array<Beat | null> }) => setLecture({ id: session, title: snap.title ?? "Lecture", topic: snap.topic ?? "", beats: (snap.beats ?? []).filter((b): b is Beat => Boolean(b)), costUsd: 0, ms: 0, log: [] }))
        .catch(() => setError("That lecture couldn't be loaded."));
    }
    else if (id) queueMicrotask(() => void load(id));
    fetch("/api/canvas-lecture")
      .then((r) => {
        if (r.status === 401) setSignedOut(true);
        return r.json();
      })
      .then((d: { lectures?: Listed[]; dailyLimit?: number; usedToday?: number }) => {
        setRecent(d.lectures ?? []);
        if (d.dailyLimit) setQuota({ dailyLimit: d.dailyLimit, usedToday: d.usedToday ?? 0 });
      })
      .catch(() => {});
  }, [load]);

  const generate = async () => {
    setBusy(true);
    setError("");
    setProgress([]);
    try {
      const res = await fetch("/api/canvas-lecture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic }) });
      if (res.status === 401) {
        setSignedOut(true);
        return;
      }
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Generation failed");
      if (!res.body) throw new Error("No response");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line) as { type: string; detail?: string; lecture?: Lecture; error?: string };
          if (msg.type === "progress" && msg.detail) setProgress((p) => [...p, msg.detail!]);
          if (msg.type === "error") throw new Error(msg.error);
          if (msg.type === "done" && msg.lecture) {
            setQuota((q) => (q ? { ...q, usedToday: q.usedToday + 1 } : q));
            setLecture(msg.lecture);
            window.history.replaceState(null, "", `/canvas-lab?id=${msg.lecture.id}`);
          }
        }
      }
    } catch (e) {
      setError((e as Error).message || "Generation failed");
    } finally {
      setBusy(false);
    }
  };

  if (apparatusFixture) return <ApparatusFixture />;
  if (lecture && scrub) return <Scrubber lecture={lecture} />;
  if (lecture) {
    return (
      <LessonPlayer
        key={lecture.id}
        beats={lecture.beats}
        title={lecture.title}
        autoVoiceAssistant={voice}
        onExit={() => {
          setLecture(null);
          window.history.replaceState(null, "", "/canvas-lab");
        }}
        onComplete={() => undefined}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#0b0f14] px-5 py-10 text-white">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs font-bold text-white/50 hover:text-white/80">
          <ArrowLeft size={13} /> Back to the app
        </Link>
        <p className="mt-6 flex items-center gap-2 text-[0.7rem] font-black uppercase tracking-[0.2em] text-amber-300/80">
          <Sparkles size={13} /> Beta · the new whiteboard
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">The lesson canvas</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/60">
          One canvas for the whole lecture: the camera flies between boards and zooms inside things, Aria&apos;s pen points and circles as she talks,
          objects carry across and equations rearrange, a &quot;Try it&quot; board reacts to sliders, and a &quot;Draw it&quot; board is checked by Aria.
          Pause any time to explore the pictures, and ask Aria anything as you go.
        </p>
        {signedOut && (
          <p className="mt-5 rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100">
            Please <Link href="/" className="underline">sign in</Link> first — your canvas lectures are saved to your account.
          </p>
        )}

        <div className="mt-7 flex gap-2">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && topic.trim() && void generate()}
            placeholder="A topic, e.g. What is photosynthesis"
            className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-3 text-sm font-semibold outline-none focus:border-amber-300/60"
          />
          <button onClick={() => void generate()} disabled={busy || !topic.trim()} className="flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-3 text-sm font-black text-black hover:bg-amber-300 disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {busy ? "Generating…" : "Generate lecture"}
          </button>
        </div>
        {quota && (
          <p className="mt-2 text-xs font-semibold text-white/40">
            {Math.max(0, quota.dailyLimit - quota.usedToday)} of {quota.dailyLimit} new lectures left today · replaying saved ones is free
          </p>
        )}
        <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-white/55">
          <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} className="accent-amber-400" />
          Connect Aria&apos;s live voice (asks for the microphone, so you can ask her questions mid-lesson)
        </label>

        {(busy || progress.length > 0) && (
          <ol className="mt-6 space-y-1.5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
            {progress.map((line, i) => (
              <li key={i} className="flex gap-2 text-white/75">
                <span className="text-amber-300">✓</span> {line}
              </li>
            ))}
            {busy && (
              <li className="flex items-center gap-2 text-white/50">
                <Loader2 size={13} className="animate-spin" /> Aria is preparing your boards — about one to two minutes; the pictures take longest.
              </li>
            )}
          </ol>
        )}
        {error && <p className="mt-4 rounded-xl bg-rose-500/15 px-4 py-3 text-sm font-semibold text-rose-200">{error}</p>}

        {recent.length > 0 && (
          <div className="mt-10">
            <p className="text-[0.7rem] font-black uppercase tracking-[0.18em] text-white/40">Your canvas lectures</p>
            <ul className="mt-3 space-y-2">
              {recent.map((l) => (
                <li key={l.id}>
                  <button onClick={() => void load(l.id)} className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left hover:border-amber-300/40 hover:bg-white/[0.06]">
                    <span>
                      <span className="block text-sm font-bold">{l.title}</span>
                      <span className="block text-xs text-white/45">
                        {l.topic} · {new Date(l.createdAt).toLocaleString()}
                      </span>
                    </span>
                    <Play size={15} className="text-amber-300" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}

function ApparatusFixture() {
  const spec: CanvasBoardSpec = {
    v: 1,
    heading: "Meaning and parts of an electrolytic cell",
    notes: [],
    stage: {
      kind: "scene",
      items: [
        { id: "power-supply", kind: "box", label: "power supply", cell: "A1", span: "2x2", s: 0 },
        { id: "electrolyte", kind: "box", label: "electrolyte", cell: "C1", span: "2x2", s: 0 },
        { id: "anode", kind: "box", label: "anode", cell: "D1", span: "2x2", s: 0 },
        { id: "cathode", kind: "box", label: "cathode", cell: "E1", span: "2x2", s: 0 },
      ],
      arrows: [],
    },
    cues: [],
  };
  return (
    <main className="h-screen bg-black">
      <LessonCanvas panels={[{ key: "electrolytic-cell", spec }]} currentIndex={0} sentence={99} sentenceProgress={1} finished waitingForStudent={false} playing={false} topic="Electrolysis" onSpeak={() => {}} onTellAria={() => {}} onContinue={() => {}} />
    </main>
  );
}

/** The hand-written DSA boards as a lecture, each validated exactly as a generated board is. */
function fixtureLecture(fixtures: typeof DSA_FIXTURES, topic = "Data structures"): Lecture {
  const beats = fixtures.flatMap((f) => {
    const spec = validateCanvasSpec(f.raw, canvasSentences(f.script).length);
    return spec ? [{ id: f.id, script: f.script, draw: { ops: [{ kind: "canvasBoard", spec, at: 0, endAt: 1 }] } } as unknown as Beat] : [];
  });
  return { id: "fixture-dsa", title: "DSA boards", topic, beats, costUsd: 0, ms: 0, log: [] };
}

/**
 * `?scrub=1`: the canvas alone, with a board picker and a sentence slider — every board, camera move
 * and task card can be looked at without sitting through the narration. No voice, no player.
 */
function Scrubber({ lecture }: { lecture: Lecture }) {
  const panels = lecture.beats.flatMap((b) => {
    const op = b.draw?.ops.find((o) => (o as { kind: string }).kind === "canvasBoard") as { spec?: CanvasBoardSpec } | undefined;
    return op?.spec ? [{ key: b.id, spec: op.spec }] : [];
  });
  const [board, setBoard] = useState(0);
  const [sentence, setSentence] = useState(0);
  const [progress, setProgress] = useState(0.5);
  const [finished, setFinished] = useState(false);
  // ?predict=1: the board held before its maths/CS prediction's reveal, with the card open.
  const [showPredict, setShowPredict] = useState(false);
  const predict = showPredict ? predictCardFor(panels[board]?.spec, lecture.topic) : null;
  const script = lecture.beats.find((b) => b.id === panels[board]?.key)?.script ?? "";
  const sentences = useMemo(() => canvasSentences(script), [script]);
  // ?play=1: the lecture plays on a speaking clock (≈150 words a minute, as Aria's voice runs) with no
  // voice — every board, sentence by sentence, the way a student sees it. For recording real playback
  // (scripts/qa/playback-qa.mts) without paying for narration.
  const [play, setPlay] = useState(false);
  // ?rate=1.5: the student's playback speed, for the speaking clock and the marker alike.
  const [labRate] = useState(() => (typeof window === "undefined" ? 1 : Math.max(0.5, Math.min(2, Number(new URLSearchParams(window.location.search).get("rate")) || 1))));
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    queueMicrotask(() => {
      if (params.get("board")) setBoard(Number(params.get("board")));
      if (params.get("s")) setSentence(Number(params.get("s")));
      if (params.get("p")) setProgress(Number(params.get("p")));
      if (params.get("done") === "1") setFinished(true);
      if (params.get("predict") === "1") setShowPredict(true);
      if (params.get("play") === "1") { setProgress(0); setPlay(true); }
    });
  }, []);
  useEffect(() => {
    if (!play || finished) return;
    const words = (sentences[sentence] ?? "").split(/\s+/).filter(Boolean).length;
    const ms = Math.max(1800, words * 400) / labRate;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setProgress(t);
      if (t < 1) raf = requestAnimationFrame(tick);
      else if (sentence < sentences.length - 1) setSentence(sentence + 1);
      else setFinished(true);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [play, finished, sentence, sentences, labRate]);
  useEffect(() => {
    if (!play || !finished) return;
    // The finished board stays up a moment, as it does after Aria's last word; then the next board.
    const t = window.setTimeout(() => {
      if (board < panels.length - 1) { setBoard(board + 1); setSentence(0); setProgress(0); setFinished(false); }
      else (window as unknown as { __playDone?: boolean }).__playDone = true;
    }, 3000);
    return () => window.clearTimeout(t);
  }, [play, finished, board, panels.length]);
  return (
    <main className="flex h-screen flex-col bg-black text-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-2 text-xs font-bold">
        <select value={board} onChange={(e) => { setBoard(Number(e.target.value)); setSentence(0); setFinished(false); }} className="rounded bg-white/10 px-2 py-1">
          {panels.map((p, i) => <option key={p.key} value={i}>{i + 1}. {p.spec.heading} ({p.spec.stage.kind})</option>)}
        </select>
        <label className="flex items-center gap-2">sentence {sentence}
          <input type="range" min={0} max={Math.max(0, sentences.length - 1)} value={sentence} onChange={(e) => setSentence(Number(e.target.value))} />
        </label>
        <label className="flex items-center gap-2">progress
          <input type="range" min={0} max={1} step={0.05} value={progress} onChange={(e) => setProgress(Number(e.target.value))} />
        </label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={finished} onChange={(e) => setFinished(e.target.checked)} /> narration finished</label>
        <span className="min-w-0 flex-1 truncate font-normal text-white/60">{sentences[sentence]}</span>
      </div>
      <div className="relative min-h-0 flex-1">
        <LessonCanvas panels={panels} currentIndex={board} sentence={predict ? predict.at - 1 : sentence} sentenceProgress={predict ? 1 : progress} rate={labRate} finished={predict ? false : finished} waitingForStudent={predict ? true : finished} predictCard={predict?.card} checkFlow={Boolean(predict)} playing={!finished} topic={lecture.topic} onSpeak={(t) => console.log("[speak]", t)} onTellAria={(t) => console.log("[aria]", t)} onContinue={() => { setBoard((b) => Math.min(panels.length - 1, b + 1)); setSentence(0); setFinished(false); }} />
      </div>
    </main>
  );
}
