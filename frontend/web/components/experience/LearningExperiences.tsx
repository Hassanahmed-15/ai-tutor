"use client";

import { useEffect, useMemo, useState } from "react";
import type { Beat } from "@/lib/lessonContent";
import {
  LEARNING_TWIN_STORAGE_KEY,
  type ConceptFork,
  type LearningTwinEvent,
} from "@/lib/conceptFork";
import {
  MEMORY_CAPSULE_STORAGE_KEY,
  type MemoryCapsule,
  type TeachBackOpening,
  type TeachBackReply,
} from "@/lib/teachBack";

type Experience = "fork" | "twin" | "teach";

export function LearningExperienceOverlay({
  experience,
  topic,
  beat,
  onClose,
}: {
  experience: Experience;
  topic: string;
  beat: Beat;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-[80] flex items-center justify-center bg-[#030407]/92 p-3 backdrop-blur-md lg:p-8">
      <section className="relative flex h-full max-h-[760px] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-[var(--hud-line)] bg-[#080b12] shadow-[0_32px_120px_rgba(0,0,0,0.6)]">
        <div className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "linear-gradient(rgba(120,200,255,.16) 1px, transparent 1px),linear-gradient(90deg,rgba(120,200,255,.16) 1px,transparent 1px)", backgroundSize: "42px 42px" }} />
        <header className="relative z-10 flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4 lg:px-8">
          <div>
            <p className="hud-eyebrow text-[10px] tracking-[0.18em] text-[var(--hud-cyan)]">
              {experience === "fork" ? "Parallel Worlds" : experience === "teach" ? "Role Reversal" : "Learning Twin"}
            </p>
            <h2 className="mt-1 text-lg font-black text-white lg:text-xl">
              {experience === "fork" ? beat.title : experience === "teach" ? `You teach: ${beat.title}` : "The learner Aria is beginning to see"}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close experience" title="Close" className="grid size-10 place-items-center rounded-full border border-white/15 text-xl text-white/70 transition hover:bg-white/10 hover:text-white">
            ×
          </button>
        </header>

        <div className="relative z-10 min-h-0 flex-1 overflow-y-auto">
          {experience === "fork" ? <ParallelWorlds topic={topic} beat={beat} /> : experience === "teach" ? <RoleReversal topic={topic} beat={beat} /> : <LearningTwin />}
        </div>
      </section>
    </div>
  );
}

