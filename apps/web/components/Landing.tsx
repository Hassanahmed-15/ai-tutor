"use client";

import { useEffect, useState } from "react";
import { TeacherAvatar } from "./TeacherAvatar";

/**
 * Dark, cinematic landing page for the local demo. This intentionally stays mock-only:
 * typing a topic opens the built-in lecture instead of calling any OpenAI-backed route.
 */
export function Landing({
  onGenerate,
  onDemo,
  loading,
  error,
}: {
  onGenerate: (topic: string) => void;
  onDemo: () => void;
  loading: boolean;
  error: string | null;
}) {
  const [topic, setTopic] = useState("");

  function submit() {
    if (topic.trim() && !loading) onGenerate(topic.trim());
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05040c] text-white">
      {/* ambient gradient orbs */}
      <div
        className="landing-orb pointer-events-none absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full opacity-60 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(99,102,241,0.55), transparent 65%)" }}
      />
      <div
        className="landing-orb pointer-events-none absolute -bottom-52 -right-32 h-[600px] w-[600px] rounded-full opacity-50 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(217,70,239,0.42), transparent 65%)", animationDelay: "3s" }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(255,255,255,0.06),transparent_45%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.035]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)", backgroundSize: "26px 26px" }} />

      {/* nav */}
      <nav className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-sm font-black">A</span>
          <span className="text-lg font-black tracking-tight">Aria</span>
        </div>
        <button
          onClick={onDemo}
          className="rounded-full border border-white/15 bg-white/5 px-5 py-2 text-sm font-bold backdrop-blur-sm transition hover:bg-white/10"
        >
          Try the demo
        </button>
      </nav>

      {/* hero */}
      <section className="relative z-10 mx-auto grid max-w-6xl items-center gap-10 px-6 pb-20 pt-6 lg:grid-cols-[1.15fr_0.85fr] lg:pt-14">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-indigo-200">
            <span className="size-1.5 rounded-full bg-indigo-300 av-ring-dot" /> Live AI tutor · demo mode
          </span>
          <h1 className="mt-6 text-[4.4rem] font-black leading-[0.93] tracking-tight sm:text-[5.2rem]">
            Teach me
            <span className="block bg-gradient-to-r from-indigo-300 via-violet-300 to-fuchsia-300 bg-clip-text text-transparent">
            visually, live.
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-xl font-medium leading-8 text-white/65">
            This demo runs a built-in lecture with voice, synced visuals, checkpoints,
            recap, and a full-screen teaching board. It does not call OpenAI or spend your
            API credits.
          </p>

          <div className="mt-9 flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="try a topic prompt — demo will open the built-in lecture"
                disabled={loading}
                className="flex-1 rounded-full border border-white/15 bg-white/5 px-6 py-4 text-lg font-semibold text-white placeholder:text-white/35 focus:border-indigo-400 focus:outline-none disabled:opacity-60"
              />
              <button
                onClick={submit}
                disabled={loading || !topic.trim()}
                className="shrink-0 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-8 py-4 text-lg font-black shadow-[0_0_40px_rgba(129,140,248,0.45)] transition hover:shadow-[0_0_60px_rgba(129,140,248,0.65)] disabled:opacity-50"
              >
                {loading ? "Opening demo…" : "Open demo lecture →"}
              </button>
            </div>
            {error && (
              <p className="max-w-xl rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-200">{error}</p>
            )}
            <p className="text-sm font-semibold text-white/45">
              Safe demo mode:{" "}
              <button onClick={onDemo} className="underline decoration-white/30 hover:decoration-white/60">
                run the built-in photosynthesis lecture
              </button>{" "}
              without using your OpenAI key.
            </p>
          </div>

          <div className="mt-12 flex flex-wrap gap-7">
            {[
              ["Drawn live", "Every concept sketched stroke by stroke"],
              ["Real voice", "A warm teacher voice, not flat text"],
              ["Mock-only", "No OpenAI calls in demo mode"],
            ].map(([t, d]) => (
              <div key={t} className="max-w-[180px]">
                <p className="text-sm font-black text-white">{t}</p>
                <p className="mt-1 text-sm font-medium text-white/50">{d}</p>
              </div>
            ))}
          </div>
        </div>

        {/* hero preview: avatar + a rotating "lecture beat" reel instead of a static board */}
        <div className="relative">
          <div className="float-slow relative rounded-[2rem] border border-white/10 bg-white/[0.03] p-8 backdrop-blur-sm">
            <div className="absolute -inset-px rounded-[2rem] bg-gradient-to-br from-indigo-500/20 to-fuchsia-500/10" />
            <div className="relative flex flex-col items-center">
              <TeacherAvatar speaking size={150} />
              <p className="mt-5 text-sm font-bold uppercase tracking-[0.18em] text-indigo-200">Meet Aria</p>
              <p className="mt-2 text-center text-2xl font-black leading-tight">
                “Tell me what to teach.
                <br />
                I’ll draw it live.”
              </p>
              <PreviewReel />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

/** A small rotating reel of "lecture beat" cards — stands in for a real generated lecture
 * preview without needing an API call on the landing page itself. Cycles every few seconds
 * to suggest the variety of beat types (hook, mechanism, checkpoint, recap) any topic gets. */
const REEL_FRAMES = [
  { kind: "Hook", line: "Why doesn't a bridge collapse?", accent: "#f59e0b" },
  { kind: "Mechanism", line: "Tension pulls. Compression pushes.", accent: "#38bdf8" },
  { kind: "Checkpoint", line: "Your turn — what force pulls apart?", accent: "#a78bfa" },
  { kind: "Recap", line: "Delivery → cooking → meal → exhaust.", accent: "#34d399" },
];

function PreviewReel() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % REEL_FRAMES.length), 2600);
    return () => clearInterval(id);
  }, []);
  const frame = REEL_FRAMES[i];

  return (
    <div className="mt-6 w-full rounded-2xl bg-white p-5 text-slate-950">
      <div key={i} className="beat-fade-in">
        <span className="inline-flex rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wider text-white" style={{ background: frame.accent }}>
          {frame.kind}
        </span>
        <p className="mt-3 text-lg font-black leading-snug">{frame.line}</p>
      </div>
      <div className="mt-4 flex gap-1.5">
        {REEL_FRAMES.map((f, idx) => (
          <span key={f.kind} className="h-1 flex-1 rounded-full transition-colors" style={{ background: idx === i ? f.accent : "#e2e8f0" }} />
        ))}
      </div>
    </div>
  );
}
