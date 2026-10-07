"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, BookOpen, Orbit, Paperclip, Play, X } from "lucide-react";
import type { PageName } from "@/components/hud/HudKit";
import { setPendingBrief } from "@/lib/pendingBrief";
import { useAuth } from "@/components/auth/AuthGate";
import { Leaderboard } from "@/components/adhd/Leaderboard";
import { Thoughts } from "@/components/adhd/Thoughts";
import { isAdhdLearner } from "@/lib/adhd/gate";
import { VoicePromptButton } from "@/components/upload/VoicePromptButton";
import { fetchReplay, LectureHistory, useLectureHistory, type HistoryItem, type ReplayPackage } from "@/components/lecture/LectureHistory";
import { setPendingLecture } from "@/lib/pendingLecture";
import { PromptTiles } from "@/components/pages/PromptTiles";
import { findYouTubeLink } from "@/lib/youtube/videoUrl";
import { YouTubeLauncher } from "@/components/pages/YouTubeLauncher";
import { AriaMark } from "@/components/brand/AriaMark";

/**
 * THE FRONT PAGE, with as little to read as a page can have: one question in Aria's voice, one
 * place to answer it, the last lecture to go back to, three ways in picked for this student, and
 * a week of dots. The library (every lecture) is a sheet opened from the top right, not a list
 * beside the page — history is recognised from a shelf when it is wanted, never read past to start.
 *
 * Everything else is quieter than the composer. A file can be dropped anywhere on the page; a
 * YouTube link pasted in the box goes through the video launcher's own check. The handoff to
 * LearnPage still travels through sessionStorage (lib/pendingBrief.ts), unchanged.
 */
