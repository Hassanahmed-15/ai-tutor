"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, TriangleAlert, X } from "lucide-react";
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
 * IN THE TOP-RIGHT OF THE HEADER, beside the knowledge map (asked for 2026-10-06; it was in the
 * bottom-left corner before). The panel drops down from the button.
 */

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
      <rect width="28" height="20" rx="6" fill="#C8302C" />
      <path d="M11.2 5.6v8.8L18.6 10z" fill="#fff" />
    </svg>
  );
}

export function YouTubeLauncher({
  onStart,
  initialUrl = "",
  compact = false,
}: {
  /** A chip inside the composer (icon and one word) instead of the header button. */
  compact?: boolean;
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

  const open = phase.kind !== "closed";

  // Escape closes the panel, as it does any dropdown.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // close() only reads refs and a setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setPhase({ kind: "editing" }))}
        onMouseEnter={() => setTipOpen(true)}
        onMouseLeave={() => setTipOpen(false)}
        onFocus={() => setTipOpen(true)}
        onBlur={() => setTipOpen(false)}
        aria-expanded={open}
        aria-describedby={tipOpen && !open ? tipId : undefined}
        className={compact
          ? `inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[0.8125rem] transition-colors ${open ? "border-[var(--hud-line-strong)] bg-[var(--hud-surface-2)] text-[var(--hud-text)]" : "border-[var(--hud-line)] text-[var(--hud-text-dim)] hover:border-[var(--hud-line-strong)] hover:text-[var(--hud-text)]"}`
          : `inline-flex h-9 items-center gap-2 rounded-[var(--radius)] px-3 text-[0.875rem] transition-colors hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)] ${
          open ? "bg-[var(--hud-surface-2)] text-[var(--hud-text)]" : "text-[var(--hud-text-dim)]"
        }`}
      >
        <PlayGlyph size={compact ? 14 : 16} />
        <span className={compact ? "" : "max-sm:sr-only"}>{compact ? "Video" : "Summarize a YouTube lecture"}</span>
      </button>
      {tipOpen && !open && (
        <span
          id={tipId}
          role="tooltip"
          className="pointer-events-none absolute right-0 top-full z-30 mt-2 whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--hud-text)] px-2.5 py-1.5 text-[0.75rem] text-[var(--hud-bg)] shadow-[var(--elev-2)]"
        >
          Get a summary of a YouTube lecture
        </span>
      )}
      {open && (
      <div className={`absolute ${compact ? "left-0" : "right-0"} top-full z-50 mt-2 w-[min(420px,calc(100vw-2rem))] rounded-[var(--radius-lg)] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-4 text-left shadow-[var(--elev-2)]`}>
      <div className="flex items-center gap-2.5">
        <PlayGlyph size={20} />
        <p className="flex-1 text-[0.9375rem] font-medium text-[var(--hud-text)]">Summarize a YouTube lecture</p>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="rounded-[var(--radius-sm)] p-1.5 text-[var(--hud-text-dim)] transition-colors hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
        >
          <X aria-hidden="true" size={15} />
        </button>
      </div>

      {phase.kind === "long" ? (
        <div className="mt-3 rounded-[var(--radius)] border border-[var(--hud-line)] bg-[var(--warn-dim)] p-3" role="alert">
          <div className="flex gap-2.5">
            <TriangleAlert aria-hidden="true" size={17} className="mt-0.5 shrink-0 text-[var(--hud-warn)]" />
            <div className="text-[0.8125rem] leading-relaxed text-[var(--hud-text)]">
              <p className="font-semibold">
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
              className="hud-btn-ghost h-9 px-4 text-[0.8125rem] font-medium"
            >
              Use another video
            </button>
            <button
              type="button"
              onClick={() => {
                const link = parseYouTubeUrl(url);
                if (link) onStart(link.url);
              }}
              className="hud-btn-primary h-9 px-4 text-[0.8125rem]"
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
          <div className="flex items-center gap-2 rounded-[var(--radius)] border border-[var(--input-border)] bg-[var(--hud-surface)] py-1 pl-2 pr-1 focus-within:border-[var(--hud-cyan)]">
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
              className="hud-btn-primary inline-flex h-8 shrink-0 items-center gap-1.5 px-3.5 text-[0.8125rem] disabled:cursor-not-allowed"
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
            <p className="mt-2 text-[0.8125rem] text-[var(--hud-danger)]" role="alert">{phase.error}</p>
          ) : (
            <p className="mt-2 text-[0.8125rem] text-[var(--hud-text-dim)]">
              Public videos up to 3 hours. Aria watches the whole video and teaches a short version of it, with her own drawings.
            </p>
          )}
        </form>
      )}
      </div>
      )}
    </div>
  );
}