function RoleReversal({ topic, beat }: { topic: string; beat: Beat }) {
  const [opening, setOpening] = useState<TeachBackOpening | null>(null);
  const [reply, setReply] = useState<TeachBackReply | null>(null);
  const [answer, setAnswer] = useState("");
  const [round, setRound] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/teach-back", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", topic, beat: { title: beat.title, points: beat.points, script: beat.script } }),
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.opening) throw new Error(payload.error || "Could not begin role reversal.");
        return payload.opening as TeachBackOpening;
      })
      .then((value) => {
        if (!cancelled) setOpening(value);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not begin role reversal.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [topic, beat.id, beat.title, beat.points, beat.script]);

  async function submitExplanation() {
    if (!opening || !answer.trim() || submitting) return;
    const submittedAnswer = answer.trim();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/teach-back", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reply",
          topic,
          beat: { title: beat.title, points: beat.points, script: beat.script },
          learnerLine: round === 1 ? opening.learnerLine : reply?.nextQuestion || opening.learnerLine,
          hiddenMissingLink: opening.hiddenMissingLink,
          answer: submittedAnswer,
          round,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.reply) throw new Error(payload.error || "Could not understand that explanation.");
      const nextReply = payload.reply as TeachBackReply;
      setReply(nextReply);
      if (nextReply.understood) {
        saveMemoryCapsule(topic, beat, submittedAnswer);
        setSaved(true);
      } else if (round < 2) {
        setRound(2);
        setAnswer("");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not understand that explanation.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="grid h-full min-h-[440px] place-items-center px-6 text-center">
        <div>
          <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-blue-300/25 bg-blue-300/10 text-2xl text-blue-200">?</div>
          <p className="mt-5 text-sm font-black text-white">A learner is forming one honest misunderstanding…</p>
        </div>
      </div>
    );
  }
  if (error && !opening) return <div className="grid h-full min-h-[440px] place-items-center px-6 text-center text-sm font-bold text-rose-200">{error}</div>;
  if (!opening) return null;

  const finished = reply?.understood || (round === 2 && reply && !reply.understood);
  const learnerPrompt = round === 1 ? opening.learnerLine : reply?.nextQuestion || opening.learnerLine;

  return (
    <div className="mx-auto grid min-h-full max-w-5xl gap-8 px-5 py-7 lg:grid-cols-[260px_1fr] lg:px-8 lg:py-10">
      <aside className="border-b border-white/10 pb-7 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-8">
        <div className="relative mx-auto size-32">
          <div className="absolute inset-0 rounded-full border border-blue-300/20 bg-blue-300/[0.06] shadow-[0_0_60px_rgba(96,165,250,.12)]" />
          <div className="absolute left-1/2 top-[35%] h-8 w-14 -translate-x-1/2 rounded-t-full border-x-2 border-t-2 border-blue-200/75" />
          <span className="absolute left-[42%] top-[45%] size-1.5 rounded-full bg-blue-100" />
          <span className="absolute right-[42%] top-[45%] size-1.5 rounded-full bg-blue-100" />
          <div className="absolute bottom-[29%] left-1/2 h-px w-6 -translate-x-1/2 bg-blue-100/60" />
        </div>
        <p className="mt-5 text-center text-[10px] font-black uppercase tracking-[0.16em] text-blue-300">The learner</p>
        <p className="mt-2 text-center text-sm leading-relaxed text-white/52">They are not testing you. They genuinely hold one incomplete mental model.</p>
        <div className="mt-6 border-l-2 border-blue-300/50 pl-4">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-white/35">Grounded in</p>
          <p className="mt-1 text-sm font-black text-white/80">{opening.lessonAnchor}</p>
        </div>
      </aside>

      <section className="flex min-h-[430px] flex-col">
        <div className="flex-1 space-y-5" aria-live="polite">
          <DialogueLine text={learnerPrompt} />
          {reply && <DialogueLine text={reply.learnerReply} muted={!reply.understood} />}
        </div>

        {finished ? (
          <div className={`mt-6 border-l-2 pl-5 ${reply?.understood ? "border-emerald-300" : "border-amber-300"}`}>
            <p className={`text-[10px] font-black uppercase tracking-[0.16em] ${reply?.understood ? "text-emerald-300" : "text-amber-300"}`}>
              {reply?.understood ? "You changed their mind" : "The missing bridge"}
            </p>
            <p className="mt-2 text-lg font-black leading-snug text-white">{reply?.missingLink}</p>
            <p className="mt-2 text-sm text-white/50">Aria noticed: {reply?.teachingMove}.</p>
            {saved && <p className="mt-4 text-sm font-bold text-[var(--hud-cyan)]">Your explanation is now a message from past you. Aria can return it when this idea appears again.</p>}
          </div>
        ) : (
          <div className="mt-6 border-t border-white/10 pt-5">
            <label htmlFor="teach-back-answer" className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--hud-cyan)]">Teach it in your own words</label>
            <textarea
              id="teach-back-answer"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="Explain the missing connection like you would to one person…"
              rows={4}
              className="mt-3 w-full resize-none rounded-md border border-white/12 bg-black/35 px-4 py-3 text-sm font-semibold leading-relaxed text-white outline-none transition placeholder:text-white/25 focus:border-[var(--hud-cyan)]/60"
            />
            <div className="mt-3 flex items-center justify-between gap-4">
              <p className="text-xs text-white/35">Round {round} of 2 · causal meaning matters, not perfect wording</p>
              <button onClick={submitExplanation} disabled={!answer.trim() || submitting} className="hud-btn-primary rounded-md px-5 py-2.5 text-sm font-black disabled:cursor-not-allowed disabled:opacity-35">
                {submitting ? "Learner is thinking…" : "Let them respond →"}
              </button>
            </div>
            {error && <p className="mt-3 text-xs font-bold text-rose-200">{error}</p>}
          </div>
        )}
      </section>
    </div>
  );
}

