"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SlideStage } from "./SlideStage";
import { TeacherAvatar } from "./TeacherAvatar";
import { beats as demoBeats, type Beat } from "@/lib/lessonContent";
import { unlockAudio, splitNarrationSentences } from "@/lib/voice";
import { useVoiceDirector, type VoiceDirector } from "@/lib/useVoiceDirector";
import { useLessonMachine } from "@/lib/lessonMachine";
import { narrationRecovery } from "@/lib/narrationRecovery";
import { useTeacherQuiz } from "@/lib/useTeacherQuiz";
import { QuizPrompt } from "./QuizPrompt";
import { LiveSketch } from "./sketch/LiveSketch";
import { ReactAnimationSandbox } from "./sketch/ReactAnimationSandbox";
import { ManimBoard } from "./sketch/ManimBoard";
import { GsapSketch } from "./sketch/GsapSketch";
import { StructureBoard } from "./sketch/StructureBoard";
import { PlotBoard } from "./sketch/PlotBoard";
import { EquationBoard } from "./sketch/EquationBoard";
import type { StructureSpec } from "@/lib/structureSpec";
import type { PlotSpec } from "@/lib/plotSpec";
import type { EquationSpec } from "@/lib/equationSpec";
import { RendererBadge } from "./sketch/RendererBadge";
import { AdhdLayer } from "./adhd/AdhdLayer";
import { AdhdScoreChip } from "./adhd/AdhdScoreChip";
import { emitAdhdEvent, onAdhdCheckin, onAdhdFace, onAdhdSpeech, publishAdhdCheckin } from "@/lib/adhd/events";
import { mcqForCheckpoint, checkpointDueAt, questionSourceFor } from "@/lib/adhd/games/mcq";
import { MazeGame } from "@/components/adhd/games/MazeGame";
import { buildDocumentContext, buildLessonContext } from "@/lib/lessonChatContext";
import type { Expression } from "@/lib/adhd/expression";
import { Download, Highlighter, Loader2, LogOut, Pause, Pencil, Play, RotateCcw, SkipForward } from "lucide-react";
import { IconButton } from "@/components/classroom/IconButton";
import { VoiceState, derivePhase } from "@/components/classroom/VoiceState";
import { useManimPrefetch } from "@/lib/useManimPrefetch";
import { useNarrationPrefetch } from "@/lib/useNarrationPrefetch";
import { selectAnimationRenderer } from "@/lib/animationRouting";
import { useLessonChat, ChatPanel, ExplainOverlay } from "./lesson-chat/LessonChat";
import { HudCorners } from "./hud/HudKit";
import { useGeminiLiveTutor, type GeminiLiveBoard } from "@/lib/useGeminiLiveTutor";
import { useEngagementScore } from "@/lib/useEngagementScore";
import { EngagementMeter } from "./EngagementMeter";
import { FocusPauseOverlay } from "./FocusPauseOverlay";
import { CheckinOverlay } from "./adhd/CheckinOverlay";
import { CHECKIN_INVITE_CUE } from "@/lib/geminiLiveContract";
import { DrawOverlay } from "./sketch/DrawOverlay";
import { HighlightOverlay, type HlStroke } from "./sketch/HighlightOverlay";

// Client mirror of the server's REALTIME_TUTOR_ENABLED flag — gates the "Talk to tutor" button.
const REALTIME_TUTOR_ENABLED = process.env.NEXT_PUBLIC_REALTIME_TUTOR_ENABLED === "1";
/**
 * How long to let the old Live socket close before dialling the new persona.
 *
 * Changing persona means a reconnect, because the system instruction is fixed for the life of a
 * session. The previous value was 0ms, which held only because teardown and connection are both
 * effectively instant on a developer machine.
 */
const CHECKIN_RECONNECT_GAP_MS = 250;
/**
 * How many times a dropped check-in socket is re-dialled before offering the manual way back.
 *
 * Gemini Live drops sessions on its own. Three attempts covers the ordinary case without spinning
 * forever on a session that genuinely cannot stay open.
 */
const MAX_CHECKIN_RECONNECTS = 3;
// Sustained attention drift must persist this long before the lesson reacts, so a brief glance
// away never stops the lecture; the board then freezes for a beat before offering Resume.
const DRIFT_HOLD_MS = 2000;
const FOCUS_HOLD_MS = 5000;
/** How often (in beats) the teacher breaks off to check comprehension, the way a real one would. */
const UNDERSTANDING_CHECK_EVERY = 4;

// Client-side mirror of the server's REACT_ANIMATIONS_ENABLED kill switch (see
// app/api/generate-lecture/route.ts). When off, beats never carry filled `code` anyway (the
// server never generates it), so this only guards against rendering stale cached beats.
const REACT_ANIMATIONS_ENABLED = process.env.NEXT_PUBLIC_REACT_ANIMATIONS_ENABLED === "1";
// Client mirror of the server's BLACKBOARD_GEN_ENABLED (see app/api/generate-lecture/route.ts).
const BLACKBOARD_GEN_ENABLED = process.env.NEXT_PUBLIC_BLACKBOARD_GEN_ENABLED === "1";
// Renders plain DrawScript beats through Manim (pre-rendered video) instead of the live SVG
// board. Off by default: it needs the Python/ffmpeg toolchain installed on the host, and each
// beat costs several seconds of CPU the first time it is seen. Mirrors the server's
// MANIM_RENDER_ENABLED (see app/api/manim-render/route.ts) — both must be set.
const MANIM_RENDER_ENABLED = process.env.NEXT_PUBLIC_MANIM_RENDER_ENABLED === "1";
// Compatible vector morph boards use GSAP by default. Set to "0" as a client-side kill
// switch; the shared selector then sends those beats to another complete renderer.
const GSAP_RENDER_ENABLED = process.env.NEXT_PUBLIC_GSAP_RENDER_ENABLED !== "0";
// The hand-built photosynthesis demo scenes. On by default; set to "0" to let those beats
// render from their DrawScripts instead (see isCuratedPhotosynthesisBeat).
const CURATED_SCENES_ENABLED = process.env.NEXT_PUBLIC_CURATED_SCENES_ENABLED !== "0";

/**
 * The live tutor: each beat opens on a slide (sets up the idea), auto-flips into the
 * live hand-drawn board once the teacher starts talking, and — for checkpoint beats —
 * stops and waits for the student to actually answer before continuing. Real lecture
 * pacing (~5 min, 15 beats with definitions, 3 checkpoints, a comparison, and a recap),
 * not five disconnected facts.
 */
const SLIDE_MS = 1500;
// Safety net: a beat whose animation/board op never resolves (still no `code`/`ops`, e.g. a
// server that didn't generate it) would otherwise hold the lecture on its slide forever. After this
// long we stop waiting and let the lecture proceed (the board shows its status card meanwhile).
const ANIMATION_PENDING_TIMEOUT_MS = 10_000;
// Same shape of safety net, for the voice: how long a lecture may sit frozen while the tutor hook's
// React state says nobody is speaking, before we conclude its refs are lying and continue anyway.
// Long enough that a real hand-off (she stops, the turn settles, the resume lands) finishes first.
const NARRATION_STALL_MS = 6_000;
/**
 * How long the check-in talks about anything BUT the lesson before Aria may invite the learner back.
 *
 * Two minutes is long enough to actually be a conversation rather than a toll gate — the point is
 * that the learner ends up somewhere other than where they were, and thirty seconds of small talk
 * does not move anybody. It gates only when she is allowed to ASK; the lecture resumes when they
 * agree, which may be well after this.
 */
const CHECKIN_CHAT_MS = 120_000;
/**
 * How long to wait for the check-in's live session before offering the manual way out.
 *
 * The overlay is deliberately un-dismissable, so a session that never connects would otherwise be a
 * dead end with no button in it. Generous, because a first connect has to mint a token, resolve the
 * microphone and cold-load the model chunk — cutting it short would replace a real conversation
 * with a button for no reason.
 */
const CHECKIN_CONNECT_GRACE_MS = 20_000;
export const MAX_ATTEMPTS = 2; // wrong answers allowed before "show me the answer" appears
type Stage = "slide" | "board";
export type CheckpointResult = { correct: boolean; feedback: string; revealed?: boolean } | null;

const PHOTOSYNTHESIS_SCENE_IDS = new Set([
  "hook",
  "define-photosynthesis",
  "ingredients-fast",
  "chloroplast",
  "mechanism",
  "outputs",
  "compare-respiration",
  "why-it-matters",
  "recap",
]);

export function checkAnswer(beat: Beat, answer: string): CheckpointResult {
  if (!beat.checkpoint) return null;
  const lower = answer.toLowerCase();
  const matched = beat.checkpoint.acceptableKeywords.some((set) => set.every((kw) => lower.includes(kw)));
  return matched
    ? { correct: true, feedback: beat.checkpoint.correctFeedback }
    : { correct: false, feedback: beat.checkpoint.hintFeedback };
}

function findReactAnimationOp(beat: Beat) {
  return beat.draw?.ops.find((op) => op.kind === "reactAnimation");
}

function isReactAnimationPending(beat: Beat) {
  const op = findReactAnimationOp(beat);
  return Boolean(op && REACT_ANIMATIONS_ENABLED && !op.code && op.status !== "failed");
}

function findChalkBoardOp(beat: Beat) {
  return beat.draw?.ops.find((op) => op.kind === "chalkBoard");
}

function isChalkBoardPending(beat: Beat) {
  const op = findChalkBoardOp(beat);
  return Boolean(op && BLACKBOARD_GEN_ENABLED && (!op.ops || op.ops.length === 0) && op.status !== "failed");
}


