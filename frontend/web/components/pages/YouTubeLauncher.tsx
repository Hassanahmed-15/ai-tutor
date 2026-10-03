"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Loader2, TriangleAlert, X } from "lucide-react";
import { formatTimestamp, parseYouTubeUrl } from "@/lib/youtube/videoUrl";

/**
 * THE YOUTUBE PIPELINE'S OWN DOOR.
 *
 * A video lecture is a different kind of request from a topic or a document — it is "give me the
 * short version of this", built from a source the student did not upload — so it gets its own
 * control rather than hiding inside the prompt box. Red, with its own play glyph, so it can never
 * be mistaken for the file drop zone above it.
 *
 * Before handing over, the video's length is checked (a free call: lib/youtube/geminiVideo.ts
 * videoDurationSec). Past half an hour the student is warned and asked to confirm: the reading
 * takes minutes rather than seconds, and the summary of a long lecture is itself long. It is a
 * warning, not a limit — the pipeline handles up to three hours.
 */

/*
 * IN THE BOTTOM-LEFT CORNER, apart from everything else on the page (asked for 2026-10-03). The
 * button and its panel are fixed there; the panel opens upward. In development Next.js puts its own
 * "N" badge in that corner, so the button sits beside it rather than under it.
 */
const CORNER_LEFT = process.env.NODE_ENV === "development" ? 72 : 20;

/** Past this a video gets a warning before it is read. */
export const LONG_VIDEO_SEC = 30 * 60;

type Phase =
  | { kind: "closed" }
  | { kind: "editing"; error?: string }
  | { kind: "checking" }
  | { kind: "long"; durationSec: number; title: string; readMinutes: number };

/**
 * Roughly how long reading will take, from what was measured (2026-10-03): about 50 s per
 * ten-minute clip, clips read `concurrency` at a time, plus about 25 s for the topics and notes.
 */
function readingMinutes(durationSec: number, concurrency: number): number {
  const clips = Math.max(1, Math.ceil(durationSec / 600));
  const seconds = Math.ceil(clips / Math.max(1, concurrency)) * 50 + 25;
  return Math.max(1, Math.round(seconds / 60));
}

/** A play glyph in the platform's red. Drawn here, so no brand asset is shipped. */
function PlayGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size * 0.72} viewBox="0 0 28 20" className="shrink-0">
      <rect width="28" height="20" rx="6" fill="#ff1f3d" />
      <path d="M11.2 5.6v8.8L18.6 10z" fill="#fff" />
    </svg>
  );
}

