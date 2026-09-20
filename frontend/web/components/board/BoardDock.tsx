"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  Highlighter,
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
  onUndo: () => void;
  canUndo: boolean;
  micOn: boolean;
  onToggleMic: () => void;
  micAvailable: boolean;
  /** "Part 2 of 6" — the only progress text, because a ring around an avatar is not readable. */
  positionLabel: string;
  busy?: boolean;
  explainSelectionLabel?: string;
  onExplainSelection?: () => void;
}

export function BoardDock(props: BoardDockProps) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement | null>(null);

  // Escape leaves the tools — the old overlays could only be dismissed by finding a small ✓ icon.
  useEffect(() => {
    if (!toolsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setToolsOpen(false);
      props.onToolChange("none");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toolsOpen, props]);

  const marking = props.tool !== "none";

  return (
    <div className="pointer-events-auto flex shrink-0 items-center justify-center gap-2 px-3 pb-3 pt-2">
      <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-[#0d0f14]/95 p-1.5 shadow-2xl backdrop-blur-xl">
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
          className="flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-[0.9rem] font-semibold text-[#0d0f14] transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          aria-label={props.playing ? "Pause the lecture" : "Play the lecture"}
        >
          {props.playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
          <span>{props.playing ? "Pause" : "Play"}</span>
        </button>

        <DockButton onClick={props.onNext} disabled={!props.canGoNext} label="Next concept" shortcut="→">
          <ChevronRight size={20} />
        </DockButton>

        <div className="mx-1 h-7 w-px bg-white/10" aria-hidden="true" />

        {/* Progressive disclosure: one button, not four, until the student wants to mark up. */}
        <div className="relative" ref={toolsRef}>
          <DockButton
            onClick={() => {
              const next = !toolsOpen;
              setToolsOpen(next);
              if (!next) props.onToolChange("none");
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
              className="absolute bottom-[calc(100%+10px)] left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-white/10 bg-[#0d0f14]/98 p-1.5 shadow-2xl backdrop-blur-xl"
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
              <div className="mx-0.5 h-6 w-px bg-white/10" aria-hidden="true" />
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
            className="flex h-11 max-w-[16rem] items-center gap-2 rounded-xl bg-amber-300 px-3.5 text-[0.84rem] font-semibold text-[#12151c] transition hover:bg-amber-200 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          >
            <Sparkles size={16} />
            <span className="truncate">{props.busy ? "Asking Aria…" : props.explainSelectionLabel}</span>
          </button>
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
      </div>

      <p className="hidden text-[0.8rem] tabular-nums text-white/40 sm:block" aria-live="polite">
        {props.positionLabel}
      </p>
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
      className={`group relative flex h-11 w-11 items-center justify-center rounded-xl transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:opacity-25 ${
        active
          ? tone === "live"
            ? "bg-rose-500/20 text-rose-200"
            : "bg-amber-400/20 text-amber-200"
          : "text-white/70 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
      {/* A real tooltip, because an icon alone does not tell a first-time user what it does. */}
      {!suppressTooltip && (
        <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-black px-2.5 py-1.5 text-[0.72rem] font-medium text-white opacity-0 shadow-xl transition group-hover:opacity-100 group-focus-visible:opacity-100">
          {label}
          {shortcut && <span className="ml-1.5 text-white/40">{shortcut}</span>}
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
      className={`flex h-10 items-center gap-2 rounded-lg px-3 text-[0.82rem] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-25 ${
        active ? "bg-amber-400/20 text-amber-200" : "text-white/75 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
      <span>{label}</span>
      {shortcut && <span className="text-white/35">{shortcut}</span>}
    </button>
  );
}