export function LandingPage({ go }: { go: (p: PageName) => void; onStart: () => void }) {
  const [topic, setTopic] = useState("");
  const [dragging, setDragging] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  /** A link typed into the prompt box, handed to the YouTube launcher; `key` remounts it per hand-over. */
  const [videoHandOff, setVideoHandOff] = useState<{ url: string; key: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const { user, profile, openSettings } = useAuth();
  const adhd = isAdhdLearner(profile);
  const canStart = topic.trim().length > 0;

  function startWithFile(chosen: File) {
    // The upload is the request: the next screen asks which pages and which part.
    setPendingBrief({ topic: "", file: chosen });
    go("learn");
  }
  function startWithVideo(url: string) {
    setPendingBrief({ topic: "", file: null, videoUrl: url });
    go("learn");
  }
  function start() {
    if (!canStart) return;
    // A YouTube link in the box is a source, not a subject: the launcher runs its length check.
    const video = findYouTubeLink(topic);
    if (video) {
      setVideoHandOff({ url: video.link.url, key: Date.now() });
      return;
    }
    setPendingBrief({ topic: topic.trim(), file: null });
    go("learn");
  }
  function replayLecture(lecture: ReplayPackage) {
    setPendingLecture({ ...lecture, mode: lecture.mode ?? "standard" });
    go("learn");
  }

  // Escape closes the library, as it closes any sheet.
  useEffect(() => {
    if (!libraryOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLibraryOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [libraryOpen]);

  return (
    <main
      className="hud-canvas relative flex min-h-screen flex-col"
      onDragEnter={(e) => { e.preventDefault(); dragDepth.current += 1; setDragging(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => { dragDepth.current -= 1; if (dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) startWithFile(dropped);
      }}
    >
      {/* Drop anywhere: the page says so only while something is being dragged over it. */}
      {dragging && (
        <div aria-hidden="true" className="pointer-events-none fixed inset-3 z-50 grid place-items-center rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--hud-cyan)] bg-[var(--hud-bg)]/80">
          <span className="font-display text-[2rem] italic text-[var(--hud-cyan)]">Drop it here</span>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.pptx,.ppt,.docx,.doc,.json"
        className="sr-only"
        aria-label="Attach a PDF, slide deck, or document"
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          e.target.value = "";
          if (chosen) startWithFile(chosen);
        }}
      />

      <header className="relative z-10 flex h-16 items-center justify-between px-5 sm:px-8">
        <span className="relative inline-flex items-center" aria-label="Aria">
          <AriaMark size={28} label="Aria" />
          {/* Her presence: a chalk dot that breathes while she waits. */}
          <span aria-hidden="true" className="aria-breathe absolute -right-1.5 -top-1.5 size-2.5 rounded-full bg-[var(--hud-cyan)]" />
        </span>
        <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
          {user && (
            <>
              <IconWord icon={<BookOpen size={18} strokeWidth={1.7} />} word="Library" onClick={() => setLibraryOpen(true)} pressed={libraryOpen} />
              <IconWord icon={<Orbit size={18} strokeWidth={1.7} />} word="Map" onClick={() => go("knowledge")} />
              <button
                type="button"
                data-account-button
                onClick={openSettings}
                aria-label={`Account: ${user.username}`}
                className="ml-1 grid size-9 place-items-center rounded-full border border-[var(--hud-line)] bg-[var(--hud-surface)] text-[0.8125rem] font-medium uppercase text-[var(--hud-text)] transition-colors hover:border-[var(--hud-line-strong)]"
              >
                {(profile?.displayName ?? user.username).trim().charAt(0) || "A"}
              </button>
            </>
          )}
        </nav>
      </header>

      <div className="relative z-10 mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-7 px-5 pb-20 pt-[8vh] sm:pt-[12vh]">
        <h1 className="hud-materialize font-display text-[2.6rem] leading-[1.05] tracking-[-0.01em] text-[var(--hud-text)] sm:text-[3.4rem]" style={{ textWrap: "balance" }}>
          What shall we <em className="text-[var(--hud-cyan)]">work on?</em>
        </h1>

        <form className="hud-materialize" onSubmit={(e) => { e.preventDefault(); start(); }}>
          <div className="home-lift flex flex-col gap-2 rounded-[14px] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-3 shadow-[var(--elev-1)] focus-within:border-[var(--hud-line-strong)]">
            <label htmlFor="brief" className="sr-only">What should Aria teach?</label>
            <textarea
              id="brief"
              value={topic}
              onChange={(e) => {
                setTopic(e.target.value);
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); start(); }
              }}
              rows={2}
              placeholder="Ask anything…"
              autoFocus
              className="min-h-[3.25rem] w-full resize-none bg-transparent px-2 pt-1 text-[1.05rem] leading-relaxed text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:outline-none"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--hud-line)] px-2.5 text-[0.8125rem] text-[var(--hud-text-dim)] transition-colors hover:border-[var(--hud-line-strong)] hover:text-[var(--hud-text)]"
              >
                <Paperclip aria-hidden="true" size={14} strokeWidth={1.8} /> File
              </button>
              <YouTubeLauncher key={videoHandOff?.key ?? 0} initialUrl={videoHandOff?.url} onStart={startWithVideo} compact />
              <span className="flex-1" />
              <VoicePromptButton baseText={topic} onTranscript={setTopic} title="Say it instead" />
              <button
                type="submit"
                disabled={!canStart}
                aria-label="Start"
                className="hud-btn-primary grid size-9 shrink-0 place-items-center rounded-full disabled:cursor-not-allowed"
              >
                <ArrowUp aria-hidden="true" size={17} strokeWidth={2.2} />
              </button>
            </div>
          </div>
        </form>

        {user && <ResumeCard onReplay={replayLecture} />}

        {user && (
          <PromptTiles
            onPick={(prompt) => {
              setPendingBrief({ topic: prompt, file: null });
              go("learn");
            }}
          />
        )}

        {user && <WeekDots />}

        {adhd && <Leaderboard />}
        {adhd && <Thoughts />}
      </div>

      {/* THE LIBRARY SHEET: every lecture, on shelves by day, from the right. */}
      {libraryOpen && (
        <>
          <button type="button" aria-label="Close the library" onClick={() => setLibraryOpen(false)} className="fixed inset-0 z-40 bg-[var(--scrim)]" />
          <aside aria-label="Your lectures" className="home-sheet-in fixed inset-y-0 right-0 z-50 flex w-[min(22rem,92vw)] flex-col border-l border-[var(--hud-line)] bg-[var(--sidebar)] shadow-[var(--elev-2)]">
            <div className="flex h-16 shrink-0 items-center justify-between px-4">
              <span className="font-display text-[1.4rem] text-[var(--hud-text)]">Library</span>
              <button type="button" onClick={() => setLibraryOpen(false)} aria-label="Close" className="grid size-9 place-items-center rounded-full text-[var(--hud-text-dim)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--hud-text)]">
                <X aria-hidden="true" size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-6">
              <LectureHistory onReplay={replayLecture} />
            </div>
          </aside>
        </>
      )}
    </main>
  );
}

/** An icon with its word under it — never an icon alone for a door that isn't universal. */
function IconWord({ icon, word, onClick, pressed }: { icon: React.ReactNode; word: string; onClick: () => void; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={`flex h-12 w-14 flex-col items-center justify-center gap-0.5 rounded-[var(--radius)] transition-colors hover:bg-[var(--hud-surface-2)] ${pressed ? "text-[var(--hud-text)]" : "text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]"}`}
    >
      <span aria-hidden="true">{icon}</span>
      <span className="text-[0.625rem] font-medium tracking-[0.02em]">{word}</span>
    </button>
  );
}

/** The last lecture, to go back to: a small drawn board, its title, and Play. */
function ResumeCard({ onReplay }: { onReplay: (lecture: ReplayPackage) => void }) {
  const { items, loading } = useLectureHistory();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last: HistoryItem | undefined = items.find((i) => i.status !== "failed");
  if (loading || !last) return null;
  return (
    <button
      type="button"
      disabled={opening}
      onClick={async () => {
        setOpening(true);
        setError(null);
        try { onReplay(await fetchReplay(last.id)); } catch (e) { setError(e instanceof Error ? e.message : "Could not open it."); setOpening(false); }
      }}
      className="home-lift hud-materialize group flex w-full items-center gap-4 rounded-[14px] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-3 text-left shadow-[var(--elev-1)] disabled:opacity-70"
    >
      <BoardSketch parts={last.beatCount} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[0.95rem] font-medium text-[var(--hud-text)]">{last.topic}</span>
        <span className="font-[family-name:var(--font-hud-mono)] text-[0.6875rem] tabular-nums text-[var(--hud-text-faint)]">
          {error ?? `${last.beatCount} parts`}
        </span>
      </span>
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--hud-cyan)] text-[var(--accent-on)] transition-transform group-hover:scale-105">
        <Play size={15} fill="currentColor" />
      </span>
    </button>
  );
}