export function YouTubeLauncher({
  onStart,
  initialUrl = "",
}: {
  /** A checked, confirmed video link: hand it to the lesson builder. */
  onStart: (url: string) => void;
  /**
   * A link typed into the main prompt box. The launcher opens on it and runs the same check, so a
   * long video is warned about whichever way it came in.
   */
  initialUrl?: string;
}) {
  const [phase, setPhase] = useState<Phase>(initialUrl ? { kind: "checking" } : { kind: "closed" });
  const [url, setUrl] = useState(initialUrl);
  const [tipOpen, setTipOpen] = useState(false);
  const tipId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** Checks the link and its length; returns the next phase, or null when it went straight through. */
  async function check(value: string): Promise<Phase | null> {
    const link = parseYouTubeUrl(value);
    if (!link) return { kind: "editing", error: "That doesn't look like a YouTube video link." };
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/youtube/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link.url }),
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        durationSec?: number;
        title?: string;
        readConcurrency?: number;
      };
      if (response.status === 401) return { kind: "editing", error: "Sign in to summarize a YouTube lecture." };
      if (!response.ok || typeof data.durationSec !== "number") {
        return { kind: "editing", error: data.error || "That video could not be opened. Try again in a moment." };
      }
      if (data.durationSec > LONG_VIDEO_SEC) {
        return {
          kind: "long",
          durationSec: data.durationSec,
          title: data.title ?? "",
          readMinutes: readingMinutes(data.durationSec, data.readConcurrency ?? 2),
        };
      }
      onStart(link.url);
      return null;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return { kind: "closed" };
      return { kind: "editing", error: "That video could not be opened. Check your connection and try again." };
    }
  }

  async function submit() {
    setPhase({ kind: "checking" });
    const next = await check(url);
    if (next) setPhase(next);
  }

  // A link handed over from the prompt box is checked as soon as the launcher appears.
  useEffect(() => {
    if (!initialUrl) return;
    let live = true;
    void check(initialUrl).then((next) => {
      if (live && next) setPhase(next);
    });
    return () => {
      live = false;
    };
    // Runs once per hand-over: the parent remounts the launcher (a new key) for each one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase.kind === "editing") inputRef.current?.focus();
  }, [phase.kind]);

  function close() {
    abortRef.current?.abort();
    setPhase({ kind: "closed" });
  }

  if (phase.kind === "closed") {
    return (
      <span className="yt-corner">
        <button
          type="button"
          onClick={() => setPhase({ kind: "editing" })}
          onMouseEnter={() => setTipOpen(true)}
          onMouseLeave={() => setTipOpen(false)}
          onFocus={() => setTipOpen(true)}
          onBlur={() => setTipOpen(false)}
          aria-describedby={tipOpen ? tipId : undefined}
          className="yt-launch group relative inline-flex items-center gap-2 overflow-hidden rounded-full border px-3 py-1.5 text-[0.76rem] font-semibold text-white transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff4d63]"
        >
          <PlayGlyph size={16} />
          <span>Summarize a YouTube lecture</span>
          <ArrowRight aria-hidden="true" size={12} strokeWidth={2.2} className="opacity-70 transition-transform duration-200 group-hover:translate-x-0.5" />
        </button>
        {tipOpen && (
          <span
            id={tipId}
            role="tooltip"
            className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 whitespace-nowrap rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-[0.75rem] text-[var(--hud-text)] shadow-lg"
            style={{ background: "var(--hud-surface-2, #1a1625)", borderColor: "var(--hud-line)" }}
          >
            Get a summary of a YouTube lecture
          </span>
        )}
        <YouTubeLauncherStyles />
      </span>
    );
  }

  return (
    <div className="yt-corner yt-panel rounded-[var(--radius-lg)] border p-4 text-left shadow-2xl">
      <div className="flex items-center gap-2.5">
        <PlayGlyph size={20} />
        <p className="flex-1 text-[0.88rem] font-semibold text-[var(--hud-text)]">Summarize a YouTube lecture</p>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="rounded-[var(--radius-sm)] p-1 text-[var(--hud-text-faint)] transition-colors hover:text-[var(--hud-text)]"
        >
          <X aria-hidden="true" size={15} />
        </button>
      </div>

      {phase.kind === "long" ? (
        <div className="mt-3 rounded-[var(--radius)] border border-amber-400/40 bg-amber-400/10 p-3" role="alert">
          <div className="flex gap-2.5">
            <TriangleAlert aria-hidden="true" size={17} className="mt-0.5 shrink-0 text-amber-300" />
            <div className="text-[0.82rem] leading-relaxed text-amber-50/90">
              <p className="font-semibold text-amber-200">
                This lecture is {formatTimestamp(phase.durationSec)} long{phase.title ? `: "${phase.title}"` : ""}.
              </p>
              <p className="mt-1">
                Videos over 30 minutes take longer to read (about {phase.readMinutes} minute{phase.readMinutes === 1 ? "" : "s"} before the lesson starts), and
                the summary of a long lecture is longer too. Shorter videos give the quickest, tightest summaries.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setPhase({ kind: "editing" })}
              className="rounded-full border border-[var(--hud-line)] px-4 py-1.5 text-[0.8rem] text-[var(--hud-text-dim)] transition-colors hover:text-[var(--hud-text)]"
            >
              Use another video
            </button>
            <button
              type="button"
              onClick={() => {
                const link = parseYouTubeUrl(url);
                if (link) onStart(link.url);
              }}
              className="rounded-full bg-amber-300 px-4 py-1.5 text-[0.8rem] font-semibold text-slate-950 transition-colors hover:bg-amber-200"
            >
              Continue anyway
            </button>
          </div>
        </div>
      ) : (
        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex items-center gap-2 rounded-[var(--radius)] border px-2 py-1.5" style={{ borderColor: "rgba(255, 77, 99, 0.45)", background: "var(--hud-surface)" }}>
            <label htmlFor="youtube-url" className="sr-only">YouTube link</label>
            <input
              id="youtube-url"
              ref={inputRef}
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                if (phase.kind === "editing" && phase.error) setPhase({ kind: "editing" });
              }}
              disabled={phase.kind === "checking"}
              placeholder="Paste a YouTube link, e.g. https://youtu.be/…"
              inputMode="url"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-[0.9rem] text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={phase.kind === "checking" || !url.trim()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#ff1f3d] px-3.5 py-1.5 text-[0.8rem] font-semibold text-white transition-colors hover:bg-[#ff4d63] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {phase.kind === "checking" ? (
                <>
                  <Loader2 aria-hidden="true" size={14} className="animate-spin" />
                  Checking
                </>
              ) : (
                "Summarize"
              )}
            </button>
          </div>
          {phase.kind === "editing" && phase.error ? (
            <p className="mt-2 text-[0.78rem] text-rose-300" role="alert">{phase.error}</p>
          ) : (
            <p className="mt-2 text-[0.74rem] text-[var(--hud-text-faint)]">
              Public videos up to 3 hours. Aria watches the whole video and teaches a short version of it, with her own drawings.
            </p>
          )}
        </form>
      )}
      <YouTubeLauncherStyles />
    </div>
  );
}

