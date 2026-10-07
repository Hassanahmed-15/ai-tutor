"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, CircleHelp, Paperclip, X } from "lucide-react";
import type { PageName } from "@/components/hud/HudKit";
import { setPendingBrief } from "@/lib/pendingBrief";
import { useAuth } from "@/components/auth/AuthGate";
import { Leaderboard } from "@/components/adhd/Leaderboard";
import { Thoughts } from "@/components/adhd/Thoughts";
import { isAdhdLearner } from "@/lib/adhd/gate";
import { VoicePromptButton } from "@/components/upload/VoicePromptButton";
import { LectureHistory, type ReplayPackage } from "@/components/lecture/LectureHistory";
import { GuideSheet, guideSeen } from "@/components/pages/GuideSheet";
import { LibraryDoor, MapDoor } from "@/components/pages/HomeDoors";
import { setPendingLecture } from "@/lib/pendingLecture";
import { PromptTiles } from "@/components/pages/PromptTiles";
import { findYouTubeLink } from "@/lib/youtube/videoUrl";
import { YouTubeLauncher } from "@/components/pages/YouTubeLauncher";
import { AriaMark } from "@/components/brand/AriaMark";
import { AriaHero } from "@/components/pages/AriaHero";

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
  const [guideOpen, setGuideOpen] = useState(false);
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

  // A brand-new account meets the guide once, by itself; after that it waits behind its door.
  useEffect(() => {
    if (!user) return;
    const t = window.setTimeout(() => { if (!guideSeen()) setGuideOpen(true); }, 900);
    return () => window.clearTimeout(t);
  }, [user]);

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
          <IconWord icon={<CircleHelp size={18} strokeWidth={1.7} />} word="Guide" onClick={() => setGuideOpen(true)} pressed={guideOpen} />
          {user && (
            <>
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

      <div className="relative z-10 mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-7 px-5 pb-20 pt-[3vh] sm:pt-[5vh]">
        {/* Her name, and nothing else, at the centre: over a sphere of light in orbit (AriaHero). */}
        <div className="hud-materialize relative -mb-2 flex w-full flex-col items-center overflow-x-clip">
          <AriaHero size={180} />
          <h1 className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-display text-[3.6rem] font-medium leading-none tracking-[-0.03em] text-white sm:text-[4.4rem]" style={{ textShadow: "0 2px 28px rgba(10,10,20,0.55)" }}>
            Aria
          </h1>
        </div>

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

        {/* The two doors, for anyone: the Library (your lectures) and the Map (what you know). */}
        {user && (
          <div className="hud-materialize grid gap-3 sm:grid-cols-2">
            <LibraryDoor onOpenAll={() => setLibraryOpen(true)} onReplay={replayLecture} />
            <MapDoor onOpen={() => go("knowledge")} />
          </div>
        )}

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

      {guideOpen && <GuideSheet onClose={() => setGuideOpen(false)} onTry={(t) => setTopic(t)} />}

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
          className={`size-2 rounded-full transition-colors ${on ? "bg-[var(--warm)]" : "bg-[var(--hud-line-strong)]"} ${i === todayIndex ? "ring-2 ring-[var(--hud-cyan-glow)]" : ""}`}
        />
      ))}
    </div>
  );
}
