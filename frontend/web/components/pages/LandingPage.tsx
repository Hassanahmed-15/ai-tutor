"use client";

import { useRef, useState } from "react";
import { ArrowUp, FileUp, Orbit, PanelLeft, Settings, X } from "lucide-react";
import type { PageName } from "@/components/hud/HudKit";
import { setPendingBrief } from "@/lib/pendingBrief";
import { useAuth } from "@/components/auth/AuthGate";
import { Leaderboard } from "@/components/adhd/Leaderboard";
import { Thoughts } from "@/components/adhd/Thoughts";
import { isAdhdLearner } from "@/lib/adhd/gate";
import { VoicePromptButton } from "@/components/upload/VoicePromptButton";
import { LectureHistory, type ReplayPackage } from "@/components/lecture/LectureHistory";
import { setPendingLecture } from "@/lib/pendingLecture";
import { PromptTiles } from "@/components/pages/PromptTiles";
import { findYouTubeLink } from "@/lib/youtube/videoUrl";
import { YouTubeLauncher } from "@/components/pages/YouTubeLauncher";
import { AriaLockup } from "@/components/brand/AriaMark";

/**
 * The front page: lecture history in a sidebar on the left, a quiet header with the YouTube door,
 * the knowledge map and the account on the right, and between them the two ways in — type a
 * subject, or bring a PDF or deck.
 *
 * The handoff to LearnPage carries whatever was provided via sessionStorage, because the router only
 * passes a page name and this page has no other channel to it. LearnPage owns the parsing pipeline
 * and keeps owning it — nothing about upload handling is duplicated here.
 */