/** The launcher's own look: a red edge that slowly catches the light, distinct from every other control. */
function YouTubeLauncherStyles() {
  return (
    <style>{`
      .yt-corner { position: fixed; bottom: 20px; left: ${CORNER_LEFT}px; z-index: 40; }
      .yt-corner.yt-panel { width: min(420px, calc(100vw - ${CORNER_LEFT + 16}px)); }
      @media (max-width: 520px) { .yt-corner.yt-panel { left: 16px; right: 16px; width: auto; bottom: 16px; } }
      .yt-launch {
        border-color: rgba(255, 77, 99, 0.55);
        background:
          linear-gradient(135deg, rgba(255, 31, 61, 0.22), rgba(255, 31, 61, 0.06) 55%, rgba(255, 140, 60, 0.14)),
          #15111d;
        box-shadow: 0 0 0 1px rgba(255, 31, 61, 0.08), 0 8px 28px -10px rgba(255, 31, 61, 0.55);
      }
      .yt-launch::after {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(110deg, transparent 30%, rgba(255, 255, 255, 0.16) 50%, transparent 70%);
        transform: translateX(-120%);
        animation: yt-sheen 4.5s ease-in-out infinite;
        pointer-events: none;
      }
      .yt-launch:hover { box-shadow: 0 0 0 1px rgba(255, 31, 61, 0.2), 0 12px 34px -10px rgba(255, 31, 61, 0.75); }
      .yt-panel {
        border-color: rgba(255, 77, 99, 0.4);
        background: linear-gradient(160deg, rgba(255, 31, 61, 0.16), rgba(21, 17, 29, 0) 45%), #15111d;
      }
      @keyframes yt-sheen { 0%, 55% { transform: translateX(-120%); } 85%, 100% { transform: translateX(120%); } }
      @media (prefers-reduced-motion: reduce) { .yt-launch::after { animation: none; } .yt-launch { transition: none; } }
    `}</style>
  );
}
