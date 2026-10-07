"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eraser,
  FileText,
  Highlighter,
  MessageCircle,
  Mic,
  MicOff,
  Pause,
  Pencil,
  Play,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";

import type { BoardTool } from "./AnnotationLayer";
import { PLAYBACK_RATES, rateLabel } from "@/lib/playbackPrefs";

/**
 * THE ONLY CONTROLS ON SCREEN.
 *
 * What this replaces: eight undifferentiated icon buttons in the header — playback rate, draw,
 * highlight, export PDF, skip, play/pause, restart, end lesson — of which exactly one carried a
 * visible label. Two of them (the avatar and the red LogOut) did the same destructive thing, and
 * restart wiped the lecture with no confirmation. A first-time user could not tell which was safe.
 *
 * The rule here is that the resting state answers one question — "how do I play this and how do I
 * get back?" — and everything else is one deliberate click away. Marking up the board is a mode a
 * student enters; it does not need to be visible while they are listening.
 *
 * It sits BELOW the board rather than over it (the old overlays covered the teaching content from
 * all four corners), and it is the same dock at every screen size, so the mic never disappears the
 * way the 1280px sidebar did.
 */

export interface BoardDockProps {
  playing: boolean;
  onTogglePlay: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  canGoPrevious: boolean;
  canGoNext: boolean;
  tool: BoardTool;
  onToolChange: (tool: BoardTool) => void;
  /**
   * The student closed the markup tools — the X, or Escape. Not called when a tool is merely toggled
   * off inside the popover, which a student does BEFORE asking about what they highlighted.
   */
  onCloseTools?: () => void;
  onUndo: () => void;
  canUndo: boolean;
  micOn: boolean;
  onToggleMic: () => void;
  micAvailable: boolean;
  /** The typed-question panel: closed by default, opened here or by Aria answering. */
  askOpen?: boolean;
  onToggleAsk?: () => void;
  /** "Part 2 of 6" — the only progress text, because a ring around an avatar is not readable. */
  positionLabel: string;
  busy?: boolean;
  explainSelectionLabel?: string;
  onExplainSelection?: () => void;
  /**
   * The one-slide summary of the whole lecture. Always shown so the student knows it exists, but
   * enabled only once they have finished the lecture — it is a summary of what they watched.
   */
  onSummarize?: () => void;
  summaryUnlocked?: boolean;
  /**
   * WIDE: the dock becomes the screen's only bar, spanning the full width — `leading` (leave),
   * transport, `center` (the ask input, which takes the free space), tools, `trailing` (status).
   * The source-document lesson uses it so the header and a separate chat row can go, and the
   * source and board get the height.
   */
  wide?: boolean;
  /**
   * "Got it": the student's own signal that the question is answered. Understanding is decided by
   * this button alone — the lesson ends here rather than playing boards the student no longer needs.
   */
  onUnderstood?: () => void;
  /**
   * Playback speed. Shown only when both are given, so a dock that does not narrate is unchanged.
   * One button with the current speed on it; the choices open above it, like the markup tools —
   * five speeds in a row would make the rest of the dock the part a student has to look for.
   */
  speed?: number;
  onSpeedChange?: (speed: number) => void;
  leading?: React.ReactNode;
  center?: React.ReactNode;
  trailing?: React.ReactNode;
}