function DialogueLine({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full border border-blue-300/25 bg-blue-300/10 text-xs font-black text-blue-200">?</span>
      <p className={`max-w-2xl text-lg font-black leading-relaxed ${muted ? "text-white/58" : "text-white"}`}>{text}</p>
    </div>
  );
}

export function PastYouEcho({ topic, beat }: { topic: string; beat: Beat }) {
  const [dismissed, setDismissed] = useState(false);
  const capsule = useMemo(() => findMemoryCapsule(topic, beat), [topic, beat]);
  if (!capsule || dismissed) return null;
  return (
    <aside className="absolute right-4 top-4 z-40 max-w-sm rounded-md border border-[var(--hud-cyan)]/25 bg-slate-950/92 px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,.35)] backdrop-blur-lg">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[var(--hud-cyan)]">From past you</p>
          <p className="mt-1 text-sm font-bold leading-snug text-white/88">“{capsule.explanation}”</p>
        </div>
        <button onClick={() => setDismissed(true)} aria-label="Dismiss message from past you" title="Dismiss" className="grid size-7 shrink-0 place-items-center rounded-full border border-white/10 text-sm text-white/45 hover:text-white">×</button>
      </div>
    </aside>
  );
}

function saveMemoryCapsule(topic: string, beat: Beat, explanation: string) {
  const capsules = readMemoryCapsules();
  const capsule: MemoryCapsule = {
    id: `${beat.id}-${Date.now()}`,
    topic,
    beatId: beat.id,
    beatTitle: beat.title,
    explanation: explanation.trim().replace(/\s+/g, " ").slice(0, 240),
    keywords: memoryKeywords(`${beat.title} ${explanation}`),
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(MEMORY_CAPSULE_STORAGE_KEY, JSON.stringify([...capsules, capsule].slice(-40)));
}

function readMemoryCapsules(): MemoryCapsule[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(MEMORY_CAPSULE_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((capsule) => capsule && typeof capsule === "object").slice(-40) : [];
  } catch {
    return [];
  }
}

function findMemoryCapsule(topic: string, beat: Beat): MemoryCapsule | null {
  if (typeof window === "undefined") return null;
  const currentWords = new Set(memoryKeywords(`${topic} ${beat.title} ${beat.script}`));
  let best: { capsule: MemoryCapsule; score: number } | null = null;
  for (const capsule of readMemoryCapsules()) {
    if (capsule.beatId === beat.id) continue;
    const score = capsule.keywords.reduce((sum, keyword) => sum + (currentWords.has(keyword) ? 1 : 0), 0);
    if (score >= 2 && (!best || score > best.score)) best = { capsule, score };
  }
  return best?.capsule ?? null;
}

function memoryKeywords(value: string): string[] {
  const stop = new Set(["about", "after", "again", "because", "before", "being", "from", "have", "into", "more", "that", "their", "there", "these", "this", "through", "what", "when", "where", "which", "with", "would", "your"]);
  return Array.from(new Set(value.toLowerCase().replace(/[^a-z0-9\s-]+/g, " ").split(/\s+/).filter((word) => word.length >= 5 && !stop.has(word)))).slice(0, 18);
}

function ParallelWorlds({ topic, beat }: { topic: string; beat: Beat }) {
  const [fork, setFork] = useState<ConceptFork | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<number | null>(null);
  const [confidence, setConfidence] = useState(65);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/fork-concept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, beat: { title: beat.title, points: beat.points, script: beat.script } }),
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.fork) throw new Error(payload.error || "Could not fork this idea.");
        return payload.fork as ConceptFork;
      })
      .then((nextFork) => {
        if (!cancelled) setFork(nextFork);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not fork this idea.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [topic, beat.id, beat.title, beat.points, beat.script]);

  function commitPrediction() {
    if (!fork || choice === null) return;
    const event: LearningTwinEvent = {
      id: `${beat.id}-${Date.now()}`,
      topic,
      beatId: beat.id,
      beatTitle: beat.title,
      change: fork.change,
      correct: choice === fork.correctIndex,
      confidence,
      createdAt: new Date().toISOString(),
    };
    const existing = readTwinEvents();
    localStorage.setItem(LEARNING_TWIN_STORAGE_KEY, JSON.stringify([...existing, event].slice(-80)));
    window.dispatchEvent(new Event("aria-learning-twin-updated"));
    setRevealed(true);
  }

  if (loading) {
    return (
      <div className="grid h-full min-h-[420px] place-items-center px-6 text-center">
        <div>
          <div className="mx-auto size-12 animate-spin rounded-full border-2 border-white/10 border-t-[var(--hud-cyan)]" />
          <p className="mt-5 text-sm font-black text-white">Changing one rule, keeping everything else constant…</p>
          <p className="mt-2 text-xs text-white/45">Aria is finding the causal hinge in this explanation.</p>
        </div>
      </div>
    );
  }

  if (error || !fork) {
    return <div className="grid h-full min-h-[420px] place-items-center px-6 text-center text-sm font-bold text-rose-200">{error || "This idea could not be forked safely."}</div>;
  }

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col px-5 py-7 lg:px-8 lg:py-10">
      {!revealed ? (
        <>
          <div className="flex items-start gap-4 border-l-2 border-amber-300 pl-4 lg:pl-6">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-300">Change one rule</p>
              <p className="mt-2 text-xl font-black leading-tight text-white lg:text-3xl">{fork.change}</p>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/55">{fork.whyItMatters}</p>
            </div>
          </div>

          <p className="mt-8 text-base font-black text-white lg:text-lg">{fork.predictionQuestion}</p>
          <div className="mt-4 divide-y divide-white/10 border-y border-white/10">
            {fork.choices.map((option, index) => (
              <button
                key={option}
                onClick={() => setChoice(index)}
                className={`flex w-full items-center gap-4 px-1 py-4 text-left transition lg:px-3 ${choice === index ? "text-white" : "text-white/62 hover:text-white"}`}
              >
                <span className={`grid size-7 shrink-0 place-items-center rounded-full border text-xs font-black ${choice === index ? "border-[var(--hud-cyan)] bg-[var(--hud-cyan)] text-slate-950" : "border-white/20"}`}>
                  {String.fromCharCode(65 + index)}
                </span>
                <span className="font-bold">{option}</span>
              </button>
            ))}
          </div>

          <div className="mt-7 flex flex-col justify-between gap-5 border-t border-white/10 pt-6 lg:flex-row lg:items-end">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">How sure are you?</p>
              <div className="mt-3 flex gap-2" role="group" aria-label="Prediction confidence">
                {[
                  { label: "Not sure", value: 35 },
                  { label: "Leaning", value: 65 },
                  { label: "Certain", value: 90 },
                ].map((level) => (
                  <button
                    key={level.value}
                    onClick={() => setConfidence(level.value)}
                    className={`rounded-md border px-4 py-2 text-xs font-black transition ${confidence === level.value ? "border-[var(--hud-cyan)] bg-[var(--hud-cyan)]/12 text-[var(--hud-cyan)]" : "border-white/12 text-white/45 hover:text-white"}`}
                  >
                    {level.label}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={commitPrediction} disabled={choice === null} className="hud-btn-primary rounded-md px-6 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-35">
              Commit prediction →
            </button>
          </div>
        </>
      ) : (
        <ForkReveal fork={fork} correct={choice === fork.correctIndex} confidence={confidence} />
      )}
    </div>
  );
}

function ForkReveal({ fork, correct, confidence }: { fork: ConceptFork; correct: boolean; confidence: number }) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-5">
        <div>
          <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${correct ? "text-emerald-300" : "text-amber-300"}`}>
            {correct ? "Your causal model held" : "Your model found a weak link"}
          </p>
          <p className="mt-1 text-sm font-bold text-white/55">Prediction confidence: {confidence}%</p>
        </div>
        <p className="max-w-xl text-sm font-semibold leading-relaxed text-white/75">{fork.reveal}</p>
      </div>

      <div className="grid flex-1 gap-0 py-7 lg:grid-cols-2">
        <CausalWorld world={fork.before} accent="#94a3b8" label="WORLD A" />
        <div className="border-t border-white/10 pt-7 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <CausalWorld world={fork.after} accent="#5eead4" label="WORLD B" animate />
        </div>
      </div>

      <div className="border-t border-white/10 pt-5">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--hud-cyan)]">Transfer the rule</p>
        <p className="mt-2 text-lg font-black text-white">{fork.transferQuestion}</p>
        <p className="mt-2 text-xs text-white/42">Aria’s Learning Twin saved the prediction and your confidence, not just whether you were right.</p>
      </div>
    </div>
  );
}

function CausalWorld({ world, accent, label, animate = false }: { world: ConceptFork["before"]; accent: string; label: string; animate?: boolean }) {
  return (
    <section className="pr-0 lg:pr-8">
      <p className="font-mono text-[10px] font-black tracking-[0.2em]" style={{ color: accent }}>{label}</p>
      <h3 className="mt-2 text-xl font-black text-white">{world.title}</h3>
      <div className="mt-6 flex flex-col">
        {world.chain.map((step, index) => (
          <div key={`${step}-${index}`} className={animate ? "fork-step-in" : ""} style={animate ? { animationDelay: `${index * 170}ms` } : undefined}>
            <div className="flex items-center gap-3">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: accent, boxShadow: `0 0 18px ${accent}` }} />
              <p className="text-base font-black text-white/88">{step}</p>
            </div>
            {index < world.chain.length - 1 && <div className="ml-[4px] h-8 w-px" style={{ backgroundColor: `${accent}66` }} />}
          </div>
        ))}
      </div>
    </section>
  );
}

function LearningTwin() {
  const [events, setEvents] = useState<LearningTwinEvent[]>([]);

  useEffect(() => {
    const refresh = () => setEvents(readTwinEvents());
    refresh();
    window.addEventListener("aria-learning-twin-updated", refresh);
    return () => window.removeEventListener("aria-learning-twin-updated", refresh);
  }, []);

  const profile = useMemo(() => twinProfile(events), [events]);

  function clearMemory() {
    localStorage.removeItem(LEARNING_TWIN_STORAGE_KEY);
    setEvents([]);
    window.dispatchEvent(new Event("aria-learning-twin-updated"));
  }

  if (!events.length) {
    return (
      <div className="grid h-full min-h-[480px] place-items-center px-6 text-center">
        <div className="max-w-lg">
          <TwinGlyph accuracy={0} confidence={0} />
          <h3 className="mt-6 text-2xl font-black text-white">Your twin has no evidence yet.</h3>
          <p className="mt-3 text-sm leading-relaxed text-white/55">Use Parallel Worlds during a lesson. It watches the gap between what you predict and how certain you feel, then remembers that pattern across lessons.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid min-h-full max-w-5xl gap-8 px-5 py-8 lg:grid-cols-[300px_1fr] lg:px-8 lg:py-10">
      <section className="border-b border-white/10 pb-8 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-8">
        <TwinGlyph accuracy={profile.accuracy} confidence={profile.confidence} />
        <p className="mt-6 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--hud-cyan)]">Current read</p>
        <h3 className="mt-2 text-2xl font-black leading-tight text-white">{profile.headline}</h3>
        <p className="mt-3 text-sm leading-relaxed text-white/55">{profile.detail}</p>
      </section>

      <section>
        <div className="grid grid-cols-3 gap-3 border-b border-white/10 pb-6">
          <TwinMetric label="Predictions" value={String(events.length)} />
          <TwinMetric label="Accuracy" value={`${profile.accuracy}%`} />
          <TwinMetric label="Confidence" value={`${profile.confidence}%`} />
        </div>

        <div className="mt-7">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">Memory echoes</p>
            <button onClick={clearMemory} title="Clear learning twin memory" className="rounded-md border border-white/10 px-3 py-1.5 text-[10px] font-black text-white/40 transition hover:border-rose-300/30 hover:text-rose-200">
              Clear memory
            </button>
          </div>
          <div className="mt-3 divide-y divide-white/10 border-y border-white/10">
            {events.slice(-5).reverse().map((event) => (
              <div key={event.id} className="grid gap-2 py-4 lg:grid-cols-[1fr_auto] lg:items-center">
                <div>
                  <p className="text-sm font-black text-white">{event.beatTitle}</p>
                  <p className="mt-1 text-xs text-white/45">{event.change}</p>
                </div>
                <p className={`text-xs font-black ${event.correct ? "text-emerald-300" : "text-amber-300"}`}>
                  {event.correct ? "model held" : "revisit"} · {event.confidence}% sure
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-7 border-l-2 border-[var(--hud-cyan)] pl-4">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--hud-cyan)]">What Aria should do next</p>
          <p className="mt-2 text-base font-black text-white">{profile.nextMove}</p>
        </div>
      </section>
    </div>
  );
}

function TwinGlyph({ accuracy, confidence }: { accuracy: number; confidence: number }) {
  const accuracyAngle = -90 + accuracy * 3.6;
  const confidenceAngle = -90 + confidence * 3.6;
  const point = (angle: number, radius: number) => ({
    x: 80 + Math.cos((angle * Math.PI) / 180) * radius,
    y: 80 + Math.sin((angle * Math.PI) / 180) * radius,
  });
  const accuracyPoint = point(accuracyAngle, 51);
  const confidencePoint = point(confidenceAngle, 37);
  return (
    <svg viewBox="0 0 160 160" className="mx-auto size-40" role="img" aria-label={`Learning twin: ${accuracy}% accuracy and ${confidence}% confidence`}>
      <circle cx="80" cy="80" r="60" fill="#0b1220" stroke="#1e293b" strokeWidth="1" />
      <circle cx="80" cy="80" r="51" fill="none" stroke="#334155" strokeWidth="8" />
      <circle cx="80" cy="80" r="37" fill="none" stroke="#172554" strokeWidth="8" />
      <line x1="80" y1="80" x2={accuracyPoint.x} y2={accuracyPoint.y} stroke="#5eead4" strokeWidth="3" strokeLinecap="round" />
      <line x1="80" y1="80" x2={confidencePoint.x} y2={confidencePoint.y} stroke="#60a5fa" strokeWidth="3" strokeLinecap="round" />
      <circle cx="80" cy="80" r="8" fill="#f8fafc" />
      <circle cx="80" cy="80" r="3" fill="#0f172a" />
      <text x="80" y="147" textAnchor="middle" fill="#64748b" fontSize="9" fontWeight="800">ACCURACY / CONFIDENCE</text>
    </svg>
  );
}

function TwinMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/35">{label}</p>
      <p className="mt-1 text-xl font-black text-white lg:text-2xl">{value}</p>
    </div>
  );
}

function readTwinEvents(): LearningTwinEvent[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEARNING_TWIN_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((event) => event && typeof event === "object").slice(-80) : [];
  } catch {
    return [];
  }
}

function twinProfile(events: LearningTwinEvent[]) {
  const accuracy = Math.round((events.filter((event) => event.correct).length / Math.max(1, events.length)) * 100);
  const confidence = Math.round(events.reduce((sum, event) => sum + event.confidence, 0) / Math.max(1, events.length));
  const gap = confidence - accuracy;
  const wrong = events.filter((event) => !event.correct);
  if (gap >= 18) {
    return {
      accuracy,
      confidence,
      headline: "Fast intuition, optimistic confidence.",
      detail: "You often commit strongly before checking the middle link in a causal chain.",
      nextMove: `Pause before the consequence in “${wrong.at(-1)?.beatTitle ?? events.at(-1)?.beatTitle}” and make the hidden middle step explicit.`,
    };
  }
  if (gap <= -18) {
    return {
      accuracy,
      confidence,
      headline: "Your model is stronger than your confidence.",
      detail: "Your predictions are holding, but you are treating correct causal reasoning as a guess.",
      nextMove: "Ask for a harder transfer case instead of another repetition of the same explanation.",
    };
  }
  return {
    accuracy,
    confidence,
    headline: wrong.length ? "Calibrated, with one fragile edge." : "Confidence and understanding are aligned.",
    detail: wrong.length ? "Your certainty mostly matches your results; the remaining misses cluster around consequences, not definitions." : "You are predicting consequences about as reliably as you believe you are.",
    nextMove: wrong.length ? `Revisit the changed rule in “${wrong.at(-1)?.beatTitle}” through a concrete example.` : "Increase the distance: apply the same rule in an unfamiliar context.",
  };
}