/** A board the size of a stamp: a few chalk strokes, one in the pen's colour. */
function BoardSketch({ parts }: { parts: number }) {
  const strokes = Math.max(2, Math.min(5, parts));
  const widths = [34, 22, 30, 18, 26];
  return (
    <svg aria-hidden="true" width="64" height="46" viewBox="0 0 64 46" className="shrink-0">
      <rect x="1" y="1" width="62" height="44" rx="6" fill="var(--hud-surface-2)" stroke="var(--hud-line)" />
      {Array.from({ length: strokes }, (_, i) => (
        <line key={i} x1="12" y1={11 + i * 6.5} x2={12 + widths[i]} y2={11 + i * 6.5} stroke={i === 0 ? "var(--hud-cyan)" : "var(--hud-text-faint)"} strokeWidth={i === 0 ? 2.2 : 1.6} strokeLinecap="round" />
      ))}
      <circle cx="50" cy="30" r="5" fill="none" stroke="var(--hud-text-faint)" strokeWidth="1.4" />
    </svg>
  );
}

/** Seven dots, one per day this week, filled on the days with a lesson. No number to beat. */
function WeekDots() {
  const [days, setDays] = useState<boolean[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/learner-memory", { cache: "no-store", signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const lessons: Array<{ at: string }> = Array.isArray(data?.memory?.lessons) ? data.memory.lessons : [];
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
        const week = Array.from({ length: 7 }, (_, i) => {
          const d0 = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i).getTime();
          return lessons.some((l) => { const t = Date.parse(l.at); return t >= d0 && t < d0 + 86_400_000; });
        });
        setDays(week);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (!days) return null;
  const todayIndex = (new Date().getDay() + 6) % 7;
  const count = days.filter(Boolean).length;
  return (
    <div className="hud-materialize flex items-center gap-2 px-1" role="img" aria-label={`${count} of 7 days this week with a lesson`}>
      {days.map((on, i) => (
        <span
          key={i}
          className={`size-2 rounded-full transition-colors ${on ? "bg-[var(--hud-cyan)]" : "bg-[var(--hud-line-strong)]"} ${i === todayIndex ? "ring-2 ring-[var(--hud-cyan-glow)]" : ""}`}
        />
      ))}
    </div>
  );
}