export function BoardDock(props: BoardDockProps) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement | null>(null);
  const [speedOpen, setSpeedOpen] = useState(false);
  const speedRef = useRef<HTMLDivElement | null>(null);

  // The speed menu closes on Escape and on any click outside it, so it never lingers over the board.
  useEffect(() => {
    if (!speedOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSpeedOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (speedRef.current && !speedRef.current.contains(event.target as Node)) setSpeedOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [speedOpen]);

  // Escape leaves the tools — the old overlays could only be dismissed by finding a small ✓ icon.
  useEffect(() => {
    if (!toolsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setToolsOpen(false);
      props.onToolChange("none");
      props.onCloseTools?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toolsOpen, props]);

  const marking = props.tool !== "none";

  return (
    <div className={`pointer-events-auto flex shrink-0 items-center justify-center gap-2 px-2 pb-2 sm:px-3 sm:pb-3 ${props.wide ? "pt-0" : "pt-2"}`}>
      <div className={`flex max-w-full items-center gap-1 rounded-[var(--radius-lg)] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-1.5 shadow-[var(--elev-2)] ${props.wide ? "w-full" : ""}`}>
        {props.leading}
        {props.leading && <div className="mx-1 h-7 w-px bg-[var(--hud-line)]" aria-hidden="true" />}
        <DockButton
          onClick={props.onPrevious}
          disabled={!props.canGoPrevious}
          label="Previous concept"
          shortcut="←"
        >
          <ChevronLeft size={20} />
        </DockButton>

        {/* The primary action, and the only one that is always labelled. */}
        <button
          onClick={props.onTogglePlay}
          className="flex h-11 items-center gap-1.5 rounded-[10px] bg-[var(--hud-cyan)] px-3.5 text-[0.9rem] font-medium text-[var(--accent-on)] transition hover:bg-[var(--accent-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hud-cyan)] sm:gap-2 sm:px-5"
          aria-label={props.playing ? "Pause the lecture" : "Play the lecture"}
        >
          {props.playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
          <span>{props.playing ? "Pause" : "Play"}</span>
        </button>

        <DockButton onClick={props.onNext} disabled={!props.canGoNext} label="Next concept" shortcut="→">
          <ChevronRight size={20} />
        </DockButton>

        {props.speed !== undefined && props.onSpeedChange && (
          <div className="relative" ref={speedRef}>
            <button
              type="button"
              onClick={() => setSpeedOpen((open) => !open)}
              aria-label={`Playback speed, ${rateLabel(props.speed)}`}
              aria-haspopup="true"
              aria-expanded={speedOpen}
              data-speed-button
              className={`flex h-11 min-w-[3.25rem] items-center justify-center rounded-xl px-2.5 text-[0.84rem] font-bold tabular-nums transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hud-cyan)] ${
                speedOpen || props.speed !== 1
                  ? "bg-[var(--hud-surface-2)] text-[var(--hud-text)]"
                  : "text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
              }`}
            >
              {rateLabel(props.speed)}
            </button>
            {speedOpen && (
              <div
                role="group"
                aria-label="Playback speed"
                className="absolute bottom-[calc(100%+10px)] left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-[var(--hud-line)] bg-[var(--hud-surface)] p-1.5 shadow-[var(--elev-2)] backdrop-blur-xl"
              >
                {PLAYBACK_RATES.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    data-speed-choice={choice}
                    aria-pressed={props.speed === choice}
                    onClick={() => {
                      props.onSpeedChange?.(choice);
                      setSpeedOpen(false);
                    }}
                    className={`h-9 min-w-[3.25rem] rounded-xl px-2.5 text-[0.84rem] font-bold tabular-nums transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--hud-cyan)] ${
                      props.speed === choice ? "bg-[var(--hud-cyan)] text-[var(--accent-on)]" : "text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
                    }`}
                  >
                    {rateLabel(choice)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mx-1 h-7 w-px bg-[var(--hud-line)]" aria-hidden="true" />

        {props.center && <div className="min-w-0 flex-1">{props.center}</div>}
        {props.center && <div className="mx-1 h-7 w-px bg-[var(--hud-line)]" aria-hidden="true" />}

        {/* Progressive disclosure: one button, not four, until the student wants to mark up. */}
        <div className="relative" ref={toolsRef}>
          <DockButton
            onClick={() => {
              const next = !toolsOpen;
              setToolsOpen(next);
              if (!next) {
                props.onToolChange("none");
                props.onCloseTools?.();
              }
            }}
            active={marking || toolsOpen}
            label={marking ? "Marking up — click to stop" : "Mark up the board"}
            /* The tools popover opens directly above this button, so its own tooltip would land on
             * top of the thing it just opened and cover the tool labels. */
            suppressTooltip={toolsOpen}
          >
            {marking ? <X size={19} /> : <Pencil size={19} />}
          </DockButton>

          {toolsOpen && (
            <div
              role="group"
              aria-label="Markup tools"
              className="absolute bottom-[calc(100%+10px)] left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-[var(--hud-line)] bg-[var(--hud-surface)] p-1.5 shadow-[var(--elev-2)] backdrop-blur-xl"
            >
              <ToolButton
                active={props.tool === "pen"}
                onClick={() => props.onToolChange(props.tool === "pen" ? "none" : "pen")}
                label="Pen"
              >
                <Pencil size={18} />
              </ToolButton>
              <ToolButton
                active={props.tool === "highlighter"}
                onClick={() => props.onToolChange(props.tool === "highlighter" ? "none" : "highlighter")}
                label="Highlighter"
              >
                <Highlighter size={18} />
              </ToolButton>
              <ToolButton
                active={props.tool === "eraser"}
                onClick={() => props.onToolChange(props.tool === "eraser" ? "none" : "eraser")}
                label="Eraser"
              >
                <Eraser size={18} />
              </ToolButton>
              <div className="mx-0.5 h-6 w-px bg-[var(--hud-line)]" aria-hidden="true" />
              <ToolButton active={false} onClick={props.onUndo} disabled={!props.canUndo} label="Undo" shortcut="⌘Z">
                <Undo2 size={18} />
              </ToolButton>
            </div>
          )}
        </div>

        {props.explainSelectionLabel && props.onExplainSelection && (
          <button
            onClick={props.onExplainSelection}
            disabled={props.busy}
            className="flex h-11 max-w-[16rem] items-center gap-2 rounded-xl bg-[var(--hud-cyan)] px-3.5 text-[0.84rem] font-medium text-[var(--accent-on)] transition hover:bg-[var(--accent-hover)] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hud-cyan)]"
          >
            <Sparkles size={16} />
            <span className="truncate">{props.busy ? "Asking Aria…" : props.explainSelectionLabel}</span>
          </button>
        )}

        {props.onUnderstood && (
          <button
            onClick={props.onUnderstood}
            title="I understand this — end the lesson"
            aria-label="Got it — I understand, end the lesson"
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-[var(--hud-line)] bg-[var(--hud-surface)] px-3 text-[0.84rem] font-medium text-[var(--hud-text)] transition hover:bg-[var(--hud-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hud-cyan)]"
          >
            <Check size={16} className="text-[var(--ok)]" />
            <span>Got it</span>
          </button>
        )}

        {props.onSummarize && (
          <button
            onClick={props.onSummarize}
            disabled={!props.summaryUnlocked}
            data-summarize-lecture=""
            title={props.summaryUnlocked ? "See the whole lecture on one slide" : "Finish the whole lecture to unlock the one-slide summary"}
            aria-label={props.summaryUnlocked ? "Summarize the lecture in one slide" : "Summarize the lecture — unlocks when you finish the lecture"}
            className="flex h-11 w-11 items-center justify-center gap-2 rounded-xl border border-[var(--hud-line)] px-0 text-[0.84rem] font-semibold text-[var(--hud-text)] transition hover:bg-[var(--hud-surface-2)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hud-cyan)] sm:w-auto sm:px-3.5"
          >
            <FileText size={16} />
            <span className="hidden sm:inline">Summarize</span>
          </button>
        )}

        {props.onToggleAsk && (
          <DockButton onClick={props.onToggleAsk} active={props.askOpen} label={props.askOpen ? "Close the questions" : "Ask Aria"}>
            <MessageCircle size={19} />
          </DockButton>
        )}

        {props.micAvailable && (
          <DockButton
            onClick={props.onToggleMic}
            active={props.micOn}
            label={props.micOn ? "Microphone on — click to mute" : "Talk to Aria"}
            tone={props.micOn ? "live" : "default"}
          >
            {props.micOn ? <Mic size={19} /> : <MicOff size={19} />}
          </DockButton>
        )}

        {/* Wide mode leaves "Part N of M" to the board's own strip, which already names it. */}
        {props.trailing}
      </div>

      {!props.wide && (
        <p className="hidden text-[0.8rem] tabular-nums text-[var(--hud-text-dim)] sm:block" aria-live="polite">
          {props.positionLabel}
        </p>
      )}
    </div>
  );
}

function DockButton({
  children,
  onClick,
  disabled,
  active,
  label,
  shortcut,
  tone = "default",
  suppressTooltip,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  label: string;
  shortcut?: string;
  tone?: "default" | "live";
  suppressTooltip?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={`group relative flex h-11 w-11 items-center justify-center rounded-xl transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hud-cyan)] disabled:opacity-25 ${
        active
          ? tone === "live"
            ? "bg-[var(--danger-dim)] text-[var(--hud-danger)]"
            : "bg-[var(--accent-soft)] text-[var(--hud-cyan)]"
          : "text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
      }`}
    >
      {children}
      {/* A real tooltip, because an icon alone does not tell a first-time user what it does. */}
      {!suppressTooltip && (
        <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[var(--hud-text)] px-2.5 py-1.5 text-[0.72rem] font-medium text-[var(--hud-bg)] opacity-0 shadow-[var(--elev-2)] transition group-hover:opacity-100 group-focus-visible:opacity-100">
          {label}
          {shortcut && <span className="ml-1.5 opacity-60">{shortcut}</span>}
        </span>
      )}
    </button>
  );
}

function ToolButton({
  children,
  onClick,
  active,
  disabled,
  label,
  shortcut,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  disabled?: boolean;
  label: string;
  shortcut?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-10 items-center gap-2 rounded-lg px-3 text-[0.82rem] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--hud-cyan)] disabled:opacity-25 ${
        active ? "bg-[var(--accent-soft)] text-[var(--hud-cyan)]" : "text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
      }`}
    >
      {children}
      <span>{label}</span>
      {shortcut && <span className="text-[var(--hud-text-dim)]">{shortcut}</span>}
    </button>
  );
}