export function LessonPlayer({
  onExit,
  onComplete,
  beats = demoBeats,
  title = "Photosynthesis",
  mode = "standard",
  mood = "",
  autoVoiceAssistant = true,
  adhd = false,
  /**
   * The parsed document this lecture came from, when there was one.
   *
   * Only the side chat uses it: a student asking about their own PDF mid-lesson was being answered
   * from the model's general knowledge, because the panel had no way to see the document at all.
   * Optional, so a topic-only lecture behaves exactly as before.
   */
  sourceDocument = null,
  slideContext = "",
}: {
  onExit?: () => void;
  /** Fired once, when the last beat finishes playing (natural end of lecture) — distinct from
   *  onExit, which fires on a manual exit at any point. */
  onComplete?: () => void;
  beats?: Beat[];
  title?: string;
  mode?: "standard" | "deaf";
  /** Freeform learner-mode string fed into the live tutor's session instructions. */
  mood?: string;
  /** Disable only for nested remediation players so one lesson never opens two mic sessions. */
  autoVoiceAssistant?: boolean;
  /**
   * Mounts the ADHD overlay — camera consent, score, companion, thought capture.
   *
   * ADHD deliberately renders THIS player rather than a separate one: the track changes what happens
   * around a lecture, not what the lecture looks like, and a second player also meant no Gemini Live
   * tutor. Default false, so nothing changes for any other learner.
   */
  adhd?: boolean;
  sourceDocument?: unknown;
  slideContext?: string;
}) {
  const [index, setIndex] = useState(0);
  // The ADHD layer decides the face; the header renders it. Subscribed rather than passed, because
  // the layer is a CHILD of this component and props only travel downward.
  const [face, setFace] = useState<Expression>("neutral");
  useEffect(() => (adhd ? onAdhdFace(setFace) : undefined), [adhd]);
  /**
   * What Aria says when she reacts. The ADHD layer decides the line; this renders and speaks it.
   *
   * Both channels, because neither is reliable alone: `speakAsTeacher` returns false and plays
   * nothing whenever the chatbot holds the audio channel, and audio can be muted or autoplay-
   * blocked besides — so a reaction that existed only as sound would silently not happen. The
   * bubble is the guaranteed one.
   */
  const [reproach, setReproach] = useState<string | null>(null);
  /** Checkpoints already answered, keyed by beat index, so one is never asked twice. */
  const [checkpointDone, setCheckpointDone] = useState<Record<number, boolean>>({});
  const [speaking, setSpeaking] = useState(false);
  const [stage, setStage] = useState<Stage>("slide");
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  const [checkpointResult, setCheckpointResult] = useState<CheckpointResult>(null);
  const [waitingOnCheckpoint, setWaitingOnCheckpoint] = useState(false);
  const [checkpointAttempts, setCheckpointAttempts] = useState(0);
  const [sentenceCue, setSentenceCue] = useState({ index: 0, total: 1, text: "" });
  const [captionLog, setCaptionLog] = useState<string[]>([]);
  // Bumped to (re)start narration for the current beat ONLY when there's nothing to resume in place
  // (fresh beat, or the browser-TTS fallback that can't be frozen). Pausing does NOT touch this — a
  // pause freezes the audio and a resume continues it, so the beat never replays from the top.
  const [startNonce, setStartNonce] = useState(0);
  /**
   * The beat `speakAsTeacher` REFUSED to start, so the recovery effect can retry it.
   *
   * The beat index rather than a boolean: a flag would still read true on the NEXT beat if that beat
   * never reached the narration effect (still on its slide, still waiting on an animation), and the
   * retry would fire against a beat that was never refused anything. Storing which beat it belongs to
   * makes it impossible to go stale, with no dependence on the order effects happen to run in.
   */
  const startRefusedForRef = useRef<number | null>(null);
  const [drawProgress, setDrawProgress] = useState(0);
  const [rate, setRate] = useState(1);
  const slideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beat = beats[index];

  // Start rendering every Manim beat the moment the lecture loads, not when it is reached.
  // A render takes seconds and the narration does not wait, so on-demand rendering always
  // loses the race; prefetching means the video is already cached by the time the student
  // gets there. Only plain DrawScript beats go through Manim (chalkBoard/reactAnimation
  // beats have their own renderers), and only those with something to animate — see
  // isManimWorthy. Must match the VisualDirector condition below, or a beat gets rendered
  // and never shown.
  useManimPrefetch(
    useMemo(
      () =>
        MANIM_RENDER_ENABLED
          ? beats
              .filter(
                (b) =>
                  b.draw &&
                  selectAnimationRenderer(b.draw, {
                    gsapEnabled: GSAP_RENDER_ENABLED,
                    manimEnabled: MANIM_RENDER_ENABLED,
                  }).renderer === "manim",
              )
              .map((b) => b.draw)
          : [],
      [beats],
    ),
    { enabled: MANIM_RENDER_ENABLED },
  );

  // Same reasoning as the Manim prefetch above, applied to the voice. A cold /api/tts call is 6-8s
  // for a beat-length script; the board is driven by the audio clock, so until that audio exists
  // nothing moves and the lesson looks desynchronised from the narration. Warming the next couple
  // of beats turns each of those into a ~12ms cache hit by the time the student arrives.
  useNarrationPrefetch(
    useMemo(() => beats.map((b) => b.script ?? ""), [beats]),
    index,
  );

  const isCheckpoint = beat.slideKind === "checkpoint";
  /**
   * The round for this beat, or null when its content will not support one.
   *
   * Declared beside `isCheckpoint` deliberately: it plays the same structural role — both hold the
   * beat until the learner acts, and the narration effect below needs to see both. It first lived
   * further down and had to be smuggled into that effect through a ref, which the immutability rule
   * rejected; being in scope is simpler than working around not being in scope.
   */
  /**
   * ONE question type, on a fixed cadence, always played.
   *
   * Every third beat the ADHD track stops and asks a three-option question, flown rather than typed.
   * The periodic comprehension check is suppressed for this track: two kinds of interruption asking
   * the same thing was one more than a lecture can carry.
   *
   * Drawn from a generated `checkpoint` beat at or just before this point, because that carries a
   * question written against this content. With none to be had it is null and the lecture plays on —
   * an invented question is worse than no question.
   */
  const mcq = useMemo(() => {
    if (!adhd || checkpointDone[index]) return null;
    /*
     * THE CADENCE IS THE ONLY TRIGGER — every third beat, and nothing else.
     *
     * A beat the model marked `slideKind: "checkpoint"` does NOT ask on its own: it would fire at
     * whatever index it happened to sit on, which is not "after 3 beats". Its content is still the
     * best source for the cadence question (`questionSourceFor` looks for it), which is where it
     * earns its keep — but in this track it is otherwise a beat like any other, and it must not put
     * a typed answer box on screen.
     */
    if (!checkpointDueAt(index)) return null;
    const source = questionSourceFor(index, beats);
    return source?.checkpoint ? mcqForCheckpoint(source, beats, index + 1) : null;
  }, [adhd, index, checkpointDone, beats]);

  // Read inside the narration callback, which captures its scope — same reason `lesson.modeRef`
  // exists. Synced in an effect rather than assigned during render.
  const mcqRef = useRef<ReturnType<typeof mcqForCheckpoint>>(null);
  useEffect(() => { mcqRef.current = mcq; });

  const currentAnimationPending = isReactAnimationPending(beat) || isChalkBoardPending(beat);
  // The lecture only WAITS on a pending animation until the watchdog trips (see below); after that it
  // proceeds so a never-resolving op can't freeze the whole lesson on its slide.
  const [animationTimedOut, setAnimationTimedOut] = useState(false);
  const animationBlocking = currentAnimationPending && !animationTimedOut;
  const deafMode = mode === "deaf";

  // Engagement + confusion signals (Confusion Radar / adaptive check-ins).
  const [beatQuestions, setBeatQuestions] = useState(0);
  const [driftEvents, setDriftEvents] = useState(0);
  const [lastInteractionAt, setLastInteractionAt] = useState(() => Date.now());
  const comprehensionAskedForRef = useRef(-1);
  // Focus-pause flow: null = running, "stopped" = frozen during the hold, "ready" = awaiting Resume.
  const [focusPause, setFocusPause] = useState<null | "stopped" | "ready">(null);
  const focusHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Two-way board: freehand sketch + highlighter.
  const [drawMode, setDrawMode] = useState(false);
  const [askingDrawing, setAskingDrawing] = useState(false);
  const [highlightMode, setHighlightMode] = useState(false);
  // Persistent highlighter marks for the current beat (normalized 0..1 coords) + the latest text the
  // student swept over, kept in a ref so it can be woven into the live tutor's context.
  const [highlightStrokes, setHighlightStrokes] = useState<HlStroke[]>([]);
  const highlightedTextRef = useRef("");
  const highlightCtxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [drawingContext, setDrawingContext] = useState("");
  // True briefly while an "Explain this in detail" (draw/highlight) hand-off to the live tutor is
  // in flight — used purely to drive the overlay busy indicators.
  const [engagingTutor, setEngagingTutor] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const bumpInteraction = useCallback(() => setLastInteractionAt(Date.now()), []);

  // ── Live voice tutor (full-duplex realtime) ──────────────────────────────
  // A board the realtime tutor draws via its show_board tool. Kept SEPARATE from chat.explainBoard
  // because the realtime model narrates the board itself — we must NOT run playNarration for it,
  // which would violate the single-speaker invariant.
  const [liveBoard, setLiveBoard] = useState<GeminiLiveBoard | null>(null);
  // `sessionActive` means the realtime tutor currently owns the floor. The underlying WebRTC
  // session can remain connected and privacy-muted while the scripted lecture continues.
  const [sessionActive, setSessionActive] = useState(false);

  /* ── The check-in ───────────────────────────────────────────────────────────
   * Opened by AdhdLayer when a run of skipped beats says the learner has left. The lecture freezes
   * and Aria takes the floor with a persona that has no lesson in it at all; the only way back is
   * the learner agreeing, out loud, which fires her `resume_lecture` tool.
   *
   *   null       — not in a check-in.
   *   "chatting" — the CHECKIN_CHAT_MS floor is running. `resume_lecture` is IGNORED in this phase,
   *                which is what actually enforces the two minutes: the instruction tells her not to
   *                ask yet, and this makes it true even if she asks anyway.
   *   "closing"  — she has been cued to invite them back; `resume_lecture` is now honoured.
   */
  const [checkin, setCheckin] = useState<null | "chatting" | "closing">(null);
  /**
   * Synchronous mirror, for the same reason `lesson.modeRef` exists: the realtime callbacks below
   * fire from socket events, outside React's render cycle, and reading `checkin` there would read
   * whatever the closure captured. `onSessionEnded` in particular MUST see the current value —
   * see the guard in it.
   */
  /** The beat index whose checkpoint a check-in suppressed, so it can be restored on close. */
  const checkinStoleCheckpointRef = useRef<number | null>(null);
  /** Reconnect attempts spent on the current check-in, reset when one opens. */
  const checkinReconnectsRef = useRef(0);
  const checkinRef = useRef<null | "chatting" | "closing">(null);
  useEffect(() => {
    checkinRef.current = checkin;
  }, [checkin]);
  /** The live session could not be opened at all — offer the manual way out instead of a soft-lock. */
  const [checkinFallback, setCheckinFallback] = useState(false);
  const [checkinLine, setCheckinLine] = useState<string | null>(null);
  const beatRef = useRef(beat);
  useEffect(() => {
    beatRef.current = beat;
  }, [beat]);
  /** Same reason as beatRef: the chat's context getters run long after they were registered. */
  const indexRef = useRef(index);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  /**
   * The live tutor is Gemini Live.
   *
   * This replaces useRealtimeTutor (OpenAI Realtime) rather than sitting alongside it — two live
   * voice sessions competing for the microphone and the speaker is exactly the duplication that
   * causes overlapping audio. The two hooks expose the same return surface, so this is a swap at
   * one call site, not a rewrite.
   *
   * What Gemini adds over the previous hook is model-callable lecture control: it can decide to
   * pause, to resume, and to draw, which is what makes "stop, answer, draw, carry on" work without
   * the UI having to guess at intent from transcripts.
   */
  const tutor = useGeminiLiveTutor({
    topic: title,
    getBeatContext: () =>
      `${beatRef.current.title}: ${beatRef.current.script}` +
      (highlightedTextRef.current ? `\nThe student has highlighted on the board: "${highlightedTextRef.current}"` : ""),
    mood,
    onBoardRequest: (board) => setLiveBoard(board),
    onTranscript: (role, text, final) => {
      // Finalized lines flow into the chat log so the live conversation shows up in the chat
      // panel (not a separate bottom bar). student -> "you", tutor -> "aria".
      if (!final || !text.trim()) return;
      // The overlay shows the latest line so a learner can see the mic is genuinely working. Without
      // it a silent model looks identical to a dead session, and they have no reason to keep talking.
      if (checkinRef.current) setCheckinLine(text.trim());
      chat.appendTurn(role === "student" ? "you" : "aria", text);
    },
    onSessionEnded: () => {
      setSessionActive(false);
      setLiveBoard(null);
      /*
       * A check-in OWNS the pause, so a session ending must not lift it.
       *
       * This callback exists to stop a dropped socket leaving the lecture frozen forever, which is
       * the right default everywhere else. Here it is precisely wrong: the session ending mid
       * check-in means the conversation died, not that the learner came back, and resuming would
       * hand the lecture to someone who had already stopped watching it. Fall back to the manual
       * control instead — that is the only case where the overlay offers one.
       */
      if (checkinRef.current) {
        // Unless WE closed it, to change persona — that teardown is a step in opening the check-in,
        // not the check-in failing.
        if (checkinRestartRef.current) return;

        /*
         * A DROPPED SOCKET IS NOT THE END OF THE CONVERSATION.
         *
         * Gemini Live closes sessions on its own — routinely, and more often over a real network
         * than on a developer machine. There was no reconnect at all: one close and the check-in
         * gave up, leaving the learner with a manual button and the distinct impression that Aria
         * had hung up on them. Reported as "gemini keeps getting disconnected a lot".
         *
         * So a drop reconnects, up to a few times, and only then falls back to the manual control.
         * The attempts are counted rather than unlimited: a socket that cannot stay open is a real
         * failure and the learner deserves a way out rather than a spinner that never settles.
         */
        if (checkinReconnectsRef.current >= MAX_CHECKIN_RECONNECTS) {
          setCheckinFallback(true);
          return;
        }
        checkinReconnectsRef.current += 1;
        checkinRestartRef.current = true;
        window.setTimeout(() => {
          checkinRestartRef.current = false;
          // The learner may have resumed while this was pending; do not dial into a closed check-in.
          if (!checkinRef.current) return;
          setSessionActive(true);
          tutorRef.current.setMicEnabled(true);
          void tutorRef.current.start();
        }, CHECKIN_RECONNECT_GAP_MS);
        return;
      }
      lesson.requestResume();
    },
    onStudentSpeechStarted: () => {
      setSessionActive(true);
      // During a check-in the lecture is already frozen and must stay that way; `enterChat` here
      // would arm a resume that fires the moment Aria finishes a sentence, ending the conversation
      // after her first reply.
      if (checkinRef.current) return;
      // Freeze at the exact audio position immediately, then continue from that position after
      // Gemini finishes the student's turn. If the final transcript is only a backchannel/noise,
      // onIncidentalSpeech resumes straight away instead of waiting for a model answer.
      lesson.enterChat({ resumeAfterAnswer: lesson.playing });
      if (slideTimer.current) {
        clearTimeout(slideTimer.current);
        slideTimer.current = null;
      }
    },
    onTutorTurnComplete: () => {
      if (checkinRef.current) return; // nothing is deferred during a check-in, and nothing may resume
      // Do NOT auto-mute after each answer — once the student has unmuted, the mic stays live so they
      // can keep talking (a natural back-and-forth). Auto-muting here (and reading the laggy `muted`
      // state) is what made the mic "sometimes listen, sometimes not" even while it read unmuted. The
      // session stays active through a multi-turn conversation; it ends only on a real end.
      lesson.flushDeferredResume();
    },

    /**
     * Model-driven lecture control.
     *
     * These fire when Gemini calls its `pause_lecture` / `resume_lecture` tools, which is the
     * difference between a tutor that talks over the lecture and one that takes the floor
     * properly. `enterChat` freezes narration at its current position rather than resetting it,
     * so resuming continues the same beat mid-sentence instead of restarting it.
     */
    /**
     * Speech that was not aimed at the teacher — a cough, "mm-hm", someone else in the room.
     *
     * The audio has already stopped by this point (that is unconditional, because two voices at
     * once is the worst outcome). This just puts the lecture back rather than leaving it paused
     * waiting for a turn that never comes, which is what made every stray noise feel like it
     * derailed the lesson.
     */
    onIncidentalSpeech: () => {
      if (checkinRef.current) return;
      lesson.flushDeferredResume();
    },
    onExplicitPause: () => {
      lesson.pause("user");
    },
    onExplicitResume: () => {
      // "Continue" said to a locally-classified transcript is not the agreement the check-in wants —
      // that has to come through Aria, who is the one who judged whether the learner actually meant
      // it. Ignoring it here also stops a stray "okay" in the middle of the chat ending it early.
      if (checkinRef.current) return;
      lesson.requestResume();
    },

    onPauseLecture: () => {
      if (checkinRef.current) return; // already paused, and by something that outranks her
      // Tool calls may arrive after speech-start already armed the question's automatic resume.
      // Preserve that intent; a locally classified direct pause command cancels it above.
      lesson.enterChat({ preserveResumeIntent: true });
      if (slideTimer.current) {
        clearTimeout(slideTimer.current);
        slideTimer.current = null;
      }
    },
    /**
     * The learner said yes — and that is always enough.
     *
     * This used to be REFUSED during the first two minutes: the floor was enforced here in code, so
     * a learner who said "resume the lecture" thirty seconds in was ignored, and Aria carried on
     * chatting at someone who had already asked to leave. Reported as exactly that, and it is the
     * wrong trade. The floor exists to stop ARIA cutting the conversation short, not to hold a
     * student in one against their will.
     *
     * So the two minutes now govern only when Aria may INVITE them back (the cue timer below).
     * Asking to go, at any moment, works immediately.
     */
    onResumeLecture: () => {
      if (checkinRef.current) {
        endCheckin();
        return;
      }
      lesson.requestResume();
    },
    lectureControlTools: true,
    checkinMode: checkin !== null,

    startMuted: true,
    alwaysOn: autoVoiceAssistant,
  });
  // Mirrors `tutor` so a setTimeout-based poll (explainWithTutor) can read the LATEST status
  // instead of the stale one captured in whichever render kicked the poll off.
  const tutorRef = useRef(tutor);
  useEffect(() => {
    tutorRef.current = tutor;
  });

  // ── Single-speaker voice pipeline ────────────────────────────────────────
  // The director is the only owner of the teacher's voice vs. the realtime tutor's voice; the
  // lesson machine is the single "should the teacher be talking right now?" state, built on it.
  const voice = useVoiceDirector({ tutorSpeaking: tutor.speaking, isChatbotSpeakingNow: tutor.isSpeaking });

  /*
   * Read `voice` through a ref, and depend only on `adhd`.
   *
   * `useVoiceDirector` returns a fresh object every render, so listing it as a dependency tore the
   * subscription down and rebuilt it on every single render — dozens of times a second during
   * narration, with a window on each rebuild where a published line lands on nobody.
   * `onAdhdSpeech` does not replay its last value, so anything published in that window is lost.
   */
  const voiceRef = useRef<VoiceDirector | null>(null);
  // Synced in an effect, not assigned during render — the same latest-value-ref shape AdhdLayer
  // uses, because assigning during render is impure and ESLint rejects it.
  useEffect(() => {
    voiceRef.current = voice;
  });
  useEffect(() => {
    if (!adhd) return;
    return onAdhdSpeech((line) => {
      setReproach(line);
      // "utterance", not "lecture": the same slot quiz verdicts use, so it never destroys a frozen
      // lecture. A refusal is fine and expected — the bubble already carried the message.
      //
      // Silent during a check-in. The skip run that publishes this line is the SAME run that opens
      // the check-in, so without the guard the teacher's reproach is spoken straight over Aria's
      // opening greeting — two voices, and the wrong one is scolding.
      if (line && !checkinRef.current) {
        voiceRef.current?.speakAsTeacher(
          line,
          { onStart: () => {}, onEnd: () => {}, onBlocked: () => {} },
          "utterance",
        );
      }
    });
  }, [adhd]);
  const lesson = useLessonMachine(voice);

  const stopVoice = useCallback(() => {
    voice.stopTeacher();
    setSpeaking(false);
  }, [voice]);

  // Live engagement rate — behavioural signals always count; the camera (if ever wired in) would
  // only sharpen it. Below 50 the teacher asks a quick comprehension check; below 30 the lecture
  // pauses outright via the focus-pause overlay.
  const engagement = useEngagementScore({
    cameraActive: false,
    driftEvents,
    questionsAsked: beatQuestions,
    checkpointAttempts,
    lastInteractionAt,
    active: lesson.playing,
  });

  // The teacher's own mid-lecture comprehension check — asked in her voice via the director, mic
  // muted for the exchange so the realtime tutor can't overhear and answer for the student.
  const quiz = useTeacherQuiz({
    voice,
    setMicEnabled: tutor.setMicEnabled,
    rate,
    onPassed: () => {
      // A check-in owns the pause; nothing about the lesson may move it. See beginCheckin.
      if (checkinRef.current) return;
      bumpInteraction();
      // Scored by the ADHD layer if one is mounted; a no-op otherwise.
      emitAdhdEvent({ type: "answer-correct" });
      lesson.requestResume();
    },
    onFailed: () => {
      // A check-in owns the pause; nothing about the lesson may move it. See beginCheckin.
      if (checkinRef.current) return;
      bumpInteraction();
      // Costs nothing — it only withholds the all-correct bonus. Charging for wrong answers is how
      // a learner concludes the safe move is to stop answering.
      emitAdhdEvent({ type: "answer-wrong" });
      /*
       * A MISSED ANSWER CARRIES ON. It used to `pause("wrong-answer")`, and nothing in the app ever
       * read that reason — the re-explanation it was named for was never built. So the lecture
       * stopped dead with no prompt and no stated way back, which is indistinguishable from the
       * freeze bug this file has been chasing. Aria has just spoken the correction; that is the
       * teaching moment, and the lesson continues past it.
       */
      lesson.requestResume();
    },
  });

  // Shared side-chat. Asking a question pauses the lecture (through the lesson machine, same
  // mechanism a voice interruption uses, so a chat question now pauses/resumes in place instead
  // of restarting the beat); closing the explanation requests a resume.
  const chat = useLessonChat({
    topic: title,
    getBeatContext: () => `${beat.title}: ${beat.script}`,
    // Read at ask time, not captured: the lecture moves while the panel is open.
    getLessonContext: () => buildLessonContext(beats, indexRef.current),
    getDocumentContext: () => buildDocumentContext(sourceDocument, slideContext),
    pausePlayer: () => {
      // Hard stop during a check-in. This is the path behind "Aria talks about the lesson": ask()
      // speaks its answer through playNarration directly (LessonChat.tsx), bypassing the voice
      // director entirely, so it lands ON TOP of her live audio and nothing can mute it afterwards.
      if (checkinRef.current) return;
      bumpInteraction();
      setBeatQuestions((n) => n + 1);
      lesson.enterChat({ resumeAfterAnswer: true });
    },
    onVoiceBlocked: () => setVoiceBlocked(true),
  });

  // Short label for the chat mic button while a live session is active/connecting.
  const liveMicLabel =
    tutor.status === "connecting"
      ? "Connecting…"
      : tutor.status === "drawing"
        ? "Drawing…"
        : tutor.speaking
          ? "Aria speaking…"
          : sessionActive
            ? "Listening — tap to end"
            : "";

  function startLiveTutor() {
    // The check-in owns the session; taking the floor from it would drop the lecture out of paused.
    if (checkinRef.current) return;
    // The session is normally preconnected and muted. Taking the floor pauses the existing beat,
    // preserving its timestamp so it can continue exactly after the tutor's response.
    lesson.enterChat();
    if (slideTimer.current) {
      clearTimeout(slideTimer.current);
      slideTimer.current = null;
    }
    setSessionActive(true);
    // This is deliberately before `start()`: while token/permission/socket setup is in flight there
    // is no MediaStreamTrack yet, so the hook queues this intent and applies it when the track lands.
    tutor.setMicEnabled(true);
    if (tutor.status === "idle" || tutor.status === "error" || tutor.status === "mic-denied") {
      void tutor.start();
    }
  }
  function endLiveTutor() {
    /*
     * THE BUG THIS GUARD FIXES. During a check-in `sessionActive` is true, so the ChatPanel mic
     * button resolves here — and this function's whole job is to end the call and resume. It did
     * exactly that: the lecture restarted and narrated on while the overlay still read "the
     * lecture's paused", because `checkin` was never cleared. A check-in ends by agreement, not by
     * hanging up.
     */
    if (checkinRef.current) return;
    tutor.stop(); // onSessionEnded resumes the lecture in the normal case
    // Safety net: if the realtime session errored out earlier and its internal teardown guard
    // already fired once (silently, e.g. on a dropped connection), tutor.stop() here is a no-op
    // and onSessionEnded never re-fires — leaving the lecture paused forever. Force the same
    // resume state directly so pressing "end call" always works, even in that edge case.
    setSessionActive(false);
    setLiveBoard(null);
    lesson.requestResume();
  }

  /* ── The check-in ───────────────────────────────────────────────────────────
   * Opened by a run of skipped beats. The lecture freezes, Aria arrives with a persona that has no
   * lesson in it, and the way back is the learner agreeing out loud.
   */

  /** True across a DELIBERATE persona reconnect, so its `onSessionEnded` is not read as a failure. */
  const checkinRestartRef = useRef(false);
  const prevCheckinRef = useRef<null | "chatting" | "closing">(null);

  function beginCheckin() {
    if (checkinRef.current) return;
    /*
     * setSpeaking, NOT stopVoice — and the difference is the whole "it replays from the start" bug.
     *
     * stopVoice is voice.stopTeacher(), which CANCELS the narration and nulls the handle. The
     * lesson.pause("checkin") below then calls pauseTeacher() to FREEZE that handle and finds
     * nothing left to freeze, so on the way back resumeTeacher() returns false and the mode effect
     * bumps startNonce — restarting the beat from its first sentence instead of continuing.
     *
     * pause() already does the right pair (stopUtterance + pauseTeacher), so calling stopVoice
     * first was not redundant, it was destructive. All that is left to do here is stop the avatar
     * mouthing along.
     */
    setSpeaking(false);
    if (slideTimer.current) {
      clearTimeout(slideTimer.current);
      slideTimer.current = null;
    }
    // Clear every other thing that could be holding the board. A check-in outranks all of them: they
    // are all about the lesson, and the premise here is that the lesson is not what is needed.
    quiz.cancel();
    /*
     * The checkpoint has to GO, not merely be covered.
     *
     * MazeGame binds its arrow keys to `window` (components/adhd/games/MazeGame.tsx), so it keeps
     * playing underneath any overlay however high its z-index — a window listener is not a pointer
     * target. Reaching an answer cell fires onDone -> requestResume and ends the check-in silently,
     * with nothing on screen to explain why. Marking the beat done stops it re-arming on the next
     * render.
     */
    /*
     * Suppress this beat's checkpoint FOR THE CHECK-IN, and give it back afterwards.
     *
     * MazeGame binds its arrow keys to `window`, so it keeps playing underneath any overlay however
     * high the z-index — reaching an answer cell would end the check-in silently with nothing on
     * screen explaining why. Marking the beat done is what stops that.
     *
     * But three consecutive skips is exactly the cadence that lands on a maze beat, so marking it
     * done permanently meant the assessment the learner skipped INTO never appeared at all. It is
     * remembered here and restored when the check-in closes: the conversation happens, then the
     * question they were due still gets asked.
     */
    checkinStoleCheckpointRef.current = checkpointDone[index] ? null : index;
    setCheckpointDone((d) => ({ ...d, [index]: true }));
    setFocusPause(null);
    setLiveBoard(null);
    setCheckinLine(null);
    setCheckinFallback(false);
    // Written synchronously as well as through state: a socket callback can fire before React has
    // committed, and every guard below reads the ref.
    checkinReconnectsRef.current = 0;
    checkinRef.current = "chatting";
    setCheckin("chatting");
    lesson.pause("checkin");
  }

  function endCheckin() {
    if (!checkinRef.current) return;
    // Cleared BEFORE requestResume, and that order is load-bearing. `requestResume` defers while the
    // model's last audio drains, and the deferred request is released by `onTutorTurnComplete` —
    // which returns early while a check-in is open. Clearing after would strand the lecture paused.
    checkinRef.current = null;
    setCheckin(null);
    setCheckinLine(null);
    setCheckinFallback(false);
    publishAdhdCheckin(false);
    emitAdhdEvent({ type: "checkin-cleared" });

    // Hand the checkpoint back, if the check-in was what took it away.
    const stolen = checkinStoleCheckpointRef.current;
    checkinStoleCheckpointRef.current = null;
    if (stolen !== null) {
      setCheckpointDone((d) => {
        const next = { ...d };
        delete next[stolen];
        return next;
      });
    }

    lesson.requestResume();
  }

  useEffect(() => {
    if (!adhd) return;
    return onAdhdCheckin((active) => {
      if (active) beginCheckin();
    });
    // `beginCheckin` closes over state setters and refs only, all stable for this purpose; adding it
    // would re-subscribe on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adhd]);

  /**
   * A persona change is a RECONNECT, not a flag flip.
   *
   * The system instruction is fixed for the life of a Live socket, so becoming the check-in
   * companion — and becoming the tutor again afterwards — means tearing the session down and
   * dialling again. Driven from an effect rather than from `beginCheckin` so that `checkinMode` has
   * already reached the hook's options ref by the time `start()` reads it.
   */
  useEffect(() => {
    const prev = prevCheckinRef.current;
    prevCheckinRef.current = checkin;
    const wasIn = prev !== null;
    const isIn = checkin !== null;
    // "chatting" -> "closing" is the SAME conversation. Reconnecting there would throw away
    // everything the learner had just said, at the exact moment she is meant to refer back to it.
    if (wasIn === isIn) return;
    if (!REALTIME_TUTOR_ENABLED) {
      // Deferred, like the checkpoint pause below: setState synchronously in an effect body cascades
      // renders. There is no live session to be had here at all, so the check-in is manual from the
      // moment it opens.
      if (isIn) queueMicrotask(() => setCheckinFallback(true));
      return;
    }

    checkinRestartRef.current = true;
    tutorRef.current.stop();
    /*
     * A real gap, not one tick.
     *
     * `stop()` clears the refs synchronously, so `start()` will not refuse — but the socket it just
     * asked to close is still closing, and dialling a second session into the same audio context
     * while the first unwinds is what made the check-in look like a disconnect in production. Zero
     * milliseconds was enough locally, where teardown and the network are both instant, and is not
     * enough over a real connection.
     *
     * The hook now also invalidates any in-flight connect (see connectAttemptRef), so this delay is
     * belt and braces rather than the only thing holding the sequence together.
     */
    const id = setTimeout(() => {
      checkinRestartRef.current = false;
      const t = tutorRef.current;
      if (isIn) {
        setSessionActive(true);
        // Unmuted, because a conversation the learner has to find a button to join is not one.
        t.setMicEnabled(true);
        void t.start();
      } else {
        setSessionActive(false);
        t.setMicEnabled(false);
        // Back to the ordinary preconnected-and-muted lecture session.
        if (autoVoiceAssistant) void t.start();
      }
    }, CHECKIN_RECONNECT_GAP_MS);
    return () => clearTimeout(id);
  }, [checkin, autoVoiceAssistant]);

  /**
   * The two-minute floor.
   *
   * Only gates when Aria may ASK. She is cued through `say` and not `addContext`, because
   * `addContext` explicitly instructs the model not to reply — and a silent cue to start talking is
   * no cue at all.
   */
  useEffect(() => {
    if (checkin !== "chatting" || checkinFallback) return;
    const id = setTimeout(() => {
      checkinRef.current = "closing";
      setCheckin("closing");
      tutorRef.current.say(CHECKIN_INVITE_CUE);
    }, CHECKIN_CHAT_MS);
    return () => clearTimeout(id);
  }, [checkin, checkinFallback]);

  /**
   * The soft lock needs an escape hatch for the case where the conversation cannot happen at all.
   *
   * Without this, a missing API key or a refused microphone leaves an overlay whose only exit is a
   * live session that will never connect — the lesson bricked behind a rationale. The grace period
   * covers a slow connect; the status check covers an outright failure.
   */
  useEffect(() => {
    if (!checkin || checkinFallback) return;
    if (tutor.status === "error" || tutor.status === "mic-denied" || tutor.status === "blocked") {
      queueMicrotask(() => setCheckinFallback(true));
      return;
    }
    if (tutor.status === "live" || tutor.status === "drawing") return;
    const id = setTimeout(() => setCheckinFallback(true), CHECKIN_CONNECT_GRACE_MS);
    return () => clearTimeout(id);
  }, [checkin, checkinFallback, tutor.status]);

  /**
   * THE INVARIANT: while a check-in is open, the lecture is paused. Full stop.
   *
   * Every guard above closes a door I found. This closes the ones I did not, and the ones added
   * later — an audit of this file turned up eleven unguarded ways back into `teaching`, which is
   * eleven chances to be wrong once and a certainty of being wrong eventually. Rather than trust
   * that the list is complete, anything that un-pauses gets corrected on the next render.
   *
   * Keyed on `checkin`, deliberately NOT on `lesson.pauseReason`. The mcq effect below lists
   * `[mcq, stopVoice, lesson]` as dependencies and both `lesson` and `voice` are fresh object
   * literals every render, so while a checkpoint exists it re-runs constantly and overwrites the
   * reason from "checkin" to "focus". A guard reading the reason would look right and do nothing.
   */
  useEffect(() => {
    if (!checkin || !lesson.playing) return;
    // Deferred like the checkpoint pause below: stopVoice sets state, and setState synchronously in
    // an effect body cascades renders.
    queueMicrotask(() => {
      if (!checkinRef.current) return;
      // Same reason as beginCheckin: stopVoice here would discard the frozen lecture on every
      // correction, so a check-in that had to re-assert itself even once could no longer resume
      // in place.
      setSpeaking(false);
      lesson.pause("checkin");
    });
  }, [checkin, lesson.playing, stopVoice, lesson]);

  // Watchdog: reset the timed-out flag on every new beat, then — while this beat's animation/board op
  // is still pending and the lecture is playing — start a timer. If it fires, stop waiting so the
  // lecture can move on instead of freezing on the slide forever (a never-filled op, a server that
  // didn't generate it, etc.). A ready op is never pending, so this never delays a normal beat.
  useEffect(() => setAnimationTimedOut(false), [beat.id]);
  useEffect(() => {
    if (!currentAnimationPending || !lesson.playing || animationTimedOut) return;
    const t = setTimeout(() => setAnimationTimedOut(true), ANIMATION_PENDING_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [currentAnimationPending, lesson.playing, animationTimedOut, beat.id]);

  // Drives each beat: show its slide briefly, then (for normal beats) flip to the board
  // and narrate; on voice end, advance. Checkpoint beats narrate the question on the slide
  // itself and then STOP — they wait for submitCheckpoint() instead of auto-advancing.
  // Effect 1: while a beat is on its intro slide, count down then flip to "board" (skipped
  // for checkpoints, which narrate right on the slide). This effect ONLY sets `stage` — it
  // never starts narration itself, so it can't race with the narration effect's cleanup.
  useEffect(() => {
    if (!lesson.playing || stage !== "slide" || isCheckpoint || animationBlocking) return;
    if (slideTimer.current) clearTimeout(slideTimer.current);
    slideTimer.current = setTimeout(() => setStage("board"), SLIDE_MS);
    return () => {
      if (slideTimer.current) clearTimeout(slideTimer.current);
    };
  }, [index, lesson.playing, stage, isCheckpoint, animationBlocking]);

  // Effect 2: start narration exactly once per (beat, stage) — when a checkpoint's slide
  // appears, or once a normal beat reaches "board". Separate from effect 1 so flipping
  // `stage` here doesn't retrigger effect 1 and cancel narration mid-start. Narration now goes
  // through the voice director (single audio owner) instead of calling playNarration directly.
  useEffect(() => {
    // NOTE: gated on the LIVE mode ref, NOT the reactive `lesson.playing`. If `lesson.playing` were a
    // dependency, pausing would re-run this effect's cleanup and CANCEL the narration, so resuming
    // replayed the beat from the top. Pause/resume is handled by the mode effect below, which freezes
    // and continues the SAME audio in place. This effect only (re)starts a beat fresh.
    if (lesson.modeRef.current !== "teaching" || chat.busy) return;
    const narrateOnBoard = !isCheckpoint && stage === "board";
    const narrateOnCheckpointSlide = isCheckpoint && stage === "slide";
    if (!narrateOnBoard && !narrateOnCheckpointSlide) return;
    if (narrateOnBoard && animationBlocking) return;
    window.setTimeout(() => setDrawProgress(0), 0);
    const started = voice.speakAsTeacher(
      beat.script,
      {
        onStart: () => setSpeaking(true),
        onSentenceStart: (sentenceIndex, sentence, total) => {
          setSentenceCue({ index: sentenceIndex, text: sentence, total });
          if (deafMode) {
            const caption = sentence.trim();
            setCaptionLog((lines) => {
              if (!caption || lines[lines.length - 1] === caption) return lines;
              return [...lines, caption].slice(-9);
            });
          }
        },
        // The media element's clock is the source of truth for board progress. This keeps the
        // live marker, generated SVG progress, and beat advancement pinned to the actual voice.
        onProgress: (progress) => setDrawProgress(Math.max(0, progress)),
        onEnd: () => {
          setSpeaking(false);
          // If playback was paused between the last cue and this onEnd firing, do NOT advance —
          // freeze on the current beat. Read the LIVE mode (not the captured `lesson.playing`).
          if (lesson.modeRef.current !== "teaching") return;
          setDrawProgress(1);
          // A pending question holds the beat the way a checkpoint does: the learner's answer
          // advances it, not the end of the narration.
          if (mcqRef.current) return;
          /*
           * A checkpoint beat must not HOLD in the ADHD track.
           *
           * Its answer box is suppressed there, so waiting for an answer waits for one that can
           * never be given — the lecture stopped dead on that beat and the browser suite sat at
           * "Part 3 of 8" for six minutes. Removing the question without removing the wait for it
           * is worse than leaving both.
           */
          if (isCheckpoint && !adhd) {
            setWaitingOnCheckpoint(true);
          } else {
            setIndex((i) => {
              if (i < beats.length - 1) return i + 1;
              onComplete?.();
              return i;
            });
            setStage("slide");
          }
        },
        onBlocked: () => setVoiceBlocked(true),
        rate,
      },
      "lecture"
    );
    /*
     * A REFUSAL IS NOT A DEAD END.
     *
     * `speakAsTeacher` plays nothing while the chatbot holds the channel, and this used to simply
     * return — so a beat that happened to reach the board under her voice never narrated at all, and
     * nothing retried when she went quiet. The recovery effect below picks this up.
     */
    if (!started) {
      startRefusedForRef.current = index;
      return;
    }
    startRefusedForRef.current = null;

    return () => {
      voice.stopTeacher();
      setSpeaking(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, startNonce, stage, isCheckpoint, adhd, beat.script, rate, beats.length, chat.busy, deafMode, onComplete, animationBlocking]);

  // Pause/resume IN PLACE, driven by the single mode value. Leaving `teaching` freezes the audio
  // (and with it the board reveal + sentence cue); returning to it continues from the exact same
  // spot — the pause button and "resume the lecture" both land here. When there is nothing to resume
  // (a fresh beat, or the browser-TTS fallback), `startNonce` starts the beat instead.
  useEffect(() => {
    if (lesson.mode === "teaching") {
      if (!voice.resumeTeacher()) setStartNonce((n) => n + 1);
    } else {
      voice.pauseTeacher();
      setSpeaking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.mode]);

  /**
   * THE LECTURE IS SUPPOSED TO BE AUDIBLE, AND IS NOT.
   *
   * The effect above is the ONLY thing that ever continued frozen narration, and it is keyed on a
   * mode CHANGE. But three things freeze the lecture without the lesson leaving `teaching` — the
   * chatbot taking the channel, a comprehension question, a reproach line — and every path back was
   * `lesson.requestResume()`, whose `go("teaching")` from `teaching` sets state React already holds.
   * React bails out, `lesson.mode` never changes, that effect never re-runs, and the audio stays
   * frozen forever. That is the reported "stops at the whiteboard until I pause and resume": pause
   * then resume is two REAL transitions, which is why it, and only it, un-stuck the lecture.
   *
   * So the invariant is asserted here rather than trusted to each caller. The deps are the signals
   * that a hold actually ended: the director's wrapped onEnd clears the utterance and releases the
   * channel (`owner` -> "none"), and Gemini's teardown sets `speaking` false and `status` to
   * "error" — the dropped-socket case.
   */
  useEffect(() => {
    const action = narrationRecovery({
      mode: lesson.mode,
      chatbotHoldsChannel: voice.owner === "chatbot" || voice.isChatbotSpeaking(),
      utteranceInFlight: voice.hasPendingUtterance(),
      lectureFrozen: voice.hasFrozenTeacher(),
      startRefused: startRefusedForRef.current === index,
    });
    if (action === "resume") {
      voice.resumeTeacher();
    } else if (action === "restart") {
      startRefusedForRef.current = null;
      setStartNonce((n) => n + 1);
    }
    // `quiz.phase` is in here for a reason that is easy to delete by accident: cancelling an
    // utterance (skipping the question) calls the handle's `cancel()`, which never fires `onEnd`, so
    // the director never releases the channel and `voice.owner` does NOT change. The phase going
    // back to "idle" is the only observable signal that the question is over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.mode, voice.owner, tutor.speaking, tutor.status, quiz.phase, index, stage, startNonce]);

  /**
   * The backstop, for the stall no render announces.
   *
   * `isChatbotSpeaking()` reads live refs inside the tutor hook. If one of those is left set — a
   * response abandoned mid-flight, a board chain that never settled — the recovery above keeps
   * correctly bowing out and the lecture stays frozen with nothing to fix it. The cross-check is the
   * point: the refs say she holds the channel, React state says she is silent, and several seconds
   * have passed. Then the refs are wrong.
   *
   * It only ever RESUMES — never restarts a beat — so the worst case is a no-op and it cannot loop.
   */
  useEffect(() => {
    if (lesson.mode !== "teaching" || tutor.speaking) return;
    if (!voice.hasFrozenTeacher() || voice.hasPendingUtterance()) return;
    const t = setTimeout(() => voice.resumeTeacher(), NARRATION_STALL_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.mode, voice.owner, tutor.speaking, tutor.status, quiz.phase, index, stage, startNonce]);

  // Focus/engagement bands: below 30 the lecture pauses outright (focus-pause overlay, manual
  // resume only); 30-50 the TEACHER stops and asks a quick comprehension question instead of
  // stalling the lesson. Both require the drop to be sustained (engagement.critical/.low already
  // latch only after a hold), and a short extra DRIFT/FOCUS hold here avoids reacting to a blip.
  useEffect(() => {
    if (!lesson.playing) {
      if (focusHoldTimer.current) {
        clearTimeout(focusHoldTimer.current);
        focusHoldTimer.current = null;
      }
      return;
    }
    if (!engagement.critical || focusPause) return;
    focusHoldTimer.current = setTimeout(() => {
      stopVoice();
      lesson.pause("focus");
      setFocusPause("stopped");
      setTimeout(() => setFocusPause("ready"), FOCUS_HOLD_MS);
    }, DRIFT_HOLD_MS);
    return () => {
      if (focusHoldTimer.current) {
        clearTimeout(focusHoldTimer.current);
        focusHoldTimer.current = null;
      }
    };
  }, [engagement.critical, lesson.playing, focusPause, stopVoice, lesson]);

  function resumeFromFocusPause() {
    setFocusPause(null);
    bumpInteraction();
    lesson.requestResume();
  }

  // Comprehension check: fires once per beat when engagement is in the 30-50 band, or on a
  // periodic cadence regardless of engagement — a real teacher checks in occasionally even when
  // things seem fine, not only when a student looks lost. Tracked via a ref keyed by beat index
  // (never rendered) rather than boolean state, so no reset-on-beat-change effect is needed.
  useEffect(() => {
    if (!lesson.playing || comprehensionAskedForRef.current === index || isCheckpoint || waitingOnCheckpoint) return;
    /*
     * The ADHD track asks ONE kind of question: the flown checkpoint every third beat. Standard mode
     * keeps this check exactly as it was — non-ADHD has seen no change throughout this work.
     */
    if (adhd) return;
    const dueToEngagement = engagement.low && !engagement.critical;
    const dueToPeriod = index > 0 && index % UNDERSTANDING_CHECK_EVERY === 0 && stage === "board" && !speaking;
    if (!dueToEngagement && !dueToPeriod) return;
    comprehensionAskedForRef.current = index;
    quiz.ask({
      kind: dueToEngagement ? "understanding" : "comprehension",
      question: `Quick check — in your own words, what's the main idea of "${beat.title}" so far?`,
      expected: beat.script,
    });
  }, [lesson.playing, isCheckpoint, waitingOnCheckpoint, engagement.low, engagement.critical, index, stage, speaking, quiz, adhd, beat.title, beat.script]);

  /**
   * Aria goes quiet for the question.
   *
   * A checkpoint is the one moment the learner is being asked to produce something themselves, and
   * being talked at while doing it is the opposite of a check. `stopVoice` also clears `speaking`,
   * so the avatar stops mouthing along too.
   */
  useEffect(() => {
    if (!mcq) return;
    // Deferred: `stopVoice` sets `speaking`, and setState synchronously in an effect body cascades
    // renders — the same rule that shaped AdhdLayer's single timer and the R3F frame loop.
    queueMicrotask(() => {
      stopVoice();
      lesson.pause("focus");
    });
  }, [mcq, stopVoice, lesson]);

  function advanceFromCheckpoint() {
    // Cleared here as well as in goTo/restart: without it the flag stayed true for the rest of the
    // lecture once a single checkpoint was answered, which permanently early-returned the periodic
    // comprehension check below and pinned the header to "waiting on you".
    setWaitingOnCheckpoint(false);
    setCheckpointResult(null);
    setCheckpointAttempts(0);
    setSentenceCue({ index: 0, total: 1, text: "" });
    setDrawProgress(0);
    setIndex((i) => {
      if (i < beats.length - 1) return i + 1;
      onComplete?.();
      return i;
    });
    setStage("slide");
  }

  // A checkpoint is REAL now: a wrong answer shows a hint and lets the student try again —
  // it does not advance the lecture. Only a correct answer (or explicitly giving up after
  // MAX_ATTEMPTS) moves on. This is the actual difference between a teaching checkpoint and
  // a quiz popup that continues regardless of what you typed.
  /**
   * Grade a checkpoint answer on MEANING, not wording.
   *
   * The keyword check runs first because it is instant and free: when a student's answer happens to
   * contain the expected terms, there is nothing to deliberate about. But it can only ever say
   * "yes" — a student who writes "the plant makes sugar" when the keyword is "glucose" is right,
   * and substring matching calls that wrong. Marking a correct answer wrong is the single most
   * damaging thing a tutor can do, so every keyword MISS is escalated to the rubric grader that
   * already exists at /api/grade-answer and was never wired up.
   *
   * If the grader is unavailable the keyword verdict stands, so a network failure degrades to the
   * old behaviour instead of blocking the lesson.
   */
  async function handleCheckpointAnswer(answer: string) {
    const keywordResult = checkAnswer(beat, answer);
    if (keywordResult?.correct) {
      setCheckpointResult(keywordResult);
      window.setTimeout(advanceFromCheckpoint, 2200);
      return;
    }

    setCheckpointResult({ correct: false, feedback: "Checking that…" });
    try {
      const res = await fetch("/api/grade-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: beat.checkpoint?.prompt ?? beat.title,
          expected: beat.checkpoint?.revealAnswer ?? "",
          answer,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.correct === "boolean") {
        setCheckpointResult({
          correct: data.correct,
          feedback: data.feedback || (data.correct ? beat.checkpoint?.correctFeedback ?? "That's right." : beat.checkpoint?.hintFeedback ?? ""),
        });
        if (data.correct) {
          window.setTimeout(advanceFromCheckpoint, 2200);
          return;
        }
        setCheckpointAttempts((n) => n + 1);
        return;
      }
      throw new Error("grader unavailable");
    } catch {
      setCheckpointResult(keywordResult);
      setCheckpointAttempts((n) => n + 1);
    }
  }

  function revealCheckpointAnswer() {
    if (!beat.checkpoint) return;
    setCheckpointResult({ correct: true, feedback: beat.checkpoint.revealAnswer, revealed: true });
    window.setTimeout(advanceFromCheckpoint, 2800);
  }

  /**
   * Feed the highlighted text into the LIVE tutor's context, debounced so a multi-line sweep sends
   * one clean message instead of one per fragment. This is what lets the student HIGHLIGHT and then
   * simply ASK Aria by voice — she already has the exact words in context (getBeatContext only counts
   * at session start, so the running session needs this addContext push).
   */
  const pushHighlightContext = useCallback(
    (text: string) => {
      highlightedTextRef.current = text;
      if (highlightCtxTimer.current) clearTimeout(highlightCtxTimer.current);
      const t = text.trim();
      if (!t) return;
      highlightCtxTimer.current = setTimeout(() => {
        tutor.addContext(
          `The student highlighted this on the board: "${t}". If they ask about it, explain THAT specifically, in detail.`,
        );
      }, 400);
    },
    [tutor],
  );

  // New section (board content changes) -> old highlights no longer map to it. Clear them.
  useEffect(() => {
    setHighlightStrokes([]);
    highlightedTextRef.current = "";
  }, [beat.id]);

  /**
   * Bring the live conversational tutor in to actually engage with something the student drew or
   * highlighted — not a fresh scripted board, just Aria talking about exactly this, the same voice
   * that's already teaching. Pauses the lecture, makes sure the tutor session is connected and
   * listening (same connect logic as the "Talk to tutor" button), gives her the context, and
   * prompts her to respond right away instead of silently waiting for the student to ask by voice.
   */
  function explainWithTutor(prompt: string) {
    // Feeds lecture content into the session and calls say() with it — the one thing a check-in
    // must not carry.
    if (checkinRef.current) return;
    bumpInteraction();
    lesson.enterChat({ resumeAfterAnswer: true });
    if (slideTimer.current) {
      clearTimeout(slideTimer.current);
      slideTimer.current = null;
    }
    setSessionActive(true);
    setEngagingTutor(true);
    tutor.setMicEnabled(true);
    // say() silently no-ops until the WebRTC data channel is actually open, which lags a moment
    // behind start() resolving — retry briefly (reading tutorRef, not the closed-over `tutor` from
    // this render, since status keeps changing across renders while we wait) rather than dropping
    // the very first ask on the floor.
    const sayWhenReady = (attempt = 0) => {
      const current = tutorRef.current;
      if (current.status === "live" || attempt > 20) {
        current.say(prompt);
        setEngagingTutor(false);
        return;
      }
      window.setTimeout(() => sayWhenReady(attempt + 1), 150);
    };
    if (tutor.status === "idle" || tutor.status === "error" || tutor.status === "mic-denied") {
      void tutor.start().then(() => sayWhenReady());
      return;
    }
    sayWhenReady();
  }

  /** "Explain this in detail" on a drawing — reliable regardless of mic state, and engages the
   *  same live tutor voice instead of opening a separate scripted explanation board. */
  function explainDrawing() {
    const description = drawingContext && drawingContext !== "NOTHING" ? drawingContext : "";
    explainWithTutor(
      description
        ? `The student just drew this on the board and wants you to explain it in detail: ${description}`
        : "The student just drew something on the board and wants you to explain it in detail — look at what's there and talk them through it."
    );
  }

  function startLesson() {
    unlockAudio(); // must run inside this click handler — that's what satisfies the autoplay gate
    setVoiceBlocked(false);
    lesson.startTeaching();
    if (REALTIME_TUTOR_ENABLED && autoVoiceAssistant && tutor.status === "idle") {
      // The click is a browser permission gesture: initialize once, keep the outgoing track muted,
      // and leave the lecture playing until the learner explicitly unmutes or starts a conversation.
      void tutor.start();
    }
  }
  function togglePlay() {
    if (lesson.playing) {
      /*
       * Pausing halts the audio and the sentence-cue timeline at once, and cancels the slide→board
       * timer so the beat can't flip stage while paused.
       *
       * It does NOT call stopVoice. That cancels the narration outright, and pause() immediately
       * after can then find nothing to freeze — so pressing Pause and then Resume replayed the part
       * from its first sentence rather than continuing. pauseTeacher() (inside pause) already stops
       * the audio, by freezing it, which is the point.
       */
      setSpeaking(false);
      if (slideTimer.current) {
        clearTimeout(slideTimer.current);
        slideTimer.current = null;
      }
      lesson.pause("user");
    } else {
      unlockAudio();
      lesson.requestResume();
    }
  }
  function retryVoice() {
    unlockAudio();
    setVoiceBlocked(false);
    // `startTeaching` is a full un-pause. The banner that calls this renders outside the board and
    // outside the inert transport row, so before the overlay was hoisted it was reachable mid-check-in.
    if (checkinRef.current) return;
    setStage("slide");
    lesson.startTeaching();
  }
  function goTo(i: number) {
    stopVoice();
    // Leaving the beat must also abandon any question asked ON it. Without this, skipping
    // forward mid-question left the quiz card on screen (and the teacher still asking it)
    // over the next beat's board.
    quiz.cancel();
    if (slideTimer.current) clearTimeout(slideTimer.current);
    setWaitingOnCheckpoint(false);
    setCheckpointResult(null);
    setCheckpointAttempts(0);
    setSentenceCue({ index: 0, total: 1, text: "" });
    setDrawProgress(0);
    if (deafMode) setCaptionLog([]);
    setIndex(i);
    setStage("slide");
    lesson.startTeaching();
  }
  function restart() {
    stopVoice();
    setWaitingOnCheckpoint(false);
    setCheckpointResult(null);
    setCheckpointAttempts(0);
    setSentenceCue({ index: 0, total: 1, text: "" });
    setDrawProgress(0);
    if (deafMode) setCaptionLog([]);
    setIndex(0);
    setStage("slide");
    lesson.startTeaching();
  }
  function skipForward() {
    /*
     * A pending assessment is not skippable.
     *
     * The maze appeared "sometimes" because skipping walked straight past it. The checkpoint
     * cadence and the skip run are both three, so a learner skipping repeatedly lands ON a maze beat
     * and then skips off it before it is answered — the question is due, it mounts, and the next tap
     * of the same button advances past it. From the outside that reads as Aria arbitrarily choosing
     * to skip the assessment.
     *
     * The maze owns the beat while it is up, exactly as the check-in overlay owns the pause. Answer
     * it — right or wrong, both advance — and skipping works again immediately afterwards.
     */
    if (mcqRef.current) return;
    // The disengagement signal, and the only thing that subtracts XP.
    if (index < beats.length - 1) emitAdhdEvent({ type: "beat-skipped" });
    if (index < beats.length - 1) goTo(index + 1);
  }
  function cycleRate() {
    setRate((r) => (r >= 1.5 ? 0.85 : r === 0.85 ? 1 : 1.25));
  }

  const hasStarted = lesson.mode !== "idle" || index > 0 || stage === "board";
  const progressPct = ((index + (stage === "board" ? 0.5 : 0)) / beats.length) * 100;

  const statusText = speaking ? "explaining" : waitingOnCheckpoint ? "waiting on you" : stage === "slide" ? "setting up" : "drawing";
  const accent = deafMode ? "var(--accent-deaf)" : "var(--hud-cyan)";
  const currentCaption = sentenceCue.text || beat.script;

  // `reading-room` re-points the design tokens to their dark values for this subtree only. The
  // marketing pages are paper; the lesson is a darkened theatre, because the generated boards
  // paint light strokes on a dark ground and inverting that would break every animation the
  // pipeline produces. Every child keeps using the same token names.
  return (
    <main className="reading-room relative h-screen overflow-hidden bg-[var(--hud-bg)] text-[var(--hud-text)]">
      {adhd && <AdhdLayer index={index} beat={beats[index]} gameActive={!!mcq} />}

      {/*
        MOUNTED AGAINST <main>, NOT THE BOARD. It used to be `absolute inset-0` inside the board
        <section>, which covered the board and nothing else — so the whole right-hand column stayed
        live, and its mic button (which reads as "end call" while a session is active) called
        endLiveTutor -> requestResume and restarted the lecture underneath an overlay still saying
        it was paused. The escape was not that the guard was missing; it was that the surface was
        the wrong size.

        Here it covers the board, the chat panel, the transport row, the exit avatar and the
        "Enable sound" banner together. z-[80] clears AdhdLayer's own chrome (z-30..z-50).

        What it still cannot cover is a `window` keydown listener — see beginCheckin, which
        dismisses the checkpoint rather than trusting z-index to stop MazeGame's arrow keys.
      */}
      {checkin && (
        <CheckinOverlay
          phase={checkin}
          fallback={checkinFallback}
          speaking={tutor.speaking}
          transcript={checkinLine}
          muted={tutor.muted}
          onToggleMute={tutor.toggleMute}
          onManualResume={endCheckin}
        />
      )}
      {/* One warm wash. The predecessor layered two cyan radial glows and a 44px blue grid
          directly behind the board — the busiest possible backdrop for the one surface the
          student is meant to be reading. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(232,168,124,0.05),transparent_55%),linear-gradient(180deg,#0c0a09_0%,#080605_78%)]" />

      {/* The board is the visual priority, so the layout is a flex COLUMN rather than absolute
          boxes: status bar, then the board taking every remaining pixel, then controls.

          The predecessor floated the header as an absolute overlay and pushed the board down with
          pt-[190px] to clear it — 190px of permanently dead space above the one surface the
          student is meant to read, and a value that had to be re-guessed whenever the header
          wrapped to a second line. In a flex column the header simply takes the height it needs
          and the board gets the rest, at any viewport, with no magic numbers. */}
      <div className="absolute inset-0 flex flex-col">
        <div className="flex min-h-0 flex-1 gap-2 p-2 lg:gap-3 lg:p-3 xl:grid xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="relative min-h-0 flex-1 overflow-hidden rounded-[var(--radius)] border border-[var(--hud-line)] bg-black">
            {stage === "slide" || isCheckpoint ? (
              <SlideStage
                /* In the ADHD track a checkpoint beat asks nothing — the flown question every third
                   beat is the only question. Without this the beat still printed its "Type your
                   answer" panel, which is exactly the form this track is meant to have none of. */
                suppressCheckpoint={adhd}
                beat={beat}
                onCheckpointAnswer={handleCheckpointAnswer}
                checkpointResult={checkpointResult}
                checkpointAttempts={checkpointAttempts}
                maxAttempts={MAX_ATTEMPTS}
                onRevealAnswer={revealCheckpointAnswer}
              />
            ) : (
              <div className="beat-fade-in relative h-full">
                                <Board key={beat.id} beat={beat} sentenceCue={sentenceCue} drawProgress={drawProgress} />
                {/* The "From past you" echo is removed from the lesson surface. It replayed the
                    student's own earlier wording as a floating card over the board, which
                    interrupts the lesson rather than supporting it. The component and its stored
                    explanations are untouched, so re-mounting this line restores the feature. */}
                {deafMode && (
                  <div className="pointer-events-none absolute left-3 top-3 z-40 flex flex-wrap items-center gap-2 lg:left-5 lg:top-5">
                    <div className="flex items-center gap-2 rounded-full border border-[var(--accent-deaf)]/35 bg-black/70 px-3.5 py-2 text-xs font-black uppercase tracking-[0.14em] text-[var(--accent-deaf)] shadow-[0_0_28px_var(--accent-deaf-glow)] backdrop-blur-md">
                      <span className={`size-2.5 rounded-full ${speaking ? "animate-pulse bg-[var(--accent-deaf)]" : waitingOnCheckpoint ? "bg-amber-300" : "bg-white/35"}`} />
                      {speaking ? "Teacher speaking" : waitingOnCheckpoint ? "Checkpoint" : "Visual cue"}
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/[0.08] px-3.5 py-2 text-xs font-bold text-white/70 backdrop-blur-md">
                      {sentenceCue.total > 1 ? `Caption ${Math.min(sentenceCue.index + 1, sentenceCue.total)}/${sentenceCue.total}` : "Caption ready"}
                    </div>
                  </div>
                )}
                {/* Hidden while a question is on screen. QuizPrompt anchors to the same corner at
                    the same z-index, so both rendered on top of each other: the caption showed
                    through the panel and the two lines of text collided.
                    A GAME ROUND EARNS THE SAME YIELD, for the same reason and one worse symptom:
                    the caption sat across the bottom of the board directly over the sorter's two
                    bins, hiding the one thing a player has to see to answer at all. The caption is narration
                    the student has already heard by the time a question appears, so yielding is
                    the right call — nothing is lost. */}
                <div
                  className={`pointer-events-none absolute inset-x-0 bottom-0 z-40 p-3 lg:p-5 ${
                    quiz.phase !== "idle" ? "hidden" : ""
                  }`}
                >
                  <div
                    className={`mx-auto max-w-5xl rounded-2xl border px-5 py-3 font-bold leading-snug text-white shadow-2xl backdrop-blur-md ${
                      deafMode
                        ? "border-[var(--accent-deaf)]/35 bg-slate-950/95 text-left text-lg lg:px-6 lg:py-4 lg:text-xl"
                        : "border-white/10 bg-slate-950/86 text-center text-base"
                    }`}
                  >
                    {deafMode && (
                      <div className="mb-2 flex items-center justify-between gap-3 text-[0.65rem] font-black uppercase tracking-[0.16em] text-[var(--accent-deaf)]">
                        <span>Live caption</span>
                        <span className="text-white/45">{speaking ? "On screen" : "Paused"}</span>
                      </div>
                    )}
                    {currentCaption}
                  </div>
                </div>
              </div>
            )}

            {/* Fresh explanation board for a chat question */}
            {chat.explainBoard && (
              <ExplainOverlay board={chat.explainBoard} progress={chat.drawProgress} onClose={chat.closeExplanation} />
            )}

            {/* Live-tutor board (drawn by the realtime show_board tool). Closing it just clears the
                board — the live session stays active and the tutor keeps talking. */}
            {liveBoard && (
              <ExplainOverlay board={liveBoard} progress={1} autoReveal onClose={() => setLiveBoard(null)} />
            )}

            {/* Two-way board: freehand sketch. The sketch is auto-shared into Aria's live context
                a moment after the pen lifts — no "send" step, the student just asks about it. */}
            {drawMode && (
              <DrawOverlay
                busy={askingDrawing || engagingTutor}
                seenLabel={drawingContext ? "Aria can see this — just ask" : undefined}
                onClose={() => setDrawMode(false)}
                onExplain={explainDrawing}
                onDrawingChange={(dataUrl) => {
                  bumpInteraction();
                  setAskingDrawing(true);
                  fetch("/api/ask-drawing", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      image: dataUrl,
                      topic: title,
                      beatContext: `${beat.title}: ${beat.script}`,
                      describeOnly: true,
                    }),
                  })
                    .then((res) => res.json().catch(() => ({})))
                    .then((data) => {
                      const description = typeof data.description === "string" ? data.description : "";
                      setDrawingContext(description);
                      if (description && description !== "NOTHING") {
                        tutor.addContext(`The student drew this on the board: ${description}`);
                      }
                    })
                    .catch(() => {})
                    .finally(() => setAskingDrawing(false));
                }}
              />
            )}

            {/* Two-way board: highlighter. Reads the actual DOM text under the marker (no vision
                guesswork), and can ask Aria to explain exactly that in detail. */}
            {(highlightMode || highlightStrokes.length > 0) && (
              <HighlightOverlay
                strokes={highlightStrokes}
                active={highlightMode}
                busy={engagingTutor}
                onCommitStroke={(s) => setHighlightStrokes((prev) => [...prev, s])}
                onClear={() => { setHighlightStrokes([]); highlightedTextRef.current = ""; }}
                onClose={() => setHighlightMode(false)}
                onHighlight={pushHighlightContext}
                onExplain={(text) => {
                  explainWithTutor(
                    `The student just highlighted this on the board and wants you to explain it in detail: "${text}"`
                  );
                }}
              />
            )}

            {focusPause && <FocusPauseOverlay state={focusPause} onResume={resumeFromFocusPause} />}

            {/* The checkpoint, flown. Owns the board while it is up. */}
            {mcq && (
              <div className="absolute inset-0 z-40">
                <MazeGame
                  key={`cp-${index}`}
                  mcq={mcq}
                  onDone={(correct) => {
                    emitAdhdEvent({ type: correct ? "answer-correct" : "answer-wrong" });
                    setCheckpointDone((d) => ({ ...d, [index]: true }));
                    lesson.requestResume();
                  }}
                />
              </div>
            )}

            {/*
              An ADHD learner PLAYS the question; everyone else reads it.
              A round built from this beat's own content is the same retrieval the text prompt asks
              for, in a form that does not look like a wall of text at the exact moment attention is
              hardest to hold. When the content cannot build a round, the prompt is used unchanged.
            */}
            {quiz.phase !== "idle" && (
              <QuizPrompt
                quiz={quiz}
                onSkip={() => {
                  quiz.cancel();
                  // Skipping the QUESTION, which is not the same as answering it wrong — a wrong
                  // answer still costs nothing. See lib/adhd/score.ts.
                  emitAdhdEvent({ type: "question-unanswered" });
                  lesson.requestResume();
                }}
              />
            )}
          </section>

          <div className="hidden min-h-0 flex-col gap-3 xl:flex [&>*:last-child]:min-h-0 [&>*:last-child]:flex-1">
            {/*
              THE teacher, at a size that actually draws the eye.
              She lived at 88px over the board and covered the slide title; here she has a 340px
              column to herself. Rendered outside ChatPanel so the standard player is untouched.
            */}
            {adhd && (
              <div className="flex shrink-0 flex-col items-center gap-2 rounded-[1.5rem] border border-[var(--hud-line)] bg-[var(--hud-bg-2)] px-3 py-3">
                <TeacherAvatar speaking={speaking} size={150} expression={face} />
                {reproach && (
                  <p
                    data-reproach
                    className={`w-full rounded-xl px-3 py-2 text-center text-[0.78rem] font-semibold leading-snug beat-fade-in ${
                      face === "furious"
                        ? "bg-red-500/12 text-red-200 ring-1 ring-red-400/25"
                        : face === "sad"
                          ? "bg-amber-500/10 text-amber-100/90 ring-1 ring-amber-400/20"
                          : "bg-emerald-500/10 text-emerald-100/90 ring-1 ring-emerald-400/20"
                    }`}
                  >
                    {reproach}
                  </p>
                )}
              </div>
            )}
            {deafMode ? (
              <DeafAccessPanel
                beat={beat}
                caption={currentCaption}
                captionLog={captionLog}
                speaking={speaking}
                waitingOnCheckpoint={waitingOnCheckpoint}
                stage={stage}
              />
            ) : (
              <ChatPanel
                chat={chat.chat}
                explaining={chat.explaining}
                listening={chat.listening}
                interim={chat.interim}
                voiceSupported={REALTIME_TUTOR_ENABLED ? true : chat.voiceSupported}
                onAsk={chat.ask}
                // The mic now toggles the live full-duplex tutor (real conversation) instead of a
                // one-shot transcription. Falls back to one-shot voice if realtime is disabled.
                onVoice={REALTIME_TUTOR_ENABLED ? (sessionActive ? endLiveTutor : startLiveTutor) : chat.startVoice}
                liveActive={sessionActive}
                /* `!== "idle"` alone counted the FAILURE states as ready: a session that had errored,
                   been refused the microphone, or been autoplay-blocked is not idle, so a dead
                   connection rendered as "VOICE READY · MUTED" directly above the red text saying it
                   had disconnected. Ready means a session that could actually carry a voice. */
                liveReady={
                  REALTIME_TUTOR_ENABLED &&
                  (tutor.status === "connecting" || tutor.status === "live" || tutor.status === "drawing") &&
                  !sessionActive
                }
                liveStatusLabel={liveMicLabel}
                liveMuted={tutor.muted}
                onLiveMute={tutor.toggleMute}
                liveError={tutor.errorMessage}
              />
            )}
          </div>
        </div>

        {/* The status bar. Now a flow element at the top of the column rather than an absolute
            overlay: it takes exactly the height it needs, the board takes the rest, and a header
            that wraps to two lines can no longer bleed over the board or require the pt-[190px]
            spacer the previous layout depended on.

            `order-first` keeps it visually above the board while leaving it after the board in the
            DOM would have hurt nothing — but it reads top-to-bottom for a screen reader this way,
            which matches the visual order. */}
        <header className="order-first flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--hud-line)] bg-[var(--hud-bg-2)] px-4 py-2.5">
          <div className="flex items-center gap-4">
            <button onClick={onExit} className="group relative" aria-label="Exit lecture">
              <AvatarRing progress={progressPct} speaking={speaking}>
                {/*
                  ADHD mode renders ONE big avatar in the sidebar, so this slot drops the face and
                  keeps only the control. The button, its ring and its aria-label are untouched —
                  deleting the element outright would delete the exit affordance with it.
                */}
                {adhd ? (
                  <span className="grid size-[52px] place-items-center text-lg text-[var(--hud-text-dim)]" aria-hidden="true">
                    ←
                  </span>
                ) : (
                  <TeacherAvatar speaking={speaking} size={52} expression={face} />
                )}
              </AvatarRing>
            </button>
            {/* min-w-0 lets the title truncate instead of pushing the controls off-screen — a
                generated lesson title can be arbitrarily long. */}
            <div className="min-w-0">
              <p className="text-[0.72rem] leading-none text-[var(--hud-text-faint)]">
                Part {index + 1} of {beats.length}
              </p>
              <h1 className="mt-1 max-w-[38ch] truncate text-[0.95rem] font-medium leading-tight text-[var(--hud-text)]">
                {title}
              </h1>
            </div>

            {/* The score sits INSIDE the header row rather than absolutely over the board. As an
                overlay it clipped the board frame at every viewport; as a flow element the header
                simply grows to hold it, which is what this header was built to do. */}
            {adhd && <AdhdScoreChip />}

            {/* Who is speaking — the single most important thing this screen communicates. Derived
                from state the tutor hook already owns, so nothing about the audio pipeline
                changes. Colour, icon and text all carry the meaning, so it survives colour
                blindness and screen readers alike. */}
            <VoiceState
              phase={derivePhase({
                status: tutor.status,
                // `tutor.isSpeaking` is a getter, not a flag — it reads live refs for the
                // in-flight response and the audio element.
                ariaSpeaking: speaking || tutor.isSpeaking(),
                // The hook does not expose a dedicated "student is talking" flag, so this is
                // deliberately conservative: only claim the student has the floor when the
                // session is live, the mic is open, and neither Aria channel is active.
                studentSpeaking: Boolean(
                  tutor.status === "live" && !tutor.muted && !speaking && !tutor.isSpeaking() && hasStarted,
                ),
                muted: tutor.muted,
                paused: hasStarted && !lesson.playing,
              })}
            />

            {!deafMode && hasStarted && <EngagementMeter engagement={engagement} accent="bg-[var(--hud-cyan)]" />}
          </div>

          {/*
            THE TRANSPORT IS INERT DURING A CHECK-IN.
            The overlay covers the board, but this row sits outside that section — so without this a
            learner could simply keep pressing Skip straight through the conversation, which is the
            exact behaviour the check-in exists to answer, and pressing Play would fight the pause
            besides. `inert` rather than `pointer-events-none`: it also removes the buttons from the
            tab order and from assistive tech, so the controls are unavailable rather than merely
            unclickable. The dimming is what makes that legible instead of mysterious.
          */}
          <div
            inert={checkin !== null}
            className={`flex flex-wrap items-center gap-2 transition-opacity ${checkin ? "opacity-30" : ""}`}
          >
            {/* Icon controls with tooltips, replacing the text-filled pills. Every handler below
                is the original one, moved verbatim — this is a presentation change only. The
                tooltip appears on keyboard focus as well as hover, and each button keeps an
                aria-label, so an icon-only control stays operable and announceable. */}
            <button
              onClick={cycleRate}
              aria-label={`Playback speed, currently ${rate} times. Click to change.`}
              className="grid h-9 min-w-9 place-items-center rounded-[var(--radius-sm)] border border-[var(--hud-line)] px-2 text-[0.78rem] tabular-nums text-[var(--hud-text-dim)] transition-colors hover:bg-[var(--hud-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--listening)]"
              style={{ transitionDuration: "var(--motion-fast)" }}
            >
              {rate}×
            </button>
            <IconButton
              icon={Pencil}
              label="Draw on the board"
              active={drawMode}
              onClick={() => {
                setHighlightMode(false);
                setDrawMode((v) => !v);
              }}
            />
            <IconButton
              icon={Highlighter}
              label="Highlight the board"
              active={highlightMode}
              onClick={() => {
                setDrawMode(false);
                setHighlightMode((v) => !v);
              }}
            />
            <button
              onClick={async () => {
                setExportingPdf(true);
                try {
                  const res = await fetch("/api/export-pdf", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ topic: title, beats }),
                  });
                  if (!res.ok) throw new Error("export failed");
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch {
                  /* PDF export failures shouldn't interrupt the lesson */
                } finally {
                  setExportingPdf(false);
                }
              }}
              disabled={exportingPdf}
              aria-label={exportingPdf ? "Exporting this lesson as a PDF" : "Export this lesson as a PDF"}
              className="grid size-9 place-items-center rounded-[var(--radius-sm)] border border-[var(--hud-line)] text-[var(--hud-text-dim)] transition-colors hover:bg-[var(--hud-surface)] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--listening)]"
              style={{ transitionDuration: "var(--motion-fast)" }}
            >
              {exportingPdf ? (
                <Loader2 aria-hidden="true" size={17} strokeWidth={1.9} className="animate-spin" />
              ) : (
                <Download aria-hidden="true" size={17} strokeWidth={1.9} />
              )}
            </button>
            <IconButton
              icon={SkipForward}
              label="Skip to next part"
              onClick={skipForward}
              disabled={index >= beats.length - 1}
            />

            {/* The primary action keeps its words. Everything else on this bar is an icon, which
                is exactly what makes a single labelled button read as the main one. */}
            <button
              onClick={hasStarted ? togglePlay : startLesson}
              className="hud-btn-primary inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-4 py-2 text-sm"
            >
              {!hasStarted ? (
                <>
                  <Play aria-hidden="true" size={15} strokeWidth={2.2} /> Start lecture
                </>
              ) : lesson.playing ? (
                <>
                  <Pause aria-hidden="true" size={15} strokeWidth={2.2} /> Pause
                </>
              ) : (
                <>
                  <Play aria-hidden="true" size={15} strokeWidth={2.2} /> Resume
                </>
              )}
            </button>

            <IconButton icon={RotateCcw} label="Restart lesson" onClick={restart} />
            {onExit && <IconButton icon={LogOut} label="End lesson" tone="danger" onClick={onExit} />}
          </div>
        </header>

        {voiceBlocked && (
          <div className="absolute left-4 right-4 top-28 z-50 flex items-center justify-between gap-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-3.5 backdrop-blur-xl lg:left-6 lg:right-6">
            <p className="text-sm font-bold text-amber-200">
              Your browser blocked the teacher&rsquo;s voice (autoplay is muted until you interact). Tap to enable sound.
            </p>
            <button onClick={retryVoice} className="shrink-0 rounded-full bg-amber-400 px-5 py-2 text-sm font-black text-amber-950">
              Enable sound
            </button>
          </div>
        )}

      </div>
    </main>
  );
}

function DeafAccessPanel({
  beat,
  caption,
  captionLog,
  speaking,
  waitingOnCheckpoint,
  stage,
}: {
  beat: Beat;
  caption: string;
  captionLog: string[];
  speaking: boolean;
  waitingOnCheckpoint: boolean;
  stage: Stage;
}) {
  const visualState = waitingOnCheckpoint ? "Checkpoint waiting" : speaking ? "Caption live" : stage === "slide" ? "Visual setup" : "Board drawing";
  const terms = deafKeywords(beat.title, caption);
  const lines = captionLog.length ? captionLog : [caption];

  return (
    <aside className="relative flex h-full min-h-0 flex-col gap-3 overflow-hidden rounded-xl border border-[var(--accent-deaf)]/25 bg-slate-950/86 p-4 shadow-[0_32px_110px_rgba(0,0,0,0.34)] backdrop-blur-xl">
      <HudCorners accent="var(--accent-deaf)" />

      <div className="rounded-lg border border-[var(--accent-deaf)]/25 bg-[var(--accent-deaf-glow)] px-4 py-3">
        <p className="text-[0.65rem] font-black uppercase tracking-[0.18em] text-[var(--accent-deaf)]">Deaf mode</p>
        <h2 className="mt-1 text-lg font-black text-white">Caption-first lesson</h2>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/30 p-4">
        <p className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-white/40">Visual sound cue</p>
        <div className="mt-3 flex items-center gap-3">
          <span className={`size-4 rounded-full ${speaking ? "animate-pulse bg-[var(--accent-deaf)] shadow-[0_0_20px_var(--accent-deaf)]" : waitingOnCheckpoint ? "bg-amber-300" : "bg-white/30"}`} />
          <p className="text-base font-black text-white">{visualState}</p>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/30 p-4">
        <p className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-white/40">Current caption</p>
        <p className="mt-3 text-base font-bold leading-snug text-white">{caption}</p>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/30 p-4">
        <p className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-white/40">Key terms</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {terms.map((term) => (
            <span key={term} className="rounded-full border border-[var(--accent-deaf)]/25 bg-[var(--accent-deaf-glow)] px-3 py-1.5 text-xs font-black text-[var(--accent-deaf)]">
              {term}
            </span>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-white/10 bg-black/30 p-4">
        <p className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-white/40">Recent transcript</p>
        <div className="mt-3 flex max-h-full flex-col gap-2 overflow-y-auto pr-1">
          {lines.map((line, i) => (
            <p key={`${i}-${line}`} className="rounded-lg bg-white/[0.05] px-3 py-2 text-sm font-semibold leading-snug text-white/80">
              {line}
            </p>
          ))}
        </div>
      </div>
    </aside>
  );
}

function deafKeywords(title: string, caption: string) {
  const stop = new Set(["about", "after", "again", "because", "before", "being", "between", "could", "every", "from", "have", "into", "like", "make", "means", "more", "that", "their", "there", "these", "this", "through", "when", "where", "which", "with", "your"]);
  const words = `${title} ${caption}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 3 && !stop.has(word));

  return [...new Set(words)].slice(0, 5);
}

/** A progress ring around the avatar — the lecture's progress bar, built into the header
 *  instead of living as a separate strip. Exported for reuse by other tracks' headers. */
export function AvatarRing({ progress, speaking, children }: { progress: number; speaking: boolean; children: React.ReactNode }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(1, Math.max(0, progress / 100)));
  return (
    <div className="relative grid size-[60px] place-items-center">
      <svg viewBox="0 0 60 60" className="absolute inset-0 -rotate-90">
        <circle cx="30" cy="30" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
        <circle
          cx="30"
          cy="30"
          r={r}
          fill="none"
          stroke="url(#avatar-ring-grad)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 400ms ease" }}
        />
        <defs>
          <linearGradient id="avatar-ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#aef5ec" />
            <stop offset="100%" stopColor="#1f9e92" />
          </linearGradient>
        </defs>
      </svg>
      {speaking && <span className="absolute inset-0 rounded-full ring-2 ring-[var(--hud-cyan)]/40 av-ring" />}
      <div className="relative">{children}</div>
    </div>
  );
}

/** Exported so other tracks (e.g. AdhdLessonPlayer) can render the visual board.
 *  AI-generated topic beats render either sandboxed React animations or normal LiveSketch
 *  boards with narration-synced progress. For the hardcoded photosynthesis demo beats, the
 *  bespoke per-id scene components run unchanged — no regression. */
export function Board({
  beat,
  sentenceCue,
  drawProgress,
}: {
  beat: Beat;
  sentenceCue: { index: number; total: number; text: string };
  drawProgress?: number;
}) {
  return (
    <div className="absolute inset-0 bg-slate-950">
      <VisualDirector key={beat.id} beat={beat} sentenceCue={sentenceCue} drawProgress={drawProgress} />
    </div>
  );
}

function VisualDirector({
  beat,
  sentenceCue,
  drawProgress,
}: {
  beat: Beat;
  sentenceCue: { index: number; total: number; text: string };
  drawProgress?: number;
}) {
  const text = sentenceCue.text;
  const cue = sentenceCue.index;
  const sentenceTiming = narrationSentenceTiming(beat.script, cue, drawProgress ?? 0);
  const bespokeScene = isCuratedPhotosynthesisBeat(beat) ? photosynthesisSceneForBeat(beat.id, cue) : null;
  // Once the sandboxed animation fails for this beat (transpile error, runtime throw, watchdog
  // timeout), show an explicit unavailable board for the rest of this beat's lifetime. Resets
  // naturally: Board renders VisualDirector with `key={beat.id}`, so this state is fresh per beat.
  const [sandboxFailed, setSandboxFailed] = useState(false);
  // Same lifetime rule as sandboxFailed: once Manim fails for this beat, fall back to the live
  // board for the rest of the beat rather than retrying a render that costs seconds.
  const [manimFailed, setManimFailed] = useState(false);
  const rendererSelection = beat.draw
    ? selectAnimationRenderer(beat.draw, {
        gsapEnabled: GSAP_RENDER_ENABLED,
        manimEnabled: MANIM_RENDER_ENABLED && !manimFailed,
      })
    : null;

  if (bespokeScene) {
    return (
      <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-3 text-white lg:p-4">
        <div className="pointer-events-none absolute inset-0 opacity-80" style={{ backgroundImage: "radial-gradient(circle at 20% 16%, rgba(16,185,129,0.24), transparent 38%), radial-gradient(circle at 78% 78%, rgba(59,130,246,0.22), transparent 42%)" }} />
        <RendererBadge kind="svg" />
        <div className="relative flex h-full flex-col">
          <div className="relative min-h-0 flex-1 pb-16">{bespokeScene}</div>
          <div className="relative hidden">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-white/35">Visual is responding to</p>
            <p className="mt-1 text-sm font-bold leading-snug text-white/80">{text || "Teacher cue will appear here as narration starts."}</p>
          </div>
        </div>
      </section>
    );
  }

  // If a beat declares a React animation, never mask a missing or failed animation with the old
  // line-diagram fallback. Normal DrawScript boards still render through LiveSketch.
  if (beat.draw) {
    // A chalkBoard beat: its real chalk ops are authored server-side; unwrap them into LiveSketch
    // (chalk rendering). Pending → preparing card; failed → unavailable card (never the old
    // template board, per the design).
    const chalkOp = findChalkBoardOp(beat);
    if (chalkOp?.kind === "chalkBoard") {
      if (chalkOp.ops && chalkOp.ops.length > 0 && BLACKBOARD_GEN_ENABLED) {
        return (
          <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-2 text-white lg:p-3">
            <LiveSketch key={beat.id} script={{ ...beat.draw, ops: chalkOp.ops }} progress={sentenceTiming.alignedProgress} />
            <RendererBadge kind="svg" />
          </section>
        );
      }
      if (isChalkBoardPending(beat)) {
        return <AnimationStatusBoard title={beat.title} teachingPoint={chalkOp.boardBrief} eyebrow="Preparing board" />;
      }
      const boardReason = !BLACKBOARD_GEN_ENABLED
        ? "Blackboard generation is turned off."
        : chalkOp.error ?? "Blackboard was not available.";
      return <AnimationStatusBoard title={beat.title} teachingPoint={chalkOp.boardBrief} eyebrow="Board unavailable" reason={boardReason} />;
    }

    const animationOp = findReactAnimationOp(beat);
    if (animationOp?.kind === "reactAnimation" && animationOp.code && REACT_ANIMATIONS_ENABLED && !sandboxFailed) {
      return (
        <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-2 text-white lg:p-3">
          <ReactAnimationSandbox
            key={beat.id}
            code={animationOp.code}
            assetIds={animationOp.assetIds}
            progress={drawProgress}
            sentenceIndex={sentenceTiming.index}
            sentenceProgress={sentenceTiming.progress}
            sentenceTotal={sentenceTiming.total}
            onError={() => setSandboxFailed(true)}
          />
          <RendererBadge kind="sandbox" />
        </section>
      );
    }
    if (animationOp?.kind === "reactAnimation") {
      const reason = !REACT_ANIMATIONS_ENABLED
        ? "React animations are turned off."
        : sandboxFailed
          ? "Generated animation failed to run safely."
          : animationOp.error ?? "Generated animation code was not available.";
      return <AnimationUnavailableBoard title={beat.title} teachingPoint={animationOp.teachingPoint} reason={reason} />;
    }
    // A plain DrawScript beat. Manim renders the same script to video when enabled and the
    // beat actually has something to animate; a text-only notes board stays on LiveSketch,
    // which writes it word-by-word with the marker — an effect video cannot reproduce. Falls
    // back to the live board if the render fails, so the flag can degrade but never break a
    // lesson. This condition must match the prefetch filter above.
    if (rendererSelection?.renderer === "structure") {
      const structureOp = beat.draw.ops.find((op) => op.kind === "structureScene");
      if (structureOp?.kind === "structureScene" && structureOp.spec) {
        return (
          <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-2 text-white lg:p-3">
            <StructureBoard key={beat.id} spec={structureOp.spec as StructureSpec} progress={drawProgress} />
            <RendererBadge kind="structure" />
          </section>
        );
      }
    }
    // The two spec-driven boards. Like `structure` above, both are only selected once their spec
    // has validated against the renderer that draws it, so reaching here means the board renders.
    if (rendererSelection?.renderer === "plot") {
      const plotOp = beat.draw.ops.find((op) => op.kind === "plotBoard");
      if (plotOp?.kind === "plotBoard" && plotOp.spec) {
        return (
          <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-2 text-white lg:p-3">
            <PlotBoard key={beat.id} spec={plotOp.spec as PlotSpec} progress={drawProgress} />
            <RendererBadge kind="plot" />
          </section>
        );
      }
    }
    if (rendererSelection?.renderer === "equation") {
      const equationOp = beat.draw.ops.find((op) => op.kind === "equationBoard");
      if (equationOp?.kind === "equationBoard" && equationOp.spec) {
        return (
          <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-2 text-white lg:p-3">
            <EquationBoard key={beat.id} spec={equationOp.spec as EquationSpec} progress={drawProgress} />
            <RendererBadge kind="equation" />
          </section>
        );
      }
    }
    if (rendererSelection?.renderer === "gsap") {
      return (
        <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-2 text-white lg:p-3">
          <GsapSketch key={beat.id} script={beat.draw} progress={drawProgress} />
          <RendererBadge kind="gsap" />
        </section>
      );
    }
    if (rendererSelection?.renderer === "manim") {
      return (
        <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-2 text-white lg:p-3">
          {/* ManimBoard renders its own badge: only it knows whether the video is ready or it
              is currently falling back to the live SVG board. */}
          <ManimBoard key={beat.id} script={beat.draw} progress={drawProgress} onError={() => setManimFailed(true)} />
        </section>
      );
    }
    const manimSceneOp = beat.draw.ops.find((op) => op.kind === "manimScene");
    if (manimSceneOp?.kind === "manimScene") {
      const reason = !MANIM_RENDER_ENABLED
        ? "Manim rendering is turned off."
        : manimFailed
          ? "The diagram video failed to render."
          : manimSceneOp.error ?? "The diagram specification was not available.";
      return (
        <AnimationStatusBoard
          title={beat.title}
          teachingPoint={manimSceneOp.sceneBrief}
          eyebrow="Diagram unavailable"
          reason={reason}
        />
      );
    }
    return (
      <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-2 text-white lg:p-3">
        <LiveSketch key={beat.id} script={beat.draw} progress={drawProgress} />
        <RendererBadge kind="svg" />
      </section>
    );
  }

  return (
    <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-3 text-white lg:p-4">
      <div className="pointer-events-none absolute inset-0 opacity-80" style={{ backgroundImage: "radial-gradient(circle at 20% 16%, rgba(16,185,129,0.24), transparent 38%), radial-gradient(circle at 78% 78%, rgba(59,130,246,0.22), transparent 42%)" }} />
      <div className="relative flex h-full flex-col">
        <div className="relative min-h-0 flex-1 pb-16">
          {/* Hardcoded photosynthesis demo — bespoke per-id scenes, kept as-is. */}
          {beat.id === "hook" && <LeafKitchenVisual cue={cue} />}
          {beat.id === "define-photosynthesis" && <WordBreakVisual cue={cue} />}
          {beat.id === "ingredients-fast" && <IngredientDeliveryVisual cue={cue} />}
          {beat.id === "chloroplast" && <ChloroplastVisual cue={cue} />}
          {beat.id === "mechanism" && <MechanismVisual cue={cue} />}
          {beat.id === "outputs" && <OutputsVisual cue={cue} />}
          {beat.id === "compare-respiration" && <MirrorRecipeVisual cue={cue} />}
          {beat.id === "why-it-matters" && <EarthSystemVisual cue={cue} />}
          {beat.id === "recap" && <RecapVisual cue={cue} />}
        </div>
        <div className="relative hidden">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-white/35">Visual is responding to</p>
          <p className="mt-1 text-sm font-bold leading-snug text-white/80">{text || "Teacher cue will appear here as narration starts."}</p>
        </div>
      </div>
    </section>
  );
}

function narrationSentenceTiming(script: string, cueIndex: number, beatProgress: number) {
  const sentences = splitNarrationSentences(script);
  const total = Math.max(1, sentences.length);
  const weights = sentences.length
    ? sentences.map((sentence) => Math.max(1.35, sentence.length / 13))
    : [1];
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const index = Math.max(0, Math.min(total - 1, cueIndex));
  const startWeight = weights.slice(0, index).reduce((sum, weight) => sum + weight, 0);
  const start = startWeight / totalWeight;
  const end = (startWeight + weights[index]) / totalWeight;
  const progress = Math.max(0, Math.min(1, (beatProgress - start) / Math.max(0.001, end - start)));
  return {
    index,
    total,
    progress,
    alignedProgress: (index + progress) / total,
  };
}

function AnimationStatusBoard({
  title,
  teachingPoint,
  eyebrow,
  reason,
}: {
  title: string;
  teachingPoint?: string;
  eyebrow: string;
  reason?: string;
}) {
  const displayPoint = publicTeachingPoint(teachingPoint);
  return (
    <section className="relative grid h-full min-h-0 place-items-center overflow-hidden bg-slate-950 p-4 text-white">
      <div className="pointer-events-none absolute inset-0 opacity-80" style={{ backgroundImage: "radial-gradient(circle at 50% 42%, rgba(45,212,191,0.18), transparent 34%), radial-gradient(circle at 22% 78%, rgba(59,130,246,0.12), transparent 30%)" }} />
      <div className="pointer-events-none absolute inset-0 opacity-20" style={{ backgroundImage: "linear-gradient(rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.08) 1px, transparent 1px)", backgroundSize: "46px 46px" }} />
      <div className="relative max-w-2xl rounded-3xl border border-cyan-200/20 bg-slate-950/70 px-8 py-7 text-center shadow-[0_0_60px_rgba(45,212,191,0.10)]">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-200/70">{eyebrow}</p>
        <h3 className="mt-3 font-display text-3xl font-black text-white">{title}</h3>
        {displayPoint && <p className="mt-4 text-sm font-semibold leading-6 text-white/60">{displayPoint}</p>}
        {reason ? (
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.12em] text-rose-200/70">{reason}</p>
        ) : (
          <div className="mx-auto mt-7 h-1.5 w-56 overflow-hidden rounded-full bg-white/10">
            <div className="hud-shimmer h-full w-full" />
          </div>
        )}
      </div>
    </section>
  );
}

function AnimationUnavailableBoard({
  title,
  teachingPoint,
  reason,
}: {
  title: string;
  teachingPoint?: string;
  reason: string;
}) {
  return (
    <AnimationStatusBoard
      title={title}
      teachingPoint={teachingPoint}
      eyebrow="Animation unavailable"
      reason={reason}
    />
  );
}

function publicTeachingPoint(teachingPoint?: string) {
  if (!teachingPoint) return undefined;
  if (teachingPoint.includes("SUPRNOTES_WHITEBOARD_SVG_BOARD")) return "Aria is preparing a clean whiteboard diagram for this idea.";
  const compact = teachingPoint.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  if (compact.length > 180) return "Aria is preparing a clean whiteboard diagram for this idea.";
  return compact;
}

function isCuratedPhotosynthesisBeat(beat: Beat) {
  // The demo's bespoke React scenes intercept all nine beats before their DrawScripts are
  // ever rendered. Six of those DrawScripts carry real shapes, arrows and morphs — the only
  // Manim-worthy content in the whole app — so this switch releases them to the normal
  // renderer path. Set NEXT_PUBLIC_CURATED_SCENES_ENABLED=0 to compare Manim against the
  // hand-built scenes on a real narrated lecture, with no API spend.
  if (!CURATED_SCENES_ENABLED) return false;
  if (!PHOTOSYNTHESIS_SCENE_IDS.has(beat.id)) return false;
  return demoBeats.some((demo) => demo.id === beat.id && demo.title === beat.title && demo.script === beat.script);
}

function photosynthesisSceneForBeat(id: string, cue: number) {
  switch (id) {
    case "hook":
      return <LeafKitchenVisual cue={cue} />;
    case "define-photosynthesis":
      return <WordBreakVisual cue={cue} />;
    case "ingredients-fast":
      return <IngredientDeliveryVisual cue={cue} />;
    case "chloroplast":
      return <ChloroplastVisual cue={cue} />;
    case "mechanism":
      return <MechanismVisual cue={cue} />;
    case "outputs":
      return <OutputsVisual cue={cue} />;
    case "compare-respiration":
      return <MirrorRecipeVisual cue={cue} />;
    case "why-it-matters":
      return <EarthSystemVisual cue={cue} />;
    case "recap":
      return <RecapVisual cue={cue} />;
    default:
      return null;
  }
}

function ScienceFrame({ children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="science-frame relative h-full min-h-0 overflow-hidden rounded-[1.75rem] bg-[#07110c] text-slate-950 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),0_24px_90px_rgba(0,0,0,0.34)]">
      <div className="science-stage-glow" />
      <div className="relative h-full min-h-0">{children}</div>
      <div className="science-vignette" />
      <div className="science-grain" />
    </div>
  );
}

function ScienceArrowDefs() {
  return (
    <defs>
      <marker id="science-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10z" fill="currentColor" />
      </marker>
    </defs>
  );
}

function LeafKitchenVisual({ cue }: { cue: number }) {
  return (
    <ScienceFrame title="Energy flow: sunlight powers food production">
      <svg viewBox="0 0 900 560" className="h-full min-h-0 w-full">
        <defs>
          <filter id="leaf-macro-blur">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
          <filter id="cinema-soft-glow" x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur stdDeviation="10" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0.18 0 1 0 0 0.72 0 0 1 0 0.34 0 0 0 0.72 0" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="cell-panel" x1="0" x2="1">
            <stop offset="0%" stopColor="#062117" stopOpacity="0.92" />
            <stop offset="58%" stopColor="#0f3d28" stopOpacity="0.78" />
            <stop offset="100%" stopColor="#052e16" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="gold-beam" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fef3c7" stopOpacity="0.95" />
            <stop offset="48%" stopColor="#f59e0b" stopOpacity="0.58" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="live-chloroplast" cx="34%" cy="28%" r="72%">
            <stop offset="0%" stopColor="#ecfccb" />
            <stop offset="40%" stopColor="#84cc16" />
            <stop offset="100%" stopColor="#315c13" />
          </radialGradient>
          <marker id="science-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10z" fill="currentColor" />
          </marker>
        </defs>
        <image href="/lecture-assets/photosynthesis-leaf-lab.png" x="0" y="0" width="900" height="560" preserveAspectRatio="xMidYMid meet" opacity="0.42" filter="url(#leaf-macro-blur)" className="science-camera-drift" />
        <rect width="900" height="560" rx="34" fill="#02140d" opacity="0.64" />
        <path d="M54 70 C232 18 552 20 842 92 L842 488 C584 526 240 528 56 470Z" fill="url(#cell-panel)" stroke="#a7f3d0" strokeWidth="2" opacity="0.92" />
        <path d="M96 342 C238 148 646 140 812 314 C652 470 242 482 96 342Z" fill="#1ba65b" opacity="0.34" filter="url(#cinema-soft-glow)" className="science-breathe" />
        <path d="M126 340 C302 302 540 294 774 322" stroke="#d9f99d" strokeWidth="10" strokeLinecap="round" opacity="0.34" className="leaf-vein-flow" />
        <path d="M520 28 L750 488 L642 500 L424 48Z" fill="url(#gold-beam)" opacity="0.5" className="leaf-sunbeam" />
        <text x="450" y="138" textAnchor="middle" className="fill-emerald-50 text-[24px] font-black">inside a photosynthetic cell</text>
        <g className={cue >= 1 ? "diagram-pop" : "opacity-25"}>
          <circle cx="184" cy="278" r="50" fill="#facc15" filter="url(#cinema-soft-glow)" />
          {Array.from({ length: 10 }).map((_, i) => (
            <line key={i} x1="184" y1="208" x2="184" y2="170" stroke="#fde68a" strokeWidth="6" strokeLinecap="round" transform={`rotate(${i * 36} 184 278)`} opacity="0.82" />
          ))}
          <text x="184" y="372" textAnchor="middle" className="fill-amber-50 text-[28px] font-black">sunlight</text>
        </g>
        <g className={cue >= 3 ? "diagram-pop" : "opacity-20"} color="#facc15">
          <path d="M250 278 C330 244 410 238 494 260" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" markerEnd="url(#science-arrow)" strokeDasharray="18 14" className="photon-stream" />
          <text x="365" y="226" textAnchor="middle" className="fill-amber-100 text-[24px] font-black">light energy</text>
        </g>
        <g className={cue >= 4 ? "diagram-pop" : "opacity-20"}>
          <ellipse cx="548" cy="282" rx="128" ry="78" fill="url(#live-chloroplast)" stroke="#d9f99d" strokeWidth="4" filter="url(#cinema-soft-glow)" className="chloroplast-cell" />
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={`M476 ${250 + i * 20} C512 ${238 + i * 20} 584 ${238 + i * 20} 620 ${250 + i * 20}`} stroke="#ecfccb" strokeWidth="11" strokeLinecap="round" fill="none" opacity="0.82" />
          ))}
          <text x="548" y="384" textAnchor="middle" className="fill-lime-50 text-[27px] font-black">chloroplast</text>
        </g>
        <g className={cue >= 6 ? "diagram-pop" : "opacity-0"}>
          <path d="M670 282 C705 282 724 282 752 282" fill="none" stroke="#fbbf24" strokeWidth="8" markerEnd="url(#science-arrow)" className="photon-stream" />
          <polygon points="782,238 830,266 830,322 782,350 734,322 734,266" fill="#f59e0b" stroke="#fed7aa" strokeWidth="6" filter="url(#cinema-soft-glow)" />
          <text x="782" y="298" textAnchor="middle" className="fill-white text-[25px] font-black">glucose</text>
        </g>
      </svg>
    </ScienceFrame>
  );
}

function WordBreakVisual({ cue }: { cue: number }) {
  return (
    <ScienceFrame title="Term breakdown: the word explains the process">
      <svg viewBox="0 0 900 560" className="h-full min-h-0 w-full">
        <ScienceArrowDefs />
        <defs>
          <radialGradient id="word-sun" cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#fef3c7" />
            <stop offset="55%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#b45309" />
          </radialGradient>
          <linearGradient id="word-brick" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#86efac" />
            <stop offset="100%" stopColor="#16a34a" />
          </linearGradient>
          <filter id="word-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#1e293b" floodOpacity="0.22" />
          </filter>
        </defs>
        <rect width="900" height="560" rx="34" fill="#07111f" />

        {/* PHOTO = light: a sun with rays */}
        <g className={cue >= 1 ? "diagram-pop" : "opacity-25"}>
          <circle cx="200" cy="190" r="56" fill="url(#word-sun)" filter="url(#word-shadow)" />
          {Array.from({ length: 10 }).map((_, i) => (
            <line key={i} x1="200" y1="118" x2="200" y2="92" stroke="#f59e0b" strokeWidth="7" strokeLinecap="round" transform={`rotate(${i * 36} 200 190)`} />
          ))}
          <text x="200" y="282" textAnchor="middle" className="fill-amber-100 text-[34px] font-black">PHOTO</text>
          <text x="200" y="318" textAnchor="middle" className="fill-amber-200 text-[22px] font-bold">= light</text>
        </g>

        {/* + */}
        <text x="450" y="208" textAnchor="middle" className="fill-white text-[64px] font-black" opacity="0.25">+</text>

        {/* SYNTHESIS = building: stacked bricks assembling */}
        <g className={cue >= 2 ? "diagram-pop" : "opacity-25"}>
          {[0, 1, 2].map((i) => (
            <rect
              key={i}
              x={650 - 70 + (i % 2) * 14}
              y={232 - i * 38}
              width="140"
              height="34"
              rx="9"
              fill="url(#word-brick)"
              stroke="#14532d"
              strokeWidth="3"
              filter="url(#word-shadow)"
            />
          ))}
          <text x="650" y="282" textAnchor="middle" className="fill-emerald-100 text-[34px] font-black">SYNTHESIS</text>
          <text x="650" y="318" textAnchor="middle" className="fill-emerald-200 text-[22px] font-bold">= building</text>
        </g>

        {/* arrow down into the combined meaning + a glucose hexagon, echoing the other scenes */}
        <g className={cue >= 4 ? "diagram-pop" : "opacity-0"}>
          <path d="M200 340 C260 392 340 412 420 416" fill="none" stroke="#f59e0b" strokeWidth="6" markerEnd="url(#science-arrow)" strokeDasharray="14 12" />
          <path d="M650 340 C590 392 510 412 430 416" fill="none" stroke="#16a34a" strokeWidth="6" markerEnd="url(#science-arrow)" strokeDasharray="14 12" />
          <rect x="220" y="436" width="460" height="92" rx="28" fill="#ecfdf5" fillOpacity="0.92" stroke="#34d399" strokeWidth="4" />
          <text x="450" y="472" textAnchor="middle" className="fill-emerald-950 text-[30px] font-black">using light to build sugar</text>
          <text x="450" y="504" textAnchor="middle" className="fill-emerald-700 text-[19px] font-bold">not memorizing a word — decoding it</text>
        </g>
      </svg>
    </ScienceFrame>
  );
}

function IngredientDeliveryVisual({ cue }: { cue: number }) {
  return (
    <ScienceFrame title="Three inputs enter through three different routes">
      <svg viewBox="0 0 900 560" className="h-full min-h-0 w-full">
        <ScienceArrowDefs />
        <defs>
          <filter id="delivery-photo-soft">
            <feGaussianBlur stdDeviation="1.1" />
          </filter>
          <radialGradient id="leaf-real" cx="48%" cy="48%" r="72%">
            <stop offset="0%" stopColor="#86efac" />
            <stop offset="45%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#065f46" />
          </radialGradient>
          <linearGradient id="leaf-vein" x1="0" x2="1">
            <stop offset="0%" stopColor="#064e3b" />
            <stop offset="50%" stopColor="#bbf7d0" />
            <stop offset="100%" stopColor="#064e3b" />
          </linearGradient>
          <filter id="soft-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="18" stdDeviation="18" floodColor="#064e3b" floodOpacity="0.24" />
          </filter>
        </defs>
        <image href="/lecture-assets/photosynthesis-leaf-lab.png" x="0" y="0" width="900" height="560" preserveAspectRatio="xMidYMid meet" opacity="0.5" filter="url(#delivery-photo-soft)" className="science-camera-drift" />
        <rect width="900" height="560" rx="34" fill="#03140e" opacity="0.58" />
        <rect x="54" y="96" width="792" height="380" rx="42" fill="#092016" opacity="0.58" stroke="#a7f3d0" strokeOpacity="0.22" />
        <path d="M92 314 C230 146 652 142 812 306 C650 466 244 474 92 314Z" fill="url(#leaf-real)" filter="url(#soft-shadow)" opacity="0.82" className="science-breathe" />
        <path d="M142 314 C310 286 548 286 762 314" stroke="url(#leaf-vein)" strokeWidth="15" strokeLinecap="round" opacity="0.88" className="leaf-vein-flow" />
        <path d="M238 262 C310 284 360 298 442 308" stroke="#bbf7d0" strokeWidth="5" strokeLinecap="round" opacity="0.55" />
        <path d="M346 378 C420 344 528 324 660 310" stroke="#bbf7d0" strokeWidth="5" strokeLinecap="round" opacity="0.46" />
        <g className={cue >= 1 ? "delivery-drop" : "opacity-20"}>
          <circle cx="120" cy="104" r="46" fill="#facc15" className="lecture-pulse-glow" />
          <path d="M174 144 C265 178 338 220 420 272" stroke="#fbbf24" strokeWidth="8" fill="none" markerEnd="url(#science-arrow)" className="photon-stream" />
          <text x="120" y="182" textAnchor="middle" className="fill-amber-50 text-[24px] font-black">sunlight</text>
        </g>
        <g className={cue >= 2 ? "delivery-drop" : "opacity-20"} color="#2563eb">
          <path d="M246 526 C250 450 292 410 368 364 C428 328 452 306 458 280" fill="none" stroke="#7dd3fc" strokeWidth="14" strokeLinecap="round" markerEnd="url(#science-arrow)" opacity="0.92" />
          <text x="250" y="500" className="fill-sky-100 text-[26px] font-black">water from roots</text>
          <circle cx="244" cy="456" r="9" fill="#38bdf8" className="water-rise" />
          <circle cx="300" cy="412" r="7" fill="#bae6fd" className="water-rise" style={{ animationDelay: "220ms" }} />
          <circle cx="374" cy="358" r="6" fill="#e0f2fe" className="water-rise" style={{ animationDelay: "420ms" }} />
        </g>
        <g className={cue >= 3 ? "delivery-drop" : "opacity-20"} color="#334155">
          <text x="744" y="112" textAnchor="middle" className="fill-slate-100 text-[32px] font-black co2-float">CO₂</text>
          <path d="M732 132 C696 178 662 222 620 286" fill="none" stroke="#cbd5e1" strokeWidth="8" strokeLinecap="round" markerEnd="url(#science-arrow)" strokeDasharray="14 14" className="gas-drift" />
          <ellipse cx="606" cy="342" rx="62" ry="21" fill="#064e3b" opacity="0.9" />
          <ellipse cx="582" cy="342" rx="23" ry="8" fill="#bbf7d0" />
          <ellipse cx="630" cy="342" rx="23" ry="8" fill="#bbf7d0" />
          <path d="M606 326 C596 338 596 348 606 360 C616 348 616 338 606 326Z" fill="#052e16" opacity="0.7" />
          <text x="680" y="366" className="fill-emerald-50 text-[22px] font-black">stomata pore</text>
        </g>
        <g className={cue >= 5 ? "diagram-pop" : "opacity-0"}>
          <rect x="322" y="74" width="260" height="78" rx="24" fill="#052e16" stroke="#bbf7d0" strokeOpacity="0.22" />
          <text x="452" y="122" textAnchor="middle" className="fill-white text-[30px] font-black">all inputs delivered</text>
        </g>
      </svg>
    </ScienceFrame>
  );
}

function ChloroplastVisual({ cue }: { cue: number }) {
  return (
    <ScienceFrame title="Microscope zoom: cell → chloroplast → thylakoids">
      <svg viewBox="0 0 900 560" className="h-full min-h-0 w-full">
        <ScienceArrowDefs />
        <defs>
          <filter id="microscope-grain" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.018 0.045" numOctaves="3" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="6" />
          </filter>
          <filter id="cell-depth-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="24" stdDeviation="22" floodColor="#020617" floodOpacity="0.34" />
          </filter>
          <radialGradient id="cell-bg" cx="45%" cy="45%" r="65%">
            <stop offset="0%" stopColor="#d9f99d" />
            <stop offset="52%" stopColor="#4ade80" />
            <stop offset="100%" stopColor="#047857" />
          </radialGradient>
          <radialGradient id="chloroplast-body" cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#bef264" />
            <stop offset="55%" stopColor="#65a30d" />
            <stop offset="100%" stopColor="#365314" />
          </radialGradient>
          <radialGradient id="scope-bg" cx="50%" cy="45%" r="72%">
            <stop offset="0%" stopColor="#12321f" />
            <stop offset="58%" stopColor="#071d13" />
            <stop offset="100%" stopColor="#020617" />
          </radialGradient>
          <filter id="cell-shadow" x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="0" dy="20" stdDeviation="20" floodColor="#14532d" floodOpacity="0.22" />
          </filter>
        </defs>
        <rect width="900" height="560" rx="34" fill="url(#scope-bg)" />
        <circle cx="450" cy="280" r="232" fill="#dcfce7" opacity="0.06" />
        <circle cx="450" cy="280" r="190" fill="none" stroke="#bbf7d0" strokeOpacity="0.18" strokeWidth="2" />
        <ellipse cx="338" cy="292" rx="274" ry="182" fill="url(#cell-bg)" stroke="#bbf7d0" strokeWidth="5" filter="url(#cell-depth-shadow)" opacity="0.94" className="microscope-float" />
        <ellipse cx="338" cy="292" rx="242" ry="158" fill="none" stroke="#ecfccb" strokeWidth="2" opacity="0.28" filter="url(#microscope-grain)" />
        {Array.from({ length: 28 }).map((_, i) => (
          <circle
            key={i}
            cx={140 + ((i * 53) % 390)}
            cy={170 + ((i * 37) % 230)}
            r={2 + (i % 4)}
            fill={i % 3 === 0 ? "#ecfccb" : "#064e3b"}
            opacity={i % 3 === 0 ? 0.22 : 0.18}
            className="cell-drift"
            style={{ animationDelay: `${i * 90}ms` }}
          />
        ))}
        <path d="M156 292 C236 220 416 194 560 250" stroke="#ffffff" strokeWidth="10" strokeLinecap="round" opacity="0.22" />
        <text x="330" y="112" textAnchor="middle" className="fill-emerald-50 text-[28px] font-black">leaf cell under microscope</text>
        <g className={cue >= 2 ? "diagram-pop" : "opacity-25"}>
          <ellipse cx="358" cy="300" rx="132" ry="82" fill="url(#chloroplast-body)" stroke="#ecfccb" strokeWidth="5" filter="url(#cell-depth-shadow)" className="chloroplast-orbit" />
          <ellipse cx="358" cy="300" rx="104" ry="58" fill="none" stroke="#d9f99d" strokeWidth="4" opacity="0.7" />
          <text x="358" y="410" textAnchor="middle" className="fill-lime-50 text-[26px] font-black">chloroplast</text>
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <path d={`M292 ${260 + i * 18} C326 ${246 + i * 18} 390 ${246 + i * 18} 424 ${260 + i * 18}`} stroke="#d9f99d" strokeWidth="10" strokeLinecap="round" fill="none" />
              <path d={`M310 ${262 + i * 18} C340 ${256 + i * 18} 380 ${256 + i * 18} 406 ${262 + i * 18}`} stroke="#4d7c0f" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.7" />
            </g>
          ))}
        </g>
        <g className={cue >= 4 ? "diagram-pop" : "opacity-20"}>
          <rect x="614" y="144" width="218" height="268" rx="32" fill="#f0fdf4" fillOpacity="0.92" stroke="#86efac" strokeWidth="5" filter="url(#cell-depth-shadow)" />
          <text x="723" y="194" textAnchor="middle" className="fill-emerald-950 text-[27px] font-black">chlorophyll</text>
          <text x="723" y="232" textAnchor="middle" className="fill-emerald-700 text-[20px] font-bold">pigment in thylakoids</text>
          <path d="M184 116 C326 144 474 168 604 220" stroke="#f59e0b" strokeWidth="8" fill="none" markerEnd="url(#science-arrow)" strokeDasharray="18 12" />
          <circle cx="686" cy="308" r="24" fill="#84cc16" />
          <circle cx="728" cy="308" r="24" fill="#65a30d" />
          <circle cx="770" cy="308" r="24" fill="#4d7c0f" />
          <text x="728" y="364" textAnchor="middle" className="fill-slate-700 text-[18px] font-bold">light-harvesting stack</text>
        </g>
      </svg>
    </ScienceFrame>
  );
}

function MechanismVisual({ cue }: { cue: number }) {
  return (
    <ScienceFrame title="Mechanism: water + CO₂ → glucose">
      <svg viewBox="0 0 900 560" className="h-full min-h-0 w-full">
        <ScienceArrowDefs />
        <defs>
          <radialGradient id="reaction-bg" cx="50%" cy="44%" r="76%">
            <stop offset="0%" stopColor="#172554" />
            <stop offset="48%" stopColor="#0f172a" />
            <stop offset="100%" stopColor="#020617" />
          </radialGradient>
          <filter id="atom-glow" x="-45%" y="-45%" width="190%" height="190%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.4 0 0 0 0 0.78 0 0 0 0 1 0 0 0 0.72 0" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="oxygen-sphere" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#e0f2fe" />
            <stop offset="45%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#0369a1" />
          </radialGradient>
          <radialGradient id="hydrogen-sphere" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#bae6fd" />
          </radialGradient>
          <radialGradient id="carbon-sphere" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#e2e8f0" />
            <stop offset="100%" stopColor="#64748b" />
          </radialGradient>
          <filter id="mol-shadow" x="-35%" y="-35%" width="170%" height="170%">
            <feDropShadow dx="0" dy="16" stdDeviation="12" floodColor="#000000" floodOpacity="0.35" />
          </filter>
        </defs>
        <rect width="900" height="560" rx="34" fill="url(#reaction-bg)" />
        <g opacity="0.22">
          {Array.from({ length: 42 }).map((_, i) => (
            <circle key={i} cx={(i * 83) % 900} cy={70 + ((i * 47) % 420)} r={i % 5 === 0 ? 2.4 : 1.2} fill="#bfdbfe" className="cell-drift" style={{ animationDelay: `${i * 80}ms` }} />
          ))}
        </g>
        <rect x="86" y="112" width="728" height="354" rx="34" fill="#0f172a" fillOpacity="0.72" stroke="#93c5fd" strokeOpacity="0.16" strokeWidth="3" />
        <g className={cue >= 1 ? "diagram-pop molecule-float" : "opacity-25"}>
          <text x="190" y="118" textAnchor="middle" className="fill-sky-200 text-[24px] font-black">water</text>
          <circle cx="190" cy="190" r="31" fill="url(#oxygen-sphere)" filter="url(#atom-glow)" />
          <circle cx="130" cy="226" r="21" fill="url(#hydrogen-sphere)" filter="url(#mol-shadow)" />
          <circle cx="250" cy="226" r="21" fill="url(#hydrogen-sphere)" filter="url(#mol-shadow)" />
          <line x1="164" y1="204" x2="146" y2="217" stroke="#7dd3fc" strokeWidth="7" />
          <line x1="216" y1="204" x2="234" y2="217" stroke="#7dd3fc" strokeWidth="7" />
          <text x="190" y="199" textAnchor="middle" className="fill-sky-950 text-[22px] font-black">O</text>
          <text x="130" y="234" textAnchor="middle" className="fill-sky-950 text-[16px] font-black">H</text>
          <text x="250" y="234" textAnchor="middle" className="fill-sky-950 text-[16px] font-black">H</text>
        </g>
        <g className={cue >= 2 ? "diagram-pop" : "opacity-20"}>
          <circle cx="450" cy="190" r="74" fill="#facc15" opacity="0.14" />
          <path d="M426 112 L486 112 L462 178 L524 178 L392 326 L432 212 L374 212Z" fill="#facc15" filter="url(#atom-glow)" className="photon-bolt" />
          <path d="M450 236 C386 270 310 278 246 292" fill="none" stroke="#facc15" strokeWidth="5" strokeLinecap="round" strokeDasharray="12 12" opacity="0.78" className="photon-stream" />
          <path d="M468 236 C536 270 604 278 654 292" fill="none" stroke="#facc15" strokeWidth="5" strokeLinecap="round" strokeDasharray="12 12" opacity="0.78" className="photon-stream" />
          <text x="450" y="292" textAnchor="middle" className="fill-amber-200 text-[22px] font-black">light energy</text>
        </g>
        <g className={cue >= 3 ? "diagram-pop molecule-float" : "opacity-25"} style={{ animationDelay: "240ms" }}>
          <text x="710" y="118" textAnchor="middle" className="fill-slate-200 text-[24px] font-black">carbon dioxide</text>
          <circle cx="710" cy="190" r="29" fill="url(#carbon-sphere)" filter="url(#atom-glow)" />
          <circle cx="650" cy="190" r="22" fill="#e2e8f0" filter="url(#mol-shadow)" />
          <circle cx="770" cy="190" r="22" fill="#e2e8f0" filter="url(#mol-shadow)" />
          <line x1="672" y1="190" x2="681" y2="190" stroke="#cbd5e1" strokeWidth="7" />
          <line x1="739" y1="190" x2="748" y2="190" stroke="#cbd5e1" strokeWidth="7" />
          <text x="710" y="199" textAnchor="middle" className="fill-slate-950 text-[22px] font-black">C</text>
          <text x="650" y="198" textAnchor="middle" className="fill-slate-950 text-[16px] font-black">O</text>
          <text x="770" y="198" textAnchor="middle" className="fill-slate-950 text-[16px] font-black">O</text>
        </g>
        <g className={cue >= 4 ? "diagram-pop" : "opacity-0"} color="#f8fafc">
          <path d="M246 292 C330 344 390 364 450 372" fill="none" stroke="#bae6fd" strokeWidth="6" markerEnd="url(#science-arrow)" strokeDasharray="16 14" className="reaction-path" />
          <path d="M654 292 C570 344 510 364 450 372" fill="none" stroke="#cbd5e1" strokeWidth="6" markerEnd="url(#science-arrow)" strokeDasharray="16 14" className="reaction-path" />
          <rect x="300" y="316" width="300" height="48" rx="18" fill="#0f172a" stroke="#93c5fd" strokeOpacity="0.24" strokeWidth="2" />
          <text x="450" y="348" textAnchor="middle" className="fill-white text-[20px] font-black">atoms move and recombine</text>
        </g>
        <g className={cue >= 6 ? "sugar-pop" : "opacity-0"}>
          <polygon points="450,386 510,420 510,488 450,522 390,488 390,420" fill="#f59e0b" stroke="#fed7aa" strokeWidth="7" filter="url(#atom-glow)" />
          <polygon points="450,404 492,428 492,476 450,500 408,476 408,428" fill="#fbbf24" opacity="0.26" />
          <text x="450" y="448" textAnchor="middle" className="fill-white text-[30px] font-black">glucose</text>
          <text x="450" y="480" textAnchor="middle" className="fill-amber-100 text-[24px] font-black">C₆H₁₂O₆</text>
        </g>
      </svg>
    </ScienceFrame>
  );
}

function OutputsVisual({ cue }: { cue: number }) {
  return (
    <ScienceFrame title="Outputs: glucose stays, oxygen exits through stomata">
      <svg viewBox="0 0 900 560" className="h-full min-h-0 w-full">
        <ScienceArrowDefs />
        <defs>
          <filter id="output-photo-soft">
            <feGaussianBlur stdDeviation="1" />
          </filter>
          <radialGradient id="leaf-output" cx="48%" cy="42%" r="72%">
            <stop offset="0%" stopColor="#4ade80" />
            <stop offset="62%" stopColor="#16a34a" />
            <stop offset="100%" stopColor="#047857" />
          </radialGradient>
          <radialGradient id="oxygen-glass" cx="32%" cy="28%" r="72%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.94" />
            <stop offset="42%" stopColor="#7dd3fc" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#0284c7" stopOpacity="0.78" />
          </radialGradient>
          <filter id="output-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="20" stdDeviation="18" floodColor="#064e3b" floodOpacity="0.24" />
          </filter>
        </defs>
        <image href="/lecture-assets/photosynthesis-leaf-lab.png" x="0" y="0" width="900" height="560" preserveAspectRatio="xMidYMid meet" opacity="0.44" filter="url(#output-photo-soft)" className="science-camera-drift" />
        <rect width="900" height="560" rx="34" fill="#03140e" opacity="0.56" />
        <rect x="64" y="108" width="772" height="370" rx="42" fill="#0a1f17" opacity="0.68" stroke="#bae6fd" strokeOpacity="0.18" />
        <path d="M100 348 C246 198 638 198 800 340 C624 462 282 468 100 348Z" fill="url(#leaf-output)" filter="url(#output-shadow)" opacity="0.88" className="science-breathe" />
        <path d="M160 348 C326 318 544 318 748 348" stroke="#064e3b" strokeWidth="14" strokeLinecap="round" opacity="0.76" className="leaf-vein-flow" />
        <ellipse cx="462" cy="350" rx="60" ry="20" fill="#064e3b" />
        <ellipse cx="438" cy="350" rx="22" ry="8" fill="#bbf7d0" />
        <ellipse cx="486" cy="350" rx="22" ry="8" fill="#bbf7d0" />
        <g className={cue >= 1 ? "diagram-pop" : "opacity-25"}>
          <polygon points="236,292 292,324 292,388 236,420 180,388 180,324" fill="#f59e0b" stroke="#fed7aa" strokeWidth="6" filter="url(#output-shadow)" />
          <polygon points="236,312 274,334 274,378 236,400 198,378 198,334" fill="#fbbf24" opacity="0.26" />
          <text x="236" y="366" textAnchor="middle" className="fill-white text-[28px] font-black">glucose</text>
          <text x="236" y="450" textAnchor="middle" className="fill-amber-50 text-[22px] font-black">stored as plant food</text>
        </g>
        <g className={cue >= 4 ? "diagram-pop" : "opacity-0"} color="#2563eb">
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i} className="oxygen-bubble" style={{ animationDelay: `${i * 140}ms` }}>
              <circle cx={520 + i * 50} cy={310 - i * 36} r="20" fill="url(#oxygen-glass)" opacity="0.88" />
              <circle cx={512 + i * 50} cy={302 - i * 36} r="6" fill="#e0f2fe" opacity="0.9" />
              <text x={520 + i * 50} y={318 - i * 36} textAnchor="middle" className="fill-blue-950 text-[16px] font-black">O₂</text>
            </g>
          ))}
          <path d="M500 336 C570 286 636 222 722 116" fill="none" stroke="#7dd3fc" strokeWidth="7" markerEnd="url(#science-arrow)" className="gas-drift" />
          <text x="724" y="92" textAnchor="middle" className="fill-sky-100 text-[28px] font-black">oxygen exits</text>
        </g>
      </svg>
    </ScienceFrame>
  );
}

function MirrorRecipeVisual({ cue }: { cue: number }) {
  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-[1.75rem] bg-[#07111f] p-6 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_26%,rgba(34,197,94,0.28),transparent_38%),radial-gradient(circle_at_78%_22%,rgba(56,189,248,0.24),transparent_38%)]" />
      <div className="relative grid h-full min-h-0 gap-4 md:grid-cols-2">
        <RecipeCard active={cue >= 1} title="Plant" input="Light + H₂O + CO₂" output="Sugar + O₂" tone="green" />
        <RecipeCard active={cue >= 3} title="You" input="Sugar + O₂" output="Energy + CO₂" tone="blue" />
        <div className={`md:col-span-2 rounded-3xl border border-white/10 bg-white/10 p-5 text-center text-2xl font-black text-white shadow-2xl backdrop-blur transition ${cue >= 6 ? "diagram-pop" : "opacity-25"}`}>Opposite recipes. Shared air.</div>
      </div>
    </div>
  );
}

function RecipeCard({ active, title, input, output, tone }: { active: boolean; title: string; input: string; output: string; tone: "green" | "blue" }) {
  return (
    <div className={`grid place-items-center rounded-3xl border border-white/10 p-6 text-center shadow-2xl backdrop-blur transition ${active ? "diagram-pop opacity-100" : "opacity-25"} ${tone === "green" ? "bg-emerald-400/20" : "bg-sky-400/20"}`}>
      <div>
        <p className="text-4xl font-black text-white">{title}</p>
        <p className="mt-8 rounded-2xl border border-white/10 bg-white/90 p-4 text-xl font-black text-slate-950 shadow-xl">{input}</p>
        <p className="my-5 text-4xl font-black text-white/55">↓</p>
        <p className="rounded-2xl border border-white/10 bg-white/90 p-4 text-xl font-black text-slate-950 shadow-xl">{output}</p>
      </div>
    </div>
  );
}

function EarthSystemVisual({ cue }: { cue: number }) {
  return (
    <ScienceFrame title="Global impact: food chains and breathable oxygen">
      <svg viewBox="0 0 900 560" className="h-full min-h-0 w-full">
        <ScienceArrowDefs />
        <defs>
          <filter id="earth-glow" x="-45%" y="-45%" width="190%" height="190%">
            <feGaussianBlur stdDeviation="12" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.16 0 0 0 0 0.54 0 0 0 0 1 0 0 0 0.68 0" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="earth-grad" cx="42%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#93c5fd" />
            <stop offset="55%" stopColor="#2563eb" />
            <stop offset="100%" stopColor="#1e3a8a" />
          </radialGradient>
        </defs>
        <rect width="900" height="560" rx="34" fill="#020617" />
        <g opacity="0.55">
          {Array.from({ length: 48 }).map((_, i) => (
            <circle key={i} cx={(i * 79) % 900} cy={28 + ((i * 41) % 500)} r={i % 7 === 0 ? 2 : 1} fill="#dbeafe" className="cell-drift" style={{ animationDelay: `${i * 70}ms` }} />
          ))}
        </g>
        <circle cx="450" cy="288" r="154" fill="url(#earth-grad)" filter="url(#earth-glow)" className="earth-drift" />
        <path d="M334 254 C388 218 430 228 468 262 C512 302 572 286 604 326 C542 380 436 390 338 334Z" fill="#22c55e" opacity="0.9" className="earth-cloud-drift" />
        <path d="M486 166 C548 182 600 220 628 278" stroke="#bfdbfe" strokeWidth="10" strokeLinecap="round" opacity="0.45" className="earth-cloud-drift" />
        <circle cx="450" cy="288" r="190" fill="none" stroke="#93c5fd" strokeWidth="2" opacity="0.25" />
        <circle cx="450" cy="288" r="178" fill="#38bdf8" opacity="0.05" />
        <g className={cue >= 1 ? "diagram-pop" : "opacity-25"}>
          <rect x="98" y="350" width="230" height="84" rx="26" fill="#ffffff" fillOpacity="0.92" />
          <text x="213" y="402" textAnchor="middle" className="fill-slate-950 text-[28px] font-black">food chains</text>
          <path d="M328 386 C366 352 392 330 420 306" stroke="#ffffff" strokeWidth="7" fill="none" markerEnd="url(#science-arrow)" />
        </g>
        <g className={cue >= 3 ? "diagram-pop" : "opacity-25"} color="#38bdf8">
          <rect x="588" y="350" width="230" height="84" rx="26" fill="#bae6fd" />
          <text x="703" y="402" textAnchor="middle" className="fill-blue-950 text-[28px] font-black">atmosphere O₂</text>
          <path d="M588 386 C540 356 510 330 480 306" stroke="currentColor" strokeWidth="7" fill="none" markerEnd="url(#science-arrow)" />
        </g>
      </svg>
    </ScienceFrame>
  );
}

function RecapVisual({ cue }: { cue: number }) {
  const steps = [
    { label: "Delivery", detail: "sunlight + water + CO2", color: "#38bdf8", x: 126, y: 360 },
    { label: "Kitchen", detail: "chloroplast", color: "#22c55e", x: 300, y: 244 },
    { label: "Cooking", detail: "light energy rearranges atoms", color: "#f59e0b", x: 480, y: 360 },
    { label: "Meal", detail: "glucose stored", color: "#f97316", x: 650, y: 244 },
    { label: "Exhaust", detail: "oxygen exits", color: "#60a5fa", x: 780, y: 360 },
  ];

  return (
    <ScienceFrame title="Final recap: the whole photosynthesis system">
      <svg viewBox="0 0 900 560" className="h-full min-h-0 w-full">
        <ScienceArrowDefs />
        <defs>
          <radialGradient id="recap-board-bg" cx="50%" cy="45%" r="78%">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="62%" stopColor="#ecfeff" />
            <stop offset="100%" stopColor="#d1fae5" />
          </radialGradient>
          <radialGradient id="recap-leaf" cx="42%" cy="36%" r="72%">
            <stop offset="0%" stopColor="#86efac" />
            <stop offset="58%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#047857" />
          </radialGradient>
          <filter id="recap-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="18" stdDeviation="16" floodColor="#0f172a" floodOpacity="0.18" />
          </filter>
          <filter id="recap-photo-soft">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
        </defs>

        <image href="/lecture-assets/photosynthesis-leaf-lab.png" x="0" y="0" width="900" height="560" preserveAspectRatio="xMidYMid meet" opacity="0.44" filter="url(#recap-photo-soft)" className="science-camera-drift" />
        <rect width="900" height="560" rx="34" fill="#03140e" opacity="0.62" />
        <rect x="52" y="118" width="796" height="344" rx="46" fill="#ffffff" fillOpacity="0.9" stroke="#dbeafe" strokeWidth="4" />
        <text x="450" y="164" textAnchor="middle" className="fill-slate-900 text-[34px] font-black">
          Photosynthesis in one picture
        </text>
        <text x="450" y="198" textAnchor="middle" className="fill-slate-500 text-[18px] font-bold">
          delivery → chloroplast kitchen → atom rearrangement → glucose + oxygen
        </text>

        <path d="M104 340 C240 210 616 206 802 334 C618 456 270 464 104 340Z" fill="url(#recap-leaf)" filter="url(#recap-shadow)" opacity="0.96" className="science-breathe" />
        <path d="M150 340 C318 310 542 310 760 340" stroke="#064e3b" strokeWidth="12" strokeLinecap="round" opacity="0.75" />
        <path d="M318 292 C390 312 458 326 550 336" stroke="#bbf7d0" strokeWidth="5" strokeLinecap="round" opacity="0.48" />
        <path d="M370 390 C452 358 540 344 668 336" stroke="#bbf7d0" strokeWidth="5" strokeLinecap="round" opacity="0.4" />

        <g color="#0f172a" opacity="0.7">
          {steps.slice(0, -1).map((step, i) => {
            const next = steps[i + 1];
            return (
              <path
                key={`${step.label}-${next.label}`}
                d={`M${step.x + 58} ${step.y} C${step.x + 108} ${step.y - 86} ${next.x - 108} ${next.y + 86} ${next.x - 58} ${next.y}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="5"
                strokeDasharray="12 12"
                markerEnd="url(#science-arrow)"
              />
            );
          })}
        </g>

        {steps.map((step, i) => {
          const active = cue >= i;
          return (
            <g key={step.label} className={active ? "diagram-pop" : "opacity-20"}>
              <circle cx={step.x} cy={step.y} r="58" fill="#ffffff" stroke={step.color} strokeWidth="7" filter="url(#recap-shadow)" />
              <circle cx={step.x} cy={step.y} r="34" fill={step.color} opacity="0.18" />
              <text x={step.x} y={step.y - 6} textAnchor="middle" className="fill-slate-950 text-[18px] font-black">
                {i + 1}
              </text>
              <text x={step.x} y={step.y + 19} textAnchor="middle" className="fill-slate-950 text-[17px] font-black">
                {step.label}
              </text>
              <rect x={step.x - 80} y={step.y + 72} width="160" height="44" rx="16" fill="#ffffff" stroke="#e2e8f0" strokeWidth="2" />
              <text x={step.x} y={step.y + 100} textAnchor="middle" className="fill-slate-600 text-[12px] font-bold">
                {step.detail}
              </text>
            </g>
          );
        })}

        <g className={cue >= 5 ? "diagram-pop" : "opacity-0"}>
          <rect x="270" y="470" width="360" height="58" rx="20" fill="#052e16" />
          <text x="450" y="507" textAnchor="middle" className="fill-white text-[22px] font-black">
            light becomes stored chemical energy
          </text>
        </g>
      </svg>
    </ScienceFrame>
  );
}
