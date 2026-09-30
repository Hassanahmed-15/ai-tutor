"use client";

/**
 * THE LESSON CANVAS (beta) — for signed-in students.
 *
 * Type a topic, and a canvas lecture is generated end to end (lib/canvas/generate.ts) and played in
 * the REAL LessonPlayer: same narration, same Aria, same pause/resume and questions — the only thing
 * that changes is the board. Each student's lectures are saved to their own storage, so a replay
 * costs nothing. `?scrub=1` (development only) shows the canvas alone for checking boards.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Play, Sparkles } from "lucide-react";
import { LessonPlayer } from "@/components/LessonPlayer";
import { LessonCanvas } from "@/components/canvas/LessonCanvas";
import type { Beat } from "@/lib/lessonContent";
import type { CanvasBoardSpec } from "@/lib/canvas/types";

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
    if (params.get("voice") === "0") queueMicrotask(() => setVoice(false));
    if (params.get("scrub") === "1" && process.env.NODE_ENV !== "production") queueMicrotask(() => setScrub(true));
    const id = params.get("id");
    if (id) queueMicrotask(() => void load(id));
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
  const script = lecture.beats.find((b) => b.id === panels[board]?.key)?.script ?? "";
  const sentences = script.split(/(?<=[.!?])\s+/).filter(Boolean);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    queueMicrotask(() => {
      if (params.get("board")) setBoard(Number(params.get("board")));
      if (params.get("s")) setSentence(Number(params.get("s")));
      if (params.get("p")) setProgress(Number(params.get("p")));
      if (params.get("done") === "1") setFinished(true);
    });
  }, []);
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
        <LessonCanvas panels={panels} currentIndex={board} sentence={sentence} sentenceProgress={progress} finished={finished} waitingForStudent={finished} playing={!finished} topic={lecture.topic} onSpeak={(t) => console.log("[speak]", t)} onTellAria={(t) => console.log("[aria]", t)} onContinue={() => { setBoard((b) => Math.min(panels.length - 1, b + 1)); setSentence(0); setFinished(false); }} />
      </div>
    </main>
  );
}