export function LandingPage({ go }: { go: (p: PageName) => void; onStart: () => void }) {
  const [topic, setTopic] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  /** A link typed into the prompt box, handed to the YouTube launcher; `key` remounts it per hand-over. */
  const [videoHandOff, setVideoHandOff] = useState<{ url: string; key: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** The history sidebar, on a narrow screen where it is a drawer. */
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, profile, openSettings } = useAuth();
  const adhd = isAdhdLearner(profile);

  const canStart = topic.trim().length > 0 || file !== null;

  /**
   * A chosen file goes straight through.
   *
   * The upload IS the request — the very next screen asks which pages and which part. The uploader
   * is separate from the prompt box, so it never carries the box's text along: a question about the
   * document is typed on the page picker, beside the pages it is about.
   */
  function startWithFile(chosen: File) {
    setFile(chosen);
    setPendingBrief({ topic: "", file: chosen });
    go("learn");
  }

  /** A checked video link (YouTubeLauncher): the lesson is a short version of that video. */
  function startWithVideo(url: string) {
    setPendingBrief({ topic: "", file: null, videoUrl: url });
    go("learn");
  }

  function start() {
    if (!canStart) return;
    /*
     * A YOUTUBE LINK IN THE BOX IS A SOURCE, NOT A SUBJECT. The video pipeline has its own button,
     * but a link pasted here is still understood: it is handed to that button's launcher, so it
     * goes through the same length check and long-video warning. With a file attached the file
     * wins, as it always has.
     */
    const video = file ? null : findYouTubeLink(topic);
    if (video) {
      setVideoHandOff({ url: video.link.url, key: Date.now() });
      return;
    }
    // The file itself is handed over, not just its name — the student chose it here and must not
    // be asked to choose it again on the next screen.
    setPendingBrief({ topic: topic.trim(), file });
    go("learn");
  }

  function replayLecture(lecture: ReplayPackage) {
    setPendingLecture({ ...lecture, mode: lecture.mode ?? "standard" });
    go("learn");
  }

  return (
    <main className="hud-canvas relative flex min-h-screen">
      {/*
        THE HISTORY SIDEBAR, as ChatGPT and Claude keep past conversations: always there on a wide
        screen, a drawer on a narrow one. The page beside it holds only the ways in.
      */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close the sidebar"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-[var(--scrim)] lg:hidden"
        />
      )}
      <aside
        aria-label="Your lectures"
        className={`fixed inset-y-0 left-0 z-40 flex w-[17rem] shrink-0 flex-col border-r border-[var(--hud-line)] bg-[var(--sidebar)] transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-[4.25rem] shrink-0 items-center justify-between px-4">
          <AriaLockup size={24} />
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close the sidebar"
            className="grid size-8 place-items-center rounded-[var(--radius)] text-[var(--hud-text-dim)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--hud-text)] lg:hidden"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <LectureHistory onReplay={replayLecture} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-[4.25rem] items-center justify-between gap-3 border-b border-[var(--hud-line)] bg-[var(--hud-bg)] px-4 sm:px-6">
          <div className="flex items-center gap-2 lg:invisible">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open your lectures"
              className="grid size-9 place-items-center rounded-[var(--radius)] text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)] lg:hidden"
            >
              <PanelLeft aria-hidden="true" size={18} strokeWidth={1.8} />
            </button>
            <span className="lg:hidden">
              <AriaLockup size={22} />
            </span>
          </div>
          <nav aria-label="Main" className="flex items-center gap-1">
            {/* The YouTube pipeline's own door, top right beside the knowledge map (see
                YouTubeLauncher). Remounted per hand-over from the prompt box. */}
            <YouTubeLauncher key={videoHandOff?.key ?? 0} initialUrl={videoHandOff?.url} onStart={startWithVideo} />
            {/* Absent entirely when auth is disabled, so the no-database path still renders as before. */}
            {user && (
              <>
                <button
                  type="button"
                  onClick={() => go("knowledge")}
                  className="inline-flex h-9 items-center gap-2 rounded-[var(--radius)] px-3 text-[0.875rem] text-[var(--hud-text-dim)] transition-colors hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
                >
                  <Orbit aria-hidden="true" size={15} strokeWidth={1.8} />
                  <span className="max-sm:sr-only">Your knowledge map</span>
                </button>
                <button
                  type="button"
                  data-account-button
                  onClick={openSettings}
                  className="ml-1 inline-flex h-9 items-center gap-2 rounded-[var(--radius)] border border-[var(--hud-line)] bg-[var(--hud-surface)] py-1 pl-1 pr-3 text-[0.875rem] text-[var(--hud-text)] transition-colors hover:bg-[var(--hud-surface-2)]"
                >
                  <span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-[var(--hud-surface-2)] text-[var(--hud-text-dim)]">
                    <Settings size={14} strokeWidth={1.8} />
                  </span>
                  <span className="max-w-[10rem] truncate max-sm:sr-only">{user.username}</span>
                </button>
              </>
            )}
          </nav>
        </header>

        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-10 px-5 pb-24 pt-12 sm:pt-16">
          <section className="hud-materialize flex flex-col gap-3">
            {profile?.displayName && (
              <p className="text-[0.875rem] text-[var(--hud-text-dim)]">Welcome back, {profile.displayName}.</p>
            )}
            <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-[var(--hud-text)]">
              What do you want to learn?
            </h1>
            <p className="text-[0.95rem] text-[var(--hud-text-dim)]">
              Ask anything. Aria plans the lesson with you and teaches it on a board.
            </p>
          </section>

          <form
            className="hud-materialize"
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
          >
            <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-4 shadow-[var(--elev-1)] transition-colors focus-within:border-[var(--hud-line-strong)]">
              <label htmlFor="brief" className="sr-only">
                What should Aria teach?
              </label>
              {/* A textarea, not an input, so a long brief stays visible. It grows to a cap and then
                  scrolls. Enter still submits (Shift+Enter for a newline). */}
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
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    start();
                  }
                }}
                rows={2}
                placeholder="Explain the Krebs cycle…"
                autoFocus
                className="min-h-[3.5rem] w-full resize-none bg-transparent px-1 text-[1rem] leading-relaxed text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:outline-none focus-visible:outline-none"
              />
              <div className="flex items-center justify-end gap-2">
                <VoicePromptButton baseText={topic} onTranscript={setTopic} title="Speak your topic" />
                <button
                  type="submit"
                  disabled={!canStart}
                  aria-label="Start the lesson"
                  className="hud-btn-primary grid size-9 shrink-0 place-items-center disabled:cursor-not-allowed"
                >
                  <ArrowUp aria-hidden="true" size={17} strokeWidth={2.2} />
                </button>
              </div>
            </div>
          </form>

          {/* THE UPLOADER, ON ITS OWN. A document is a different way in from a question: the student
              may have nothing to type, only pages to pick. Choosing a file never takes text from the
              box above; a question about the document is asked on the page picker, next to the pages. */}
          <section aria-labelledby="upload-heading" className="hud-materialize flex flex-col gap-3">
            <h2 id="upload-heading" className="text-[0.8125rem] font-medium text-[var(--hud-text-dim)]">
              Or teach from your own document
            </h2>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.pptx,.ppt,.docx,.doc,.json"
              className="sr-only"
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                // Reset, so picking the same file twice still fires a change event.
                e.target.value = "";
                if (chosen) startWithFile(chosen);
              }}
              aria-label="Attach a PDF, slide deck, or document"
            />
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) startWithFile(dropped);
              }}
              onClick={() => fileRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center gap-4 rounded-[var(--radius-lg)] border border-dashed px-6 py-7 text-center transition-colors sm:flex-row sm:text-left ${
                dragging
                  ? "border-[var(--hud-cyan)] bg-[var(--accent-soft)]"
                  : "border-[var(--hud-line-strong)] bg-[var(--hud-surface)] hover:bg-[var(--hud-surface-2)]"
              }`}
            >
              <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-[var(--radius)] bg-[var(--hud-surface-2)] text-[var(--hud-text-dim)]">
                <FileUp size={18} strokeWidth={1.8} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[0.95rem] font-medium text-[var(--hud-text)]">Drop a PDF or slide deck here</span>
                <span className="text-[0.8125rem] text-[var(--hud-text-dim)]">
                  PDF · PPTX · DOCX. You choose the pages next, and can ask a question about them there.
                </span>
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  fileRef.current?.click();
                }}
                className="hud-btn-ghost inline-flex h-9 shrink-0 items-center px-4 text-[0.875rem] font-medium"
              >
                Choose file
              </button>
            </div>
          </section>

          {/* Lecture recommendations from the learner profile — signed-in learners only. */}
          {user && (
            <PromptTiles
              onPick={(prompt) => {
                setPendingBrief({ topic: prompt, file: null });
                go("learn");
              }}
            />
          )}

          {/* The prompt page is where a learner starts, so it is where a standings table is actually
              seen. Gated on the profile — nobody outside the ADHD track is shown a board they can
              never appear on. The API gate is separate and independent; this one is only cosmetic. */}
          {adhd && <Leaderboard />}
          {adhd && <Thoughts />}
        </div>
      </div>
    </main>
  );
}
