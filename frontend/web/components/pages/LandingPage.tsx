"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUp, BookOpen, CircleHelp, GraduationCap, Paperclip, Smartphone, Waypoints, X } from "lucide-react";
import type { PageName } from "@/components/hud/HudKit";
import { setPendingBrief, type CapturedDocument } from "@/lib/pendingBrief";
import { PhoneCapturePanel } from "@/components/upload/PhoneCapturePanel";
import { useAuth } from "@/components/auth/AuthGate";
import { Leaderboard } from "@/components/adhd/Leaderboard";
import { Thoughts } from "@/components/adhd/Thoughts";
import { isAdhdLearner } from "@/lib/adhd/gate";
import { VoicePromptButton } from "@/components/upload/VoicePromptButton";
import { LectureHistory, type ReplayPackage } from "@/components/lecture/LectureHistory";
import { GuideSheet, guideSeen } from "@/components/pages/GuideSheet";
import { setPendingLecture } from "@/lib/pendingLecture";
import { peekPendingCurriculum, peekPendingTopic, takePendingCurriculum, takePendingTopic } from "@/lib/pendingTopic";
import { PromptTiles } from "@/components/pages/PromptTiles";
import { ScreenMarkHelp } from "@/components/pages/ScreenMarkHelp";
import { findYouTubeLink } from "@/lib/youtube/videoUrl";
import { YouTubeLauncher } from "@/components/pages/YouTubeLauncher";
import { AriaMark } from "@/components/brand/AriaMark";
import { AriaBot } from "@/components/pages/AriaBot";
import { MiniAria } from "@/components/avatar/MiniAria";
import { SpendPill } from "@/components/SpendPill";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

