"use client";

import {
  Gauge,
  Hand,
  Highlighter,
  LogOut,
  Mic,
  MicOff,
  Pause,
  Pencil,
  Play,
  Repeat,
  RotateCcw,
  Shuffle,
  SkipForward,
} from "lucide-react";
import { ControlDivider, ControlGroup, IconButton } from "./IconButton";
import { SpeakerLanes, VoiceState, type VoicePhase } from "./VoiceState";

/**
 * The persistent lecture control bar.
 *
 * Every control here is wired to behaviour that already exists in LessonPlayer — this component
 * renders and groups them, it does not implement them. Handlers are optional so the bar degrades
 * gracefully: a control with no handler is disabled rather than absent, which keeps the layout
 * stable and avoids the controls moving under the student's cursor between beats.
 *
 * Grouping is deliberate: voice, then transport, then teaching adjustments, then board tools, then
 * the destructive exit — separated so "end lesson" is never adjacent to "pause".
 */
export function LectureControls({
  phase,
  ariaSpeaking,
  studentSpeaking,
  muted,
  paused,
  drawing,
  highlighting,
  speed,
  onToggleMute,
  onInterrupt,
  onTogglePause,
  onRepeat,
  onExplainDifferently,
  onSlower,
  onFaster,
  onSkip,
  onRestart,
  onToggleDraw,
  onToggleHighlight,
  onEnd,
}: {
  phase: VoicePhase;
  ariaSpeaking: boolean;
  studentSpeaking: boolean;
  muted: boolean;
  paused: boolean;
  drawing?: boolean;
  highlighting?: boolean;
  speed?: number;
  onToggleMute?: () => void;
  onInterrupt?: () => void;
  onTogglePause?: () => void;
  onRepeat?: () => void;
  onExplainDifferently?: () => void;
  onSlower?: () => void;
  onFaster?: () => void;
  onSkip?: () => void;
  onRestart?: () => void;
  onToggleDraw?: () => void;
  onToggleHighlight?: () => void;
  onEnd?: () => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-2.5"
      style={{ borderColor: "var(--hud-line)", background: "var(--hud-bg-2)" }}
    >
      <VoiceState phase={phase} />
      <div className="hidden sm:block">
        <SpeakerLanes ariaSpeaking={ariaSpeaking} studentSpeaking={studentSpeaking} />
      </div>

      {/* Right-aligned on wide viewports; wraps beneath on narrow ones rather than overflowing. */}
      <div className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-2">
        <ControlGroup label="Voice">
          <IconButton
            icon={muted ? MicOff : Mic}
            label={muted ? "Unmute microphone" : "Mute microphone"}
            active={muted}
            tone={muted ? "danger" : "default"}
            onClick={onToggleMute}
            disabled={!onToggleMute}
          />
          <IconButton icon={Hand} label="Interrupt and ask" onClick={onInterrupt} disabled={!onInterrupt} />
        </ControlGroup>

        <ControlDivider />

        <ControlGroup label="Playback">
          <IconButton
            icon={paused ? Play : Pause}
            label={paused ? "Resume lecture" : "Pause lecture"}
            shortcut="Space"
            onClick={onTogglePause}
            disabled={!onTogglePause}
          />
          <IconButton icon={SkipForward} label="Skip ahead" onClick={onSkip} disabled={!onSkip} />
          <IconButton icon={RotateCcw} label="Restart lesson" onClick={onRestart} disabled={!onRestart} />
        </ControlGroup>

        <ControlDivider />

        <ControlGroup label="Teaching">
          <IconButton icon={Repeat} label="Repeat that" onClick={onRepeat} disabled={!onRepeat} />
          <IconButton
            icon={Shuffle}
            label="Explain differently"
            onClick={onExplainDifferently}
            disabled={!onExplainDifferently}
          />
          <IconButton
            icon={Gauge}
            label={speed ? `Speed ${speed}× — slower` : "Slow down"}
            onClick={onSlower}
            disabled={!onSlower}
          />
        </ControlGroup>

        <ControlDivider />

        <ControlGroup label="Board tools">
          <IconButton icon={Pencil} label="Draw on the board" active={drawing} onClick={onToggleDraw} disabled={!onToggleDraw} />
          <IconButton
            icon={Highlighter}
            label="Highlight the board"
            active={highlighting}
            onClick={onToggleHighlight}
            disabled={!onToggleHighlight}
          />
        </ControlGroup>

        <ControlDivider />

        <IconButton icon={LogOut} label="End lesson" tone="danger" onClick={onEnd} disabled={!onEnd} />
      </div>
    </div>
  );
}