/**
 * THE FRONT PAGE, with as little to read as a page can have: Aria herself saying hello, one place
 * to answer her, the last lecture to go back to, and three ways in picked for this student. The library (every lecture) is a sheet opened from the top right, not a list
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
  // The QR capture panel ("Phone" beside "File").
  const [phoneOpen, setPhoneOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const briefRef = useRef<HTMLTextAreaElement>(null);
  const dragDepth = useRef(0);
  const { user, profile, openSettings } = useAuth();
  const adhd = isAdhdLearner(profile);
  const canStart = topic.trim().length > 0;

  function startWithFile(chosen: File) {
    // The upload is the request: the next screen asks which pages and which part.
    setPendingBrief({ topic: "", file: chosen });
    go("learn");
  }
  /** The phone's pages, read and assembled (components/upload/PhoneCapturePanel.tsx): the builder asks reference or strict. */
  function startWithCaptured(captured: CapturedDocument) {
    setPhoneOpen(false);
    setPendingBrief({ topic: "", file: null, captured });
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

  // A topic typed on the welcome page before the account existed: start that lesson now. The guide
  // waits for a later visit — this student already knows what they came for.
  // Peeked at render (a pure read, safe to run twice), taken in the effect.
  // A course lesson picked in the course browser arrives the same way, as an address.
  const [arrivedWithLesson] = useState(() => (typeof window !== "undefined" ? peekPendingCurriculum() : null));
  const [arrivedWithTopic] = useState(() => (typeof window !== "undefined" ? (arrivedWithLesson ? "course lesson" : peekPendingTopic()) : null));
  useEffect(() => {
    if (!arrivedWithTopic) return;
    if (arrivedWithLesson) {
      takePendingCurriculum();
      setPendingBrief({ topic: "", file: null, curriculum: arrivedWithLesson });
    } else {
      takePendingTopic();
      setPendingBrief({ topic: arrivedWithTopic, file: null });
    }
    go("learn");
  }, [arrivedWithTopic, arrivedWithLesson, go]);

  // A brand-new account meets the guide once, by itself; after that it waits behind its door.
  useEffect(() => {
    if (!user || arrivedWithTopic) return;
    const t = window.setTimeout(() => { if (!guideSeen()) setGuideOpen(true); }, 900);
    return () => window.clearTimeout(t);
  }, [user, arrivedWithTopic]);

  // Escape closes the library, as it closes any sheet.
  useEffect(() => {
    if (!libraryOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLibraryOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [libraryOpen]);

  return (
    <main
      className="home-page relative flex flex-col"
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

      {/* z-20, one above the page below it, so the spend pill's breakdown opens over the content. */}
      <header className="home-header relative z-20 flex items-center justify-between">
        <span className="relative inline-flex items-center" aria-label="Aria">
          <AriaMark size={34} label="Aria" />
        </span>
        <nav aria-label="Main" className="flex items-center gap-2.5">
          {/* Desktop app only: how to mark anything on the screen, in a panel under this door. */}
          {user && <ScreenMarkHelp />}
          <button type="button" onClick={() => setGuideOpen(true)} aria-pressed={guideOpen} aria-label="Guide" title="Guide" className="home-round">
            <CircleHelp aria-hidden="true" size={17} strokeWidth={1.8} />
          </button>
          <ThemeToggle />
          {user && (
            <>
              {/* Today's AI spend — Hassan's and Minahil's accounts only (renders nothing for anyone else). */}
              <SpendPill />
              <button
                type="button"
                data-account-button
                onClick={openSettings}
                aria-label={`Account: ${user.username}`}
                className="home-round text-[0.875rem] font-semibold uppercase"
              >
                {(profile?.displayName ?? user.username).trim().charAt(0) || "A"}
              </button>
            </>
          )}
        </nav>
      </header>

      {/* THE OWNER'S HOMEPAGE (UI_motivation, 2026-11-27): Aria on her stage at the left, the question and the
          ask box at the right, with the chips and the Explore shelf under it. One column on a phone. */}
      <div className="home-grid relative z-10">
        <div className="hud-materialize min-h-0">
          <AriaBot variant="stage" />
        </div>

        <section className="home-right">
          <div className="home-inner">
            <h2 className="home-title">What shall we <em>learn</em> today?</h2>

            {/* Above the shelf: the Video panel opens out of this box over it. */}
            <div className={`home-askarea relative z-20 ${topic.trim() ? "is-typing" : ""}`}>
              {/* Mini Aria peeks over the box while the student types, and thinks when they stop. */}
              <div className="home-pal" aria-hidden="true">
                <MiniAria text={topic} className="home-mini" />
                <div className="home-thought"><i className="t2" /><i className="t1" /><div className="tb"><b /><b /><b /></div></div>
              </div>
              <form className="home-ask" onSubmit={(e) => { e.preventDefault(); start(); }}>
                <label htmlFor="brief" className="sr-only">What should Aria teach?</label>
                <textarea
                  id="brief"
                  ref={briefRef}
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); start(); }
                  }}
                  placeholder="Ask anything…"
                  autoFocus
                  className="min-h-0 w-full flex-1 resize-none bg-transparent text-[1.0625rem] font-medium leading-relaxed text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none"
                />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => fileRef.current?.click()} className="home-pill">
                    <Paperclip aria-hidden="true" size={14} strokeWidth={1.8} /> File
                  </button>
                  {/* Photograph pages with the phone (the QR capture): read as they are taken, then taught like a PDF. */}
                  {user && (
                    <button type="button" onClick={() => setPhoneOpen(true)} className="home-pill">
                      <Smartphone aria-hidden="true" size={14} strokeWidth={1.8} /> Phone
                    </button>
                  )}
                  <YouTubeLauncher key={videoHandOff?.key ?? 0} initialUrl={videoHandOff?.url} onStart={startWithVideo} compact />
                  <span className="flex-1" />
                  <VoicePromptButton baseText={topic} onTranscript={setTopic} title="Say it instead" />
                  <button type="submit" disabled={!canStart} aria-label="Start" className="home-send">
                    <ArrowUp aria-hidden="true" size={17} strokeWidth={2.2} />
                  </button>
                </div>
              </form>
            </div>

            {/* Picking a chip puts its words in the box, as the design does; Enter or the arrow starts it. */}
            <PromptTiles
              variant="chips"
              onPick={(prompt) => {
                setTopic(prompt);
                briefRef.current?.focus();
              }}
            />

            {user && (
              <nav className="home-explore" aria-labelledby="home-explore">
                <h3 id="home-explore">Explore</h3>
                <div className="home-shelf">
                  <a className="home-row" href="/courses" aria-label="Browse courses">
                    <span className="home-ico" aria-hidden="true"><GraduationCap size={20} strokeWidth={1.8} /></span>
                    <span className="home-rb"><b>Courses</b><span>IGCSE, O Level, A Level, AP</span></span>
                    <span className="home-go" aria-hidden="true"><ArrowRight size={14} /></span>
                  </a>
                  <button type="button" className="home-row is-mint" onClick={() => setLibraryOpen(true)} aria-label="Open library">
                    <span className="home-ico" aria-hidden="true"><BookOpen size={20} strokeWidth={1.8} /></span>
                    <span className="home-rb"><b>Library</b><span>Every lecture you take</span></span>
                    <span className="home-go" aria-hidden="true"><ArrowRight size={14} /></span>
                  </button>
                  <button type="button" className="home-row" onClick={() => go("knowledge")} aria-label="Open map">
                    <span className="home-ico" aria-hidden="true"><Waypoints size={20} strokeWidth={1.8} /></span>
                    <span className="home-rb"><b>Map</b><span>What to review next</span></span>
                    <span className="home-go" aria-hidden="true"><ArrowRight size={14} /></span>
                  </button>
                </div>
              </nav>
            )}

            {adhd && <div className="mt-6 flex flex-col gap-4"><Leaderboard /><Thoughts /></div>}
          </div>
        </section>
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
      {phoneOpen && <PhoneCapturePanel onClose={() => setPhoneOpen(false)} onDocument={startWithCaptured} />}
    </main>
  );
}
