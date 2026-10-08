"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SlideStage } from "./SlideStage";
import { TeacherAvatar } from "./TeacherAvatar";
import { beats as demoBeats, type Beat } from "@/lib/lessonContent";
import { unlockAudio, splitNarrationSentences, playNarration, type NarrationHandle } from "@/lib/voice";
import { scriptClockFromNarration, sentenceWeight, timingFromProgress } from "@/lib/narrationClock";
import { animationChipDetail } from "@/lib/animationModels";
import { useVoiceDirector, type VoiceDirector } from "@/lib/useVoiceDirector";
import { usePlaybackRate } from "@/lib/playbackPrefs";
import { useLessonMachine } from "@/lib/lessonMachine";
import { backstopRecovery, narrationRecovery } from "@/lib/narrationRecovery";
import { isAdaptiveQuestion } from "@/lib/adaptiveQuestion";
import { useTeacherQuiz } from "@/lib/useTeacherQuiz";
import { QuizPrompt } from "./QuizPrompt";
import { LiveSketch } from "./sketch/LiveSketch";
import { AnnotationLayer, type BoardTool } from "@/components/board/AnnotationLayer";
import { strokesFor } from "@/lib/board/annotations";
import { BoardDock } from "@/components/board/BoardDock";
import { PdfSourcePanel } from "@/components/teaching/PdfSourcePanel";
import { SourceFigureBoard, activeFigureIndex, sourceFiguresFor } from "@/components/teaching/SourceFigureBoard";
import { BoardStage } from "@/components/board/BoardStage";
import { EMPTY_ANNOTATIONS, canUndo as annCanUndo, clearKind, undo as annUndo } from "@/lib/board/annotations";
import { buildLessonTeachingMap, conceptProgress } from "@/lib/board/teachingState";
import { coordinateTeachingTimeline } from "@/lib/board/teachingTimeline";
import { captureSelectedBoardRegion } from "@/lib/board/captureSelection";
import { visibleSandboxText } from "@/lib/board/sandboxBridge";
import { boundsOf, buildExplainRequest, marksNarrative, type ExplainRequest } from "@/lib/board/selection";
import { picturePartsInMark } from "@/lib/board/markContext";
import type { AnnotationStroke } from "@/lib/board/annotations";
import { ReactAnimationSandbox, warmSandbox } from "./sketch/ReactAnimationSandbox";
import { ManimBoard } from "./sketch/ManimBoard";
import { GsapSketch } from "./sketch/GsapSketch";
import { StructureBoard } from "./sketch/StructureBoard";
import { PlotBoard } from "./sketch/PlotBoard";
import { EquationBoard } from "./sketch/EquationBoard";
import { CodeBoard } from "./sketch/CodeBoard";
import type { StructureSpec } from "@/lib/structureSpec";
import type { PlotSpec } from "@/lib/plotSpec";
import type { EquationSpec } from "@/lib/equationSpec";
import type { CodeSpec } from "@/lib/codeSpec";
import { BoardTelemetry, RendererBadge } from "./sketch/RendererBadge";
import { RevisitOverlay } from "./RevisitOverlay";
import { REVISIT_SLIDE_TOOL } from "@/lib/geminiLiveContract";
import { boardWordsOf, findRevisitTarget, revisitMarks, type RevisitMark } from "@/lib/revisit";
import { recordJsonCost } from "@/lib/costLedger";
import { AdhdLayer } from "./adhd/AdhdLayer";
import { AdhdScoreChip } from "./adhd/AdhdScoreChip";
import { emitAdhdEvent, onAdhdCheckin, onAdhdFace, onAdhdSpeech, publishAdhdCheckin } from "@/lib/adhd/events";
import { mcqForCheckpoint, checkpointDueAt, questionSourceFor } from "@/lib/adhd/games/mcq";
import { MazeGame } from "@/components/adhd/games/MazeGame";
import { buildDocumentContext, buildLessonContext, describeBoard, type PlannedPart } from "@/lib/lessonChatContext";
import { isVideoSource } from "@/lib/youtube/videoSource";
import type { Expression } from "@/lib/adhd/expression";
import { ChevronLeft, Download, Highlighter, Loader2, LogOut, Pause, Pencil, Play, RotateCcw, SkipForward } from "lucide-react";
import { IconButton } from "@/components/classroom/IconButton";
import { VoiceState, derivePhase, type VoicePhase } from "@/components/classroom/VoiceState";
import { AvatarFlyer } from "@/components/avatar/AvatarFlyer";
import type { AvatarState } from "@/lib/avatar/face";
import { isSuprnotesLessonInput } from "@/lib/suprnotes";
import { sentenceIsGrounded, sourceVocabulary, splitSentences } from "@/lib/sourceGrounding";
import { isPauseIntent, isResumeIntent } from "@/lib/voice/lectureIntent";
import { useManimPrefetch } from "@/lib/useManimPrefetch";
import { useNarrationPrefetch } from "@/lib/useNarrationPrefetch";
import { selectAnimationRenderer } from "@/lib/animationRouting";
import type { LearnerAdaptiveSignal } from "@/lib/progressiveLectureTypes";
import { useLessonChat, ChatPanel, ExplainOverlay, TeacherDrawingNotice } from "./lesson-chat/LessonChat";
import { HudCorners } from "./hud/HudKit";
import { useGeminiLiveTutor, type GeminiLiveBoard } from "@/lib/useGeminiLiveTutor";
import type { SourceScope } from "@/lib/sourceScope";
import { beatSourceGroundingFor, isStrictScope, referenceVoicePartContext, strictVoicePartContext, withStrictSourceHeader } from "@/lib/strictSourceAnswers";
import { useEngagementScore } from "@/lib/useEngagementScore";
import { EngagementMeter } from "./EngagementMeter";
import { FocusPauseOverlay } from "./FocusPauseOverlay";
import { LessonCanvas, type CanvasKnowledge, type CanvasPanelInput } from "./canvas/LessonCanvas";
import { BoardPeek, type PeekTarget } from "./knowledge/BoardPeek";
import type { CanvasBoardSpec } from "@/lib/canvas/types";
import { CheckinOverlay } from "./adhd/CheckinOverlay";
import { CHECKIN_INVITE_CUE } from "@/lib/geminiLiveContract";
import { DrawOverlay } from "./sketch/DrawOverlay";
import { HighlightOverlay, type HlStroke } from "./sketch/HighlightOverlay";
import { DeafSigningExtension } from "./sign-language/DeafSigningExtension";
import { openingSentence, transitionSentence } from "@/lib/beatPresentation";

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
/**
 * THE TITLE CARD'S MAXIMUM DWELL — a ceiling, not a delay.
 *
 * This used to be an unconditional `setTimeout(SLIDE_MS)` between every beat: the board was
 * unmounted, a full-screen title sat there for a flat 1500ms, and only then did the board mount and
 * narration begin. Stacked with the 850ms card fade and the board's own 900ms draw-in, the student
 * watched several seconds of nothing between every explanation, and the cost was paid even when the
 * board had been ready the whole time.
 *
 * The board now mounts WITH the title, and the title yields as soon as the board has actually
 * painted (`onBoardReady`, a double-rAF after mount — one frame to lay out, one to paint). This
 * value only bounds the wait for a board that never reports, so a stall degrades to the old
 * behaviour instead of hanging.
 */
const SLIDE_MS = 1500;
/**
 * The floor under the title card.
 *
 * Without one, a cached board paints on the next frame and the title flashes past unread, which is
 * its own kind of broken — the card exists to name the section before it is taught. Long enough to
 * read three or four words, short enough not to feel like waiting.
 */
const TITLE_MIN_MS = 480;
/**
 * How long the card waits for the VOICE to start before giving up on it.
 *
 * "Ready to explain" means the teacher is speaking as well as the board being drawn. A cold
 * /api/tts call can take 6-8s, and revealing the board before the voice arrives puts a mute,
 * unwritten board on screen — every teaching element is hidden until narration reaches its
 * sentence, so there is nothing to look at. Bounded so a blocked or failed voice cannot trap the
 * card: after this the card follows the board alone.
 */
const VOICE_WAIT_MAX_MS = 8_000;
/**
 * The longest the title card may cover a board that is still being generated.
 *
 * The card's job is to hold the screen while the board's content is fetched, so this must outlast
 * the pending-content timeout (ANIMATION_PENDING_TIMEOUT_MS, 10s) — otherwise the card would give
 * up FIRST and reveal the very empty board it exists to hide. It also has to outlast a cold voice
 * (up to VOICE_WAIT_MAX_MS) PLUS a spoken bridge sentence, which together can approach fifteen
 * seconds; a board that gives up shows its own status card, so a generous ceiling costs nothing.
 * Counted from when the lecture starts playing, not from when the beat mounts.
 */
const BOARD_WAIT_MAX_MS = 20_000;
// Safety net: a beat whose animation/board op never resolves (still no `code`/`ops`, e.g. a
// server that didn't generate it) would otherwise hold the lecture on its slide forever. After this
// long we stop waiting and let the lecture proceed (the board shows its status card meanwhile).
const ANIMATION_PENDING_TIMEOUT_MS = 10_000;
// Same shape of safety net, for the voice: how long a lecture may sit frozen while the tutor hook's
// React state says nobody is speaking, before we conclude its refs are lying and continue anyway.
// Long enough that a real hand-off (she stops, the turn settles, the resume lands) finishes first.
const NARRATION_STALL_MS = 6_000;

/**
 * Dev-only playback trace. The board follows the voice's sentence cues, and a board stuck on its
 * title is invisible in the server log — `next dev` forwards these lines to it, so a stall can be
 * read after the fact (which step stopped: the start, a cue, a hold by the chatbot, the recovery).
 */
function tracePlayback(event: string, detail: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === "production") return;
  console.log(`[playback] ${event} ${JSON.stringify(detail)}`);
}
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


/** "Yes", "sure, go ahead", "okay let's do it" — a short reply agreeing to her invitation to go on. */
function isShortAgreement(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!,]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.includes("?") || t.split(" ").length > 6) return false;
  return /^(?:(?:hey |ok(?:ay)? )?(?:aria |arya )?)?(?:yes|yeah|yep|yup|sure|ok|okay|alright|all right|fine|ready|i'?m ready|let'?s (?:do it|go)|go ahead|go on|haan|han|ji|theek hai)\b/.test(t);
}

/** Event-time clock for callbacks (the React compiler reads a bare Date.now() in them as render). */
const wallClock = () => Date.now();

/** How long a finished board stays on screen after its narration ends, before the next slide. */
const BOARD_HOLD_AFTER_NARRATION_MS = 2500;

export function LessonPlayer({
  onExit,
  onCheckpointGraded,
  onComplete,
  onUnderstood,
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
  ocrTranscript = "",
  documentId = "",
  lessonQuestion = "",
  fullDocumentText = "",
  hasMoreBeats = false,
  totalBeatCount,
  plannedParts,
  onBeatIndexChange,
  onLearnerInteraction,
  onSummarize,
  summaryUnlocked = false,
  selectionPages = [],
  sourceScope,
  captions = false,
}: {
  onExit?: () => void;
  /**
   * The student asked for captions (onboarding's accessibility screen, or settings): what Aria says
   * is written across the bottom of the board in every lesson — not only in the Deaf track.
   */
  captions?: boolean;
  /**
   * Fired whenever a checkpoint is graded, so the learner model keeps updating while teaching.
   *
   * MICRO-ADAPTATION. The profile built before the lesson decides where it starts; this is what
   * keeps it honest afterwards. A student who sails through every checkpoint has demonstrated more
   * than their pre-lesson conversation suggested, and one who struggles has demonstrated less —
   * either way the NEXT lesson should not repeat the same misjudgement.
   *
   * Optional, and never awaited: a failure to record must not interrupt a lecture in progress.
   */
  onCheckpointGraded?: (result: { concept: string; correct: boolean; revealed: boolean }) => void;
  /** Fired once, when the last beat finishes playing (natural end of lecture) — distinct from
   *  onExit, which fires on a manual exit at any point. */
  onComplete?: () => void;
  /** The "Got it" button: the student understood, so the lesson ends now (see BoardDock). */
  onUnderstood?: () => void;
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
  /** What was read off the page images. The chat cannot answer about a formula without it. */
  ocrTranscript?: string;
  /** Handle for the parked page images, so the chat can LOOK at the page it is asked about. */
  documentId?: string;
  /** The question this lecture was built to answer, so the chat knows what it is FOR. */
  lessonQuestion?: string;
  /**
   * Every page's text, including pages the student did NOT select.
   *
   * The lecture is built only from the selection; questions asked during it are not restricted to
   * it, because a student reading page 4 will ask about page 7.
   */
  fullDocumentText?: string;
  /** True while the progressive worker is still appending future beats. */
  hasMoreBeats?: boolean;
  totalBeatCount?: number;
  /** Every planned part, generated or not, so the chat can point to parts not written yet. Absent for strict. */
  plannedParts?: PlannedPart[];
  onBeatIndexChange?: (index: number) => void;
  onLearnerInteraction?: (signal: LearnerAdaptiveSignal) => void;
  /** Opens the one-slide summary of the lecture; the caller owns it (components/LectureSummarySlide). */
  onSummarize?: () => void;
  /** True once the student has finished this lecture — the summary button is disabled until then. */
  summaryUnlocked?: boolean;
  /** Pages the student dragged an area on, when this lecture was built "from this area". */
  selectionPages?: number[];
  /** Explicit source contract chosen after page selection; enables the synchronized PDF workspace. */
  sourceScope?: SourceScope;
}) {
  const [index, setIndex] = useState(0);
  const displayBeatCount = Math.max(1, totalBeatCount ?? beats.length);
  const [waitingForNextBeat, setWaitingForNextBeat] = useState(false);
  useEffect(() => onBeatIndexChange?.(index), [index, onBeatIndexChange]);
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
  /*
   * Has this beat's board actually painted?
   *
   * The title card used to cover a fixed 1500ms whether or not the board behind it was ready. The
   * board now mounts with the card and reports its first paint here, so the card can hand over the
   * moment there is something to hand over to.
   */
  const [boardPainted, setBoardPainted] = useState(false);
  /** When the current title card went up, so its minimum dwell is measured from the right instant. */
  const titleShownAtRef = useRef(performance.now());
  const handleBoardPainted = useCallback(() => setBoardPainted(true), []);
  /** The generated animation has run and is listening — the moment a sandbox board is visible. */
  const [sandboxReady, setSandboxReady] = useState(false);
  const handleSandboxReady = useCallback(() => setSandboxReady(true), []);
  /** The bounded wait for the voice to start has expired; the card follows the board alone now. */
  const [voiceWaited, setVoiceWaited] = useState(false);
  // Load Babel and the sandbox React runtime now, while the student is reading the first title,
  // instead of on the first animated beat where every millisecond is a card over an empty board.
  useEffect(() => {
    warmSandbox();
  }, []);
  /**
   * Is the section card currently covering the board?
   *
   * Deliberately NOT tied to `stage`. `stage` only advances while the lecture is playing, so a card
   * gated on it sits over the board forever whenever the lecture is paused or has not been started
   * — which is exactly what a student sees on opening a lesson. The card announces a section and
   * then yields as soon as the board has painted, whether or not anyone has pressed play.
   */
  const [cardDismissed, setCardDismissed] = useState(false);
  useEffect(() => {
    if (!waitingForNextBeat) return;
    queueMicrotask(() => {
      if (index < beats.length - 1) {
        setWaitingForNextBeat(false);
        setIndex(index + 1);
        setStage("slide");
      } else if (!hasMoreBeats) {
        setWaitingForNextBeat(false);
        onComplete?.();
      }
    });
  }, [waitingForNextBeat, index, beats.length, hasMoreBeats, onComplete]);
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  const voiceBlockedRef = useRef(false);
  useEffect(() => {
    voiceBlockedRef.current = voiceBlocked;
  }, [voiceBlocked]);
  /** The banner is up only because Live Aria's output is held (see onOutputBlocked). */
  const blockedLiveOnlyRef = useRef(false);
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
  /** The beat whose narration is playing and has not finished (see the narration effect's cleanup). */
  const narrationLiveForRef = useRef<number | null>(null);
  /** The beat whose narration was cancelled before it finished — lost, so it must restart. */
  const narrationLostForRef = useRef<number | null>(null);
  /** Set by the stall backstop only: the next start overrides a channel refusal it has judged stale. */
  const forceNextStartRef = useRef(false);
  /*
   * DEVELOPMENT ONLY — never present in a production build.
   *
   * Lets a browser test reproduce the "Pause on the button, nothing heard" stall. `restartNarration`
   * does exactly what the mode effect's old fallback did when Aria still held the channel: re-run the
   * narration effect, whose cleanup cancels the beat that is playing. Used by
   * scripts/test-stuck-lecture.mjs; there is no other way to reach that path without a live voice.
   */
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const target = window as unknown as { __ariaLecture?: { restartNarration: () => void } };
    target.__ariaLecture = { restartNarration: () => setStartNonce((n) => n + 1) };
    return () => {
      delete target.__ariaLecture;
    };
  }, []);
  const [drawProgress, setDrawProgress] = useState(0);
  /*
   * The student's playback speed, remembered between lectures (lib/playbackPrefs.ts).
   *
   * Read by the narration effect through `rateRef`, NOT as a dependency. As a dependency, touching
   * the speed control ran that effect's cleanup — which cancels the narration — and replayed the beat
   * from its first sentence. The change is pushed into the running narration instead, below.
   */
  const [rate, setRate] = usePlaybackRate();
  const rateRef = useRef(rate);
  useEffect(() => { rateRef.current = rate; }, [rate]);
  const slideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beat = beats[index];
  const teachingMap = useMemo(() => buildLessonTeachingMap(beats), [beats]);
  const teachingEntry = teachingMap.entries[index];
  /*
   * Is this beat another pass over the subtopic already on the board?
   *
   * When it is, the board continues: no title card, no entrance, no pause — it slides down and
   * keeps writing under the work already there. Read from the teaching map rather than from the
   * beat alone so a lesson whose beats predate concept ids still behaves exactly as before.
   */
  const continuesConcept = teachingEntry?.move === "continue";
  const teachingProgress = useMemo(() => conceptProgress(teachingMap, index), [teachingMap, index]);
  const priorBoardSections = useMemo(
    () => beats
      .slice(0, index)
      .filter((pastBeat) => pastBeat.slideKind !== "checkpoint")
      .slice(-5)
      .map((pastBeat) => {
        const sentences = splitNarrationSentences(pastBeat.script);
        return {
          key: pastBeat.id,
          node: (
            <Board
              beat={pastBeat}
              sentenceCue={{
                index: Math.max(0, sentences.length - 1),
                total: Math.max(1, sentences.length),
                text: sentences[sentences.length - 1] ?? pastBeat.script,
              }}
              drawProgress={1}
            />
          ),
        };
      }),
    [beats, index],
  );
  // Future beats arrive while the current one is playing. Keep tail state current without making
  // the current narration effect depend on it: changing `beats.length`, `hasMoreBeats`, or an
  // inline parent callback must never cancel and replay the audio already in progress.
  const playbackTailRef = useRef({ beatsLength: beats.length, hasMoreBeats, onComplete });
  useEffect(() => {
    playbackTailRef.current = { beatsLength: beats.length, hasMoreBeats, onComplete };
  }, [beats.length, hasMoreBeats, onComplete]);

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

  const standardTransitionsEnabled = mode === "standard" && !adhd;

  // Same reasoning as the Manim prefetch above, applied to the voice. A cold /api/tts call is 6-8s
  // for a beat-length script; the board is driven by the audio clock, so until that audio exists
  // nothing moves and the lesson looks desynchronised from the narration. Warming the next couple
  // of beats turns each of those into a ~12ms cache hit by the time the student arrives.
  useNarrationPrefetch(
    useMemo(() => beats.map((b, beatIndex) => {
      if (!standardTransitionsEnabled || isCanvasBeat(b)) return b.script ?? "";
      const bridge = beatIndex === 0
        ? openingSentence(b.transitionIn, title)
        : transitionSentence(b.transitionIn, beats[beatIndex - 1]?.title ?? title, b.title);
      return `${bridge} ${b.script ?? ""}`.trim();
    }), [beats, standardTransitionsEnabled, title]),
    index,
  );

  const isCheckpoint = beat.slideKind === "checkpoint";
  /*
   * THE SECTION CARD'S LIFETIME — see `cardDismissed` above.
   *
   * It yields on the board's own first paint, with the minimum dwell only ensuring the title is
   * readable and SLIDE_MS only as a ceiling for a board that never reports. That is what removes
   * the dead delay: the wait is now as long as the board actually takes, which on a ready board is
   * a few frames. A continuation pass and a checkpoint never show one at all.
   */
  const showSectionCard = !continuesConcept && !isCheckpoint && !cardDismissed;
  /*
   * THE CARD'S DWELL IS MEASURED FROM WHEN IT WENT UP, NOT FROM A STORED TIMESTAMP.
   *
   * The predecessor compared `performance.now()` against a ref seeded at COMPONENT MOUNT and reset
   * on `beat.id`. For the first beat of a progressively-generated lecture, mount happens while the
   * lecture is still being written — seconds before beat 1 exists — so by the time the card
   * rendered its dwell was already spent, the timeout computed to 0, and the opening title card
   * flashed past or never appeared at all. That is the reported "no slide title in start".
   *
   * Starting the clock inside the effect that shows the card removes the dependence on when the
   * component happened to mount: the dwell always runs from the frame the card is actually on
   * screen.
   */
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
  /*
   * The sentence the beat starts speaking on, while its title slide is still up.
   *
   * Beat one used to have none, so it alone waited out the SLIDE_MS title timer in silence and
   * only then asked for its first audio clip — the pause at the start of every lecture. It now
   * carries an opening line (lib/beatPresentation.ts openingSentence), which puts it on the same
   * path as every other beat: narration starts on the slide, and nothing downstream special-cases it.
   */
  // A canvas lecture's scripts were written together and already lead from one board into the
  // next, so a canvas board gets no bridge — a stock bridge before every board was the same line
  // ("That foundation leads directly into …") again and again.
  const transitionIn = !standardTransitionsEnabled || isCanvasBeat(beat)
    ? ""
    : index > 0
      ? transitionSentence(beat.transitionIn, beats[index - 1]?.title ?? title, beat.title)
      : openingSentence(beat.transitionIn, title);
  const narrationText = transitionIn ? `${transitionIn} ${beat.script}` : beat.script;
  // How many leading narration sentences are the bridge. Counted from the same split voice.ts uses,
  // so cue indices can be mapped onto the script's own numbering (see scriptClockFromNarration).
  const bridgeSentences = transitionIn
    ? Math.max(0, splitNarrationSentences(narrationText).length - splitNarrationSentences(beat.script).length)
    : 0;

  /*
   * THE CARD COVERS THE WAIT — IT DOES NOT HAND OVER TO AN EMPTY BOARD.
   *
   * `boardPainted` is two animation frames after the board subtree mounts. An EMPTY board paints
   * just as fast as a full one, so handing over on that signal put the student in front of a blank
   * white rectangle while Aria talked over it — the board had mounted but its content had not been
   * generated yet. The title card exists precisely to cover that gap, so it must outlast it.
   *
   * `animationBlocking` is the real readiness signal and already exists: it is true while a beat's
   * React animation or chalkboard op is still waiting on the server (`isReactAnimationPending` /
   * `isChalkBoardPending`), and it clears when the content lands or the 10s pending timeout gives
   * up. The card now holds while it is true.
   *
   * Two rules kept from the previous fix, because both were real failures:
   *   - Speech is never REQUIRED. A voice stuck on "Connecting" must not trap the card (it did),
   *     so nothing here waits on `speaking` or on `stage`.
   *   - There is always a ceiling, so a board whose content never arrives still reveals itself
   *     rather than leaving the lecture behind a title forever.
   */
  /*
   * READY MEANS THE CONTENT EXISTS — not that we stopped waiting for it.
   *
   * `animationBlocking` is `currentAnimationPending && !animationTimedOut`, so it also goes false
   * when the 10s pending timeout GIVES UP. Keying the card on it therefore handed over to a board
   * that was still empty, which is the long blank-white stretch being reported: title, then ten
   * seconds of nothing, then a white board. `currentAnimationPending` alone asks the honest
   * question — has this beat's board content actually arrived? — and stays true until it has.
   */
  const transitionBoardShownRef = useRef(false);
  // Signing-only mirror of Gemini's streaming tutor transcript. It never enters the caption log or
  // chat state, so enabling the isolated hand cannot alter either existing transcript surface.
  const [liveSigningCaption, setLiveSigningCaption] = useState("");
  const liveSigningCaptionRef = useRef("");
  const liveSigningTurnFinishedRef = useRef(true);

  // Engagement + confusion signals (Confusion Radar / adaptive check-ins).
  const [beatQuestions, setBeatQuestions] = useState(0);
  const [driftEvents, setDriftEvents] = useState(0);
  const [lastInteractionAt, setLastInteractionAt] = useState(() => Date.now());
  // Focus-pause flow: null = running, "stopped" = frozen during the hold, "ready" = awaiting Resume.
  const [focusPause, setFocusPause] = useState<null | "stopped" | "ready">(null);
  const focusHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Two-way board: freehand sketch + highlighter.
  /*
   * ONE TOOL, AND MARKS THAT OUTLIVE THE BEAT.
   *
   * `drawMode`/`highlightMode` were mutually exclusive booleans over two separate raster overlays,
   * and the strokes were wiped on every beat change. See lib/board/annotations.ts.
   */
  const [boardTool, setBoardTool] = useState<BoardTool>("none");
  /** The "Explain this" offer is dismissed per mark, and re-offered on the next one. */
  const [explainDismissed, setExplainDismissed] = useState(true);
  const [explainBusy, setExplainBusy] = useState(false);
  const [annotations, setAnnotations] = useState(EMPTY_ANNOTATIONS);
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  /**
   * WHAT THE TUTOR CAN SEE. Every ask path — voice, chat, "Explain this" — is text in, so the board
   * has to be described to the model in words: what is written on it right now (from the sandbox's
   * text map, which is the board's actual content rather than the narration), and every mark the
   * student made with the text each covered. Without this the tutor knew the script and nothing
   * else, which is why it could not answer "what is THIS?".
   */
  const boardContextExtras = useCallback((): string => {
    const lines: string[] = [];
    const onBoard = visibleSandboxText(boardSurfaceRef.current?.querySelector('[data-active-board="true"]') ?? boardSurfaceRef.current);
    if (onBoard.length) lines.push(`Text currently written on the board: ${onBoard.join(" | ").slice(0, 700)}`);
    const marks = marksNarrative(strokesFor(annotationsRef.current, beatRef.current.id));
    if (marks) lines.push(`The student has marked the board — ${marks}. If they ask about "this" or "that", they mean these marks.`);
    return lines.length ? `\n${lines.join("\n")}` : "";
  }, []);
  const boardSurfaceRef = useRef<HTMLElement | null>(null);
  const selectionRequest = useMemo(
    () => buildExplainRequest(strokesFor(annotations, beat.id), {
      conceptTitle: beat.title,
      currentSentence: sentenceCue.text,
    }),
    [annotations, beat.id, beat.title, sentenceCue.text],
  );
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
  /*
   * THE BOARD ARIA DRAWS WHEN ASKED (show_board), as sections: a follow-up that continues the same
   * drawing is added under it, a new figure replaces it with a fresh slide.
   *
   * Its explanation is read by the lesson's narration, sentence by sentence, as each part is drawn —
   * the same sync the typed questions and the lecture have. It used to be left to the live model to
   * "briefly explain", while the board drew itself on a fixed 12–24 s timer: often she said nothing,
   * and when she did the words and the drawing were unrelated in time. One voice is still the rule:
   * the live model's audio is muted for that turn (see show_board in the hook).
   */
  const [liveBoards, setLiveBoards] = useState<GeminiLiveBoard[]>([]);
  /** An earlier slide shown again to answer a question on it (lib/revisit.ts, RevisitOverlay). */
  const [revisit, setRevisit] = useState<{ index: number; marks: RevisitMark[]; note: string } | null>(null);
  const liveBoardsRef = useRef<GeminiLiveBoard[]>([]);
  const [liveBoardProgress, setLiveBoardProgress] = useState(1);
  const boardNarrationRef = useRef<NarrationHandle | null>(null);
  /** The board's explanation is being spoken — the gate treats it like the lecture's voice. */
  const boardNarratingRef = useRef(false);
  const [boardNarrating, setBoardNarrating] = useState(false);
  const stopBoardNarration = useCallback(() => {
    boardNarrationRef.current?.cancel();
    boardNarrationRef.current = null;
    boardNarratingRef.current = false;
    setBoardNarrating(false);
    setLiveBoardProgress(1);
  }, []);
  /** Set once the lesson machine exists (below); the hook's callback reads it when a board lands. */
  const showLiveBoardRef = useRef<(board: GeminiLiveBoard) => void>(() => {});
  const clearLiveBoard = useCallback(() => {
    stopBoardNarration();
    liveBoardsRef.current = [];
    setLiveBoards([]);
  }, [stopBoardNarration]);
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

  /*
   * STRICT SOURCE BEYOND THE SCRIPT.
   *
   * "Strictly from the source" bound the lecture script and nothing a student could talk to: the ask
   * box, the pen and the voice tutor all answered from general knowledge. Every one of them now gets
   * the scope and the CURRENT beat's own source — its blocks' text, its figure's printed labels and
   * caption (lib/strictSourceAnswers.ts) — built here, where the document already is.
   *
   * `strictSource` requires a parsed document: a typed topic has nothing to be strict to, and a
   * reference-mode lesson keeps its old behaviour (it still passes the beat's source, as context).
   */
  const hasSourceDocument = isSuprnotesLessonInput(sourceDocument);
  const strictSource = hasSourceDocument && isStrictScope(sourceScope);
  const beatSourceFor = useCallback(
    (target: Beat | undefined | null) => (hasSourceDocument ? beatSourceGroundingFor(sourceDocument, target?.sourceBlockIds, strictSource) : null),
    [hasSourceDocument, sourceDocument, strictSource],
  );
  /**
   * The document context the LIVE VOICE TUTOR reads.
   *
   * Its hook forwards a fixed set of strings to the session-token route and to /api/explain, with no
   * field for a scope — and that hook is frozen production voice code. So in strict mode the rule and
   * the current part's source ride at the head of the document context, where both of those read them
   * back out (lib/geminiLiveContract.ts, app/api/explain/route.ts). Reference mode is byte-identical.
   */
  const liveTutorDocumentContext = () => {
    const document = buildDocumentContext(sourceDocument, slideContext, ocrTranscript, fullDocumentText, selectionPages);
    if (strictSource) return withStrictSourceHeader(document, beatSourceFor(beatRef.current));
    // A video's transcript goes as it is: the token route recognises it and adds a video's own rules.
    if (isVideoSource(sourceDocument)) return document;
    /*
     * Reference mode: the same implicit-attribution rule the text chat gets, riding at the head of the
     * context the live tutor reads (its hook takes strings only, and stays untouched).
     */
    if (sourceScope?.fidelity === "reference" && document) {
      return `This document is the student's REFERENCE material, not a limit. Answer from it when it covers the question and mention that in passing ("your notes say…"); when it does not, answer from what you know and signal that lightly ("your document doesn't cover this, but…"). Never label sources.\n\n${document}`;
    }
    return document;
  };

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
  /*
   * Whether the LECTURE is audibly narrating — the tutor's voice the Live hook cannot see, because
   * narration plays through the voice director's TTS path, not through the hook's own playback.
   * Read by the gate on every mic frame via `getTutorSpeaking`, so it is a ref, not state, and it
   * is kept current by the effect below `lesson` (which is declared after this call).
   */
  const narrationAudibleRef = useRef(false);
  /*
   * The student's last words, for judging what Aria's lecture tools mean. Aria calls
   * `resume_lecture` both when the student said "carry on" and when she has merely finished an
   * answer; only the first may lift a pause the student asked for. Likewise her `pause_lecture` is
   * the student's own pause only when their words asked for one.
   */
  const lastStudentWordsRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const studentJustSaid = (intent: (text: string) => boolean) =>
    wallClock() - lastStudentWordsRef.current.at < 30_000 && intent(lastStudentWordsRef.current.text);
  // The voice tutor's revisit_slide tool, set once the revisit flow below exists.
  const revisitToolRef = useRef<((args: Record<string, unknown>) => Promise<string>) | null>(null);
  const tutor = useGeminiLiveTutor({
    voiceSurface: documentId ? "pdf" : "normal",
    // Minutes of narration at a time: nothing stops her without positive evidence.
    gateProfile: "lecture",
    // She is shown the uploaded pages themselves, not only their extracted text.
    documentId,
    getTutorSpeaking: () => narrationAudibleRef.current || boardNarratingRef.current,
    topic: title,
    // What is ON the board — the code listing, the diagram, the chalk lines — not only the script,
    // plus the text inside a sandboxed board and every mark the student made on it.
    getBeatContext: () => describeBoard(beatRef.current, highlightedTextRef.current) + boardContextExtras(),
    lessonQuestion,
    /*
     * THE SAME TWO SOURCES THE TEXT CHAT ALREADY USES.
     *
     * This session had neither. It knew the beat it was on and nothing else — not what the lesson
     * covered, and not the document the lesson was written from — so asking Aria aloud about your
     * own paper got a fluent answer from general knowledge, while typing the identical question
     * into the panel beside her got one quoted from the document. Reading through the same two
     * functions is what stops the voice and the text drifting apart again.
     */
    getLessonContext: () => buildLessonContext(beats, indexRef.current, plannedParts, sourceDocument),
    getDocumentContext: liveTutorDocumentContext,
    mood,
    onBoardRequest: (board) => showLiveBoardRef.current(board),
    getPreviousBoard: () => liveBoardsRef.current[liveBoardsRef.current.length - 1]?.script ?? "",
    onTranscript: (role, rawText, final) => {
      /*
       * The live model's control tokens are not words. The hook strips "<no speech>" per streamed
       * chunk, but a token split across two chunks ("<no" + " speech>") is joined again in the final
       * transcript, and the student saw "ARIA <no speech>" floating over the board.
       */
      const text = rawText.replace(/<\s*no\s*speech\s*>|\{\s*pause\s*\}/gi, "").replace(/[ \t]{2,}/g, " ");
      if (!text.trim()) return;
      if (deafMode && role === "tutor" && text.trim()) {
        if (final) {
          liveSigningCaptionRef.current = text.trim();
          liveSigningTurnFinishedRef.current = true;
        } else {
          const delta = text.trim();
          const previous = liveSigningTurnFinishedRef.current ? "" : liveSigningCaptionRef.current;
          liveSigningCaptionRef.current = previous
            ? /^[,.;:!?]/.test(delta) ? `${previous}${delta}` : `${previous} ${delta}`
            : delta;
          liveSigningTurnFinishedRef.current = false;
        }
        setLiveSigningCaption(liveSigningCaptionRef.current);
      }
      // Finalized lines flow into the chat log so the live conversation shows up in the chat
      // panel (not a separate bottom bar). student -> "you", tutor -> "aria".
      if (!final || !text.trim()) return;
      if (role === "student") lastStudentWordsRef.current = { text: text.trim(), at: wallClock() };
      // The overlay shows the latest line so a learner can see the mic is genuinely working. Without
      // it a silent model looks identical to a dead session, and they have no reason to keep talking.
      if (checkinRef.current) setCheckinLine(text.trim());
      chat.appendTurn(role === "student" ? "you" : "aria", text);
      // Only a real question re-plans the lecture — not "carry on", not "hello hello" (lib/adaptiveQuestion.ts).
      if (role === "student" && isAdaptiveQuestion(text)) onLearnerInteraction?.({ kind: "question", detail: text.trim() });
    },
    onSessionEnded: () => {
      setSessionActive(false);
      clearLiveBoard();
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
      // The student has the floor: the board's explanation stops, and the drawing completes.
      if (boardNarratingRef.current) stopBoardNarration();
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
      liveSigningTurnFinishedRef.current = true;
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
      lesson.requestResume({ explicit: true });
    },

    onPauseLecture: () => {
      if (checkinRef.current) return; // already paused, and by something that outranks her
      /*
       * The student asked for this pause: hold it. It used to keep the question's automatic resume
       * armed, so "Aria, can you pause?" was followed by "Sure, paused" — and the lecture resuming.
       */
      if (studentJustSaid(isPauseIntent)) {
        lesson.pause("user");
      } else {
        // Aria pausing to answer a question: the question's automatic resume stays armed.
        lesson.enterChat({ preserveResumeIntent: true });
      }
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
      /*
       * Only the student's own words lift the hold. She is told to call this only when they ask,
       * but she used to call it after every answer; so it counts when their last words asked to go on
       * ("continue", "let's go") or were a short reply to her invitation ("yes", "sure, go ahead") —
       * never when they were a question she has just answered.
       */
      lesson.requestResume({ explicit: studentJustSaid(isResumeIntent) || studentJustSaid(isShortAgreement) });
    },
    lectureControlTools: true,
    customTools: [REVISIT_SLIDE_TOOL],
    onCustomToolCall: (name, args) =>
      name === "revisit_slide" && revisitToolRef.current ? revisitToolRef.current(args) : `Unknown tool: ${name}`,
    checkinMode: checkin !== null,

    /*
     * LISTENING FROM THE START. The lecture's session used to open muted, so "Aria…" did nothing
     * until the student found the mic button — the name only worked after they had already asked
     * the hard way. The mic is live from Play (the browser asks once, inside that click); nothing
     * reaches the model until the gate hears words addressed to her. The mute button still mutes.
     */
    onOutputBlocked: () => {
      // Live Aria's output is held; the lecture's own narration may be fine. A tap resumes it.
      if (!voiceBlockedRef.current) blockedLiveOnlyRef.current = true;
      setVoiceBlocked(true);
    },
    startMuted: !autoVoiceAssistant,
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
   * WHEN ARIA'S VOICE SPEAKS, THE LECTURE STOPS. The lecture froze only when the STUDENT started
   * speaking; if the live tutor spoke on her own (answering late, reacting to a sound) the lecture
   * narration carried on under her — two voices at once. Any time she speaks, the lecture freezes
   * in place, and it continues from the same word when the student asks for it.
   */
  useEffect(() => {
    if (checkinRef.current || !tutor.speaking) return;
    /*
     * SHE ANSWERED, SO THE STUDENT DECIDES WHAT HAPPENS NEXT.
     *
     * This froze the lecture while she spoke and then resumed it 1.5 s after she went quiet, and the
     * question's own "resume after the answer" fired at her turn end too — so every answer was
     * followed by the lecture starting again on its own, before the student had taken it in or asked
     * a follow-up. Reported, rightly, as wrong: the student is the one who says when to go on. Her
     * speaking now HOLDS the lecture exactly like the student's own pause; "continue" or Play lifts
     * it. The one exception is her acknowledging a "continue" — that turn is the resume.
     */
    if (studentJustSaid(isResumeIntent)) return;
    lesson.holdForStudent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutor.speaking]);

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

  /*
   * THE LESSON CANVAS (components/canvas/LessonCanvas.tsx). A lecture whose beats carry canvas
   * boards is taught on one world instead of a board per beat: the canvas replaces BoardStage, the
   * camera flight replaces the title card, and a board with a task (Try it / Draw it) holds the
   * lecture after its narration until the student continues — the way a checkpoint holds it.
   */
  const canvasPanels = useMemo(() => canvasPanelsOf(beats), [beats]);
  const canvasLesson = canvasPanels.length > 0;
  const canvasIndex = canvasLesson ? canvasPanels.findIndex((p) => p.key === beat.id) : -1;
  const canvasTask = canvasIndex >= 0 ? canvasPanels[canvasIndex].spec.interaction : undefined;
  const canvasTaskRef = useRef(false);
  useEffect(() => {
    canvasTaskRef.current = Boolean(canvasTask);
  });
  /** The beat whose narration has finished, and the beat held for the student's task. */
  const [narrationDoneIndex, setNarrationDoneIndex] = useState<number | null>(null);
  const [canvasHoldIndex, setCanvasHoldIndex] = useState<number | null>(null);
  const speakCanvasLine = useCallback((text: string) => {
    voiceRef.current?.speakAsTeacher(text, { onStart: () => {}, onEnd: () => {}, onBlocked: () => {} }, "utterance");
  }, []);
  const tellAriaCanvas = useCallback((note: string) => {
    tutorRef.current.addContext?.(note);
  }, []);

  /*
   * THE KNOWLEDGE GRAPH ON THIS LECTURE (lib/knowledge, GET /api/knowledge/lecture): which concept
   * each drawn element is, and what this student already knew of each before the lecture began.
   * The worker writes it a few seconds after the plan, so it is polled for briefly; the boards are
   * marked once it arrives. A canvas board's id carries its lecture's id (cv-<session>-b<n>).
   */
  const canvasSessionId = useMemo(() => canvasPanels.map((p) => /^cv-([a-f0-9-]{36})-b\d+$/.exec(p.key)?.[1]).find(Boolean) ?? null, [canvasPanels]);
  const [knowledgeState, setKnowledgeState] = useState<{ session: string; data: CanvasKnowledge } | null>(null);
  const canvasKnowledge = knowledgeState && knowledgeState.session === canvasSessionId ? knowledgeState.data : null;
  useEffect(() => {
    if (!canvasSessionId) return;
    let alive = true;
    let tries = 0;
    let timer = 0;
    const load = () => {
      fetch(`/api/knowledge/lecture?session=${encodeURIComponent(canvasSessionId)}`)
        .then(async (res) => {
          if (!alive) return;
          if (res.status === 204) {
            if (tries++ < 20) timer = window.setTimeout(load, 4000);
            return;
          }
          if (!res.ok) return;
          const data = (await res.json()) as CanvasKnowledge;
          if (alive) setKnowledgeState({ session: canvasSessionId, data });
        })
        .catch(() => {});
    };
    load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [canvasSessionId]);
  // Aria is told once what the student already knows, so her answers build on it.
  const knowledgeToldRef = useRef<string | null>(null);
  useEffect(() => {
    if (!canvasKnowledge || !canvasSessionId || knowledgeToldRef.current === canvasSessionId) return;
    knowledgeToldRef.current = canvasSessionId;
    const all = Object.values(canvasKnowledge.concepts);
    const known = all.filter((c) => c.status === "known").map((c) => c.label);
    const shaky = all.filter((c) => c.status === "shaky").map((c) => c.label);
    const gaps = [...new Set(all.flatMap((c) => (c.gaps ?? []).map((g) => g.label)))];
    const lines = [
      known.length ? `already knows from earlier lessons: ${known.join(", ")}` : "",
      shaky.length ? `has met but is shaky on: ${shaky.join(", ")}` : "",
      gaps.length ? `may be missing these foundations: ${gaps.join(", ")}` : "",
    ].filter(Boolean);
    if (lines.length) tellAriaCanvas(`About this student's knowledge (for your answers; do not announce it): they ${lines.join("; ")}. Build on what they know; if a question shows a gap, explain the foundation first.`);
  }, [canvasKnowledge, canvasSessionId, tellAriaCanvas]);
  /** A Predict-it answer or a drawing check is evidence of what they know (POST /api/knowledge/evidence). */
  const recordCanvasTask = useCallback((kind: "quiz" | "drawing", correct: boolean, options?: number) => {
    if (!canvasSessionId || canvasIndex < 0) return;
    void fetch("/api/knowledge/evidence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: canvasSessionId, sequence: canvasIndex, kind, correct, options }),
    }).catch(() => {});
    if (correct || !canvasKnowledge) return;
    const board = canvasKnowledge.beats.find((b) => b.sequence === canvasIndex);
    const gap = (board?.concepts ?? []).map((k) => ({ concept: canvasKnowledge.concepts[k], gap: canvasKnowledge.concepts[k]?.gaps?.[0] })).find((x) => x.gap);
    if (gap?.gap) tellAriaCanvas(`The student missed that question. It builds on ${gap.gap.label}, which they have not shown they know — if they ask, explain ${gap.gap.label} briefly first, then ${gap.concept?.label ?? "this idea"}.`);
  }, [canvasSessionId, canvasIndex, canvasKnowledge, tellAriaCanvas]);
  /** "↩ from <lecture>": the board where they learned it, in a window; the lecture waits meanwhile. */
  const [peek, setPeek] = useState<PeekTarget | null>(null);

  const showLiveBoard = useCallback(
    (board: GeminiLiveBoard) => {
      // She drew for the student: the lecture waits for them (see holdForStudent).
      if (!checkinRef.current) lesson.holdForStudent();
      boardNarrationRef.current?.cancel();
      // "Continue it" adds a section under the drawing on screen; anything else is a new slide.
      const next = board.reuseContext && liveBoardsRef.current.length ? [...liveBoardsRef.current, board].slice(-4) : [board];
      liveBoardsRef.current = next;
      setLiveBoards(next);
      if (board.interrupted || !board.script.trim()) {
        // The student is talking: show it whole, and say nothing over them.
        boardNarratingRef.current = false;
        setBoardNarrating(false);
        setLiveBoardProgress(1);
        return;
      }
      setLiveBoardProgress(0);
      boardNarratingRef.current = true;
      setBoardNarrating(true);
      boardNarrationRef.current = playNarration(board.script, {
        onStart: () => {},
        // Each part is drawn as the sentence about it begins — the same clock the typed answers use.
        onSentenceStart: (sentenceIndex, sentence, total) => {
          setLiveBoardProgress(total > 1 ? Math.min(1, (sentenceIndex + 1) / total) : 1);
          tutorRef.current.noteNarration?.(sentence);
        },
        onEnd: () => {
          boardNarrationRef.current = null;
          boardNarratingRef.current = false;
          setBoardNarrating(false);
          setLiveBoardProgress(1);
        },
        onBlocked: () => {
          boardNarratingRef.current = false;
          setBoardNarrating(false);
          setLiveBoardProgress(1);
          blockedLiveOnlyRef.current = false;
          setVoiceBlocked(true);
        },
        // The lecture is frozen, not finished: keep its audio so "continue" picks up mid-sentence.
        preserveActive: true,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    showLiveBoardRef.current = showLiveBoard;
  }, [showLiveBoard]);

  // The student chose to go on: the lecture is the only voice, back on its own board.
  const revisitOpenRef = useRef(false);
  useEffect(() => {
    revisitOpenRef.current = revisit !== null;
  }, [revisit]);
  const clearRevisit = useCallback(() => setRevisit(null), []);
  useEffect(() => {
    if (lesson.mode === "teaching" && liveBoardsRef.current.length) clearLiveBoard();
    if (lesson.mode === "teaching" && revisitOpenRef.current) clearRevisit();
  }, [lesson.mode, clearLiveBoard, clearRevisit]);

  /*
   * JUMP BACK, THEN RETURN (lib/revisit.ts). A question about something an earlier slide taught is
   * answered ON that slide: it comes back on screen at once (the lecture's own narration stays
   * frozen underneath), Aria says where it was covered and answers from it, and the board's pen
   * rings what she points at and writes her note. Null — answer as usual — for anything else, or if
   * the answer cannot be had.
   */
  const showRevisit = useCallback(
    async (targetIndex: number, question: string): Promise<{ script: string } | null> => {
      const target = { index: targetIndex };
      const past = beats[target.index];
      setRevisit({ index: target.index, marks: [], note: "" });
      try {
        const res = await fetch("/api/revisit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            topic: title,
            slideNumber: target.index + 1,
            slideTitle: past.title,
            slideScript: past.script,
            boardWords: boardWordsOf(past),
          }),
        });
        const data = await res.json().catch(() => null);
        recordJsonCost("questions", data);
        if (!res.ok || typeof data?.script !== "string" || !data.script.trim()) throw new Error("no answer");
        setRevisit({ index: target.index, marks: revisitMarks(past, Array.isArray(data.marks) ? data.marks : []), note: typeof data.note === "string" ? data.note : "" });
        return { script: data.script };
      } catch {
        setRevisit(null);
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [beats, title],
  );
  const revisitQuestion = useCallback(
    async (question: string) => {
      const target = findRevisitTarget(question, beats, indexRef.current, {
        total: Math.max(beats.length, totalBeatCount ?? 0),
        namedOnly: isVideoSource(sourceDocument),
      });
      return target ? showRevisit(target.index, question) : null;
    },
    [beats, showRevisit, totalBeatCount, sourceDocument],
  );
  /*
   * Spoken questions: Aria calls revisit_slide. The slide comes back at once and she is told what it
   * shows, so she can answer over it straight away; the pen's rings and note follow when they arrive
   * (her spoken answer is her own — the written script is not read).
   */
  useEffect(() => {
    revisitToolRef.current = async (args) => {
      const question = typeof args.question === "string" ? args.question : "";
      const named = Math.round(Number(args.slide_number)) - 1;
      const current = indexRef.current;
      const hasBoard = (i: number) => Boolean(beats[i]?.draw?.ops?.length) && beats[i]?.slideKind !== "checkpoint";
      const index = Number.isFinite(named) && named >= 0 && named < current && hasBoard(named)
        ? named
        : findRevisitTarget(question, beats, current, { total: Math.max(beats.length, totalBeatCount ?? 0), namedOnly: isVideoSource(sourceDocument) })?.index ?? -1;
      if (index < 0) return "That is not an earlier slide with a board. Answer the question here, without going back.";
      lesson.holdForStudent();
      const past = beats[index];
      void showRevisit(index, question || past.title);
      return `Slide ${index + 1}, "${past.title}", is back on screen. It taught: ${past.script.slice(0, 600)} Its board shows: ${boardWordsOf(past).join(", ") || "its drawing"}. Say we covered this on slide ${index + 1}, answer the student's question from it in one to three short sentences, then invite them to say continue. The lecture stays paused until they do.`;
    };
  });

  // A drawing is under way: the lecture waits for the student from now, not from when it lands.
  useEffect(() => {
    if (tutor.status === "drawing" && !checkinRef.current) lesson.holdForStudent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutor.status]);

  /*
   * SETTLE THE BOARD WHEN THE LECTURE STOPS TALKING.
   *
   * The board's handwriting follows the narration clock, so a pause — or a question that interrupts
   * the lecture — froze it wherever the clock stopped: a label clipped mid-word, "chlorophyll"
   * reading "chlo" for as long as the student looked at it. The sandbox finishes the word in
   * progress by itself once the clock goes quiet; this tells it to finish the whole line, which is
   * what a teacher does when they stop to take a question. Sent only on the transition out of
   * teaching (never before the lecture has started, which would write a line nobody has said yet),
   * and never taken back on resume — the sandbox keeps what it revealed.
   *
   * Posted to every frame on the board rather than through a component prop: the sandbox's message
   * handler reads only `type`, and a board that is not a sandbox ignores the message.
   */
  const wasTeachingRef = useRef(false);
  useEffect(() => {
    const wasTeaching = wasTeachingRef.current;
    wasTeachingRef.current = lesson.playing;
    if (!wasTeaching || lesson.playing) return;
    boardSurfaceRef.current?.querySelectorAll("iframe").forEach((frame) => {
      try {
        frame.contentWindow?.postMessage({ type: "settle", scope: "line" }, "*");
      } catch {
        // A frame mid-teardown has no window to post to; there is nothing left to settle.
      }
    });
  }, [lesson.playing]);

  /*
   * A GENERATED ANIMATION IS NOT ON SCREEN WHEN ITS CODE EXISTS.
   *
   * `currentAnimationPending` only says the code has arrived. The sandbox then returns null while
   * Babel and the React runtime load and the code transpiles, and the iframe then shows only the
   * component's static background until its script runs and posts "ready". Every teaching element
   * sits at opacity 0 until narration reaches its sentence. Treating "code exists" as "board
   * visible" is what put a white board with an empty frame on screen for seconds — the reported
   * failure — so a sandbox beat additionally waits for the sandbox's own ready signal.
   */
  const sandboxBeat = REACT_ANIMATIONS_ENABLED && Boolean(findReactAnimationOp(beat)?.code);
  const boardContentReady = boardPainted && !currentAnimationPending && (!sandboxBeat || sandboxReady);
  /*
   * THE CARD LEAVES WHEN THE BOARD STARTS WRITING, NOT BEFORE.
   *
   * In standard mode every beat opens with a spoken bridge, and the narration effect flips
   * `stage` to "board" at the exact moment the bridge sentences end and the script — the words the
   * drawing is synchronised to — begins. That is the moment the board starts writing, and it is
   * when the title should dissolve into it. While the bridge is being spoken the card stays,
   * because underneath it the board is still blank by design.
   *
   * Speech is never REQUIRED: this only holds while narration is actually running. A voice that
   * has not started yet is waited for separately, below, and only for a bounded time.
   */
  /*
   * THE CARD YIELDS ONCE THE BOARD IS READY, PLAYING OR NOT.
   *
   * It used to hold until the lecture was playing, so that pressing Play could not reveal a board
   * that stays blank until the script begins. That reasoning only ever applied to a lecture about to
   * start narrating — and it made REOPENING a saved lecture land on a full-screen title card with no
   * way to dismiss it, because a replay mounts paused and nothing ever set `playing`. A card that
   * covers the board until you find the Play button is not a title, it is an overlay in the way.
   *
   * So the waits below are bounded by the board, not by playback: the title is readable, the board
   * appears behind it when it is ready, and a lecture you have not started yet shows you the lesson
   * rather than a lid on it.
   *
   * Bridged beats (every beat in standard mode) hold through two more things, in order: the voice
   * starting (bounded by VOICE_WAIT_MAX_MS, so a blocked voice cannot trap the card) and the bridge
   * being spoken (until `stage` flips to "board" — the exact moment the script, and the drawing
   * synchronised to it, begin). Unbridged beats cannot wait for the voice: their narration starts
   * on the board stage, which only arrives after the card leaves.
   */
  const bridged = Boolean(transitionIn);
  const holdForVoice = bridged && !speaking && !voiceWaited;
  const holdForBridge = bridged && speaking && stage !== "board";
  useEffect(() => {
    if (continuesConcept || isCheckpoint) return;
    const ceiling = setTimeout(() => setCardDismissed(true), BOARD_WAIT_MAX_MS);
    const voice = setTimeout(() => setVoiceWaited(true), VOICE_WAIT_MAX_MS);
    return () => {
      clearTimeout(ceiling);
      clearTimeout(voice);
    };
  }, [beat.id, continuesConcept, isCheckpoint]);
  useEffect(() => {
    if (continuesConcept || isCheckpoint) return;
    // A lecture that is not playing has no bridge to speak and no voice to wait for, so those holds
    // apply only while it is running — otherwise a paused lecture waits for something that cannot
    // arrive, which is how the card got stuck over a replayed lesson.
    if (!boardContentReady || (lesson.playing && (holdForVoice || holdForBridge))) return;
    // Everything is ready; hold only long enough for the title to have been readable.
    const elapsed = performance.now() - titleShownAtRef.current;
    const t = setTimeout(() => setCardDismissed(true), Math.max(0, TITLE_MIN_MS - elapsed));
    return () => clearTimeout(t);
  }, [boardContentReady, holdForVoice, holdForBridge, lesson.playing, continuesConcept, isCheckpoint, beat.id]);
  useEffect(() => {
    // The teacher owns the voice and the lesson is not paused or frozen: narration is audible.
    narrationAudibleRef.current = voice.owner === "teacher" && lesson.playing;
  }, [voice.owner, lesson.playing]);

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
      onLearnerInteraction?.({ kind: "checkpoint", correct: true });
      resumeAfterQuestion();
    },
    onFailed: () => {
      // A check-in owns the pause; nothing about the lesson may move it. See beginCheckin.
      if (checkinRef.current) return;
      bumpInteraction();
      // Costs nothing — it only withholds the all-correct bonus. Charging for wrong answers is how
      // a learner concludes the safe move is to stop answering.
      emitAdhdEvent({ type: "answer-wrong" });
      onLearnerInteraction?.({ kind: "checkpoint", correct: false });
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
  /*
   * THE VOICE TUTOR FOLLOWS THE BOARD.
   *
   * Her beat context was read once, when the socket opened, so from beat two onwards she believed
   * the lecture was still on beat one and could not say what was on the board. Each time the beat
   * (or its board, once it fills) changes, she is told silently — the same context-only update the
   * highlight uses. Never while she is talking: that update suppresses the turn it lands in.
   */
  const boardSentRef = useRef("");
  const liveTutorReady = tutor.status === "live" || tutor.status === "drawing";
  useEffect(() => {
    if (!liveTutorReady) return;
    const board = describeBoard(beat, highlightedTextRef.current);
    const key = `${index}:${board.length}`;
    if (boardSentRef.current === key || tutor.isSpeaking()) return;
    boardSentRef.current = key;
    // Strict: the session's instruction was fixed when it opened, so each new part's own source
    // text travels with the part change, and the tutor is held to it.
    const partSource = strictSource
      ? strictVoicePartContext(beatSourceFor(beat))
      : hasSourceDocument ? referenceVoicePartContext(beatSourceFor(beat)) : "";
    tutor.addContext(`The lecture is now on part ${index + 1}. What the student sees:\n${board}${partSource}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, beat, liveTutorReady]);

  const chat = useLessonChat({
    topic: title,
    // The board as it stands, anything the student highlighted on it, and what a sandboxed board
    // actually says — the typed chat used to get the title and script only, so "what does this line
    // of code do?" had no code to look at.
    getBeatContext: () => describeBoard(beat, highlightedTextRef.current) + boardContextExtras(),
    // Read at ask time, not captured: the lecture moves while the panel is open.
    getLessonContext: () => buildLessonContext(beats, indexRef.current, plannedParts, sourceDocument),
    getDocumentContext: () => buildDocumentContext(sourceDocument, slideContext, ocrTranscript, fullDocumentText, selectionPages),
    documentId,
    lessonQuestion,
    ...(hasSourceDocument && sourceScope ? { sourceScope, getBeatSource: () => beatSourceFor(beat) } : {}),
    revisit: revisitQuestion,
    pausePlayer: () => {
      // Hard stop during a check-in. This is the path behind "Aria talks about the lesson": ask()
      // speaks its answer through playNarration directly (LessonChat.tsx), bypassing the voice
      // director entirely, so it lands ON TOP of her live audio and nothing can mute it afterwards.
      if (checkinRef.current) return;
      bumpInteraction();
      setBeatQuestions((n) => n + 1);
      // A typed question is answered and then waits for the student, as a spoken one does.
      lesson.holdForStudent();
    },
    onQuestionAsked: (question) => {
      if (isAdaptiveQuestion(question)) onLearnerInteraction?.({ kind: "question", detail: question });
    },
    onExplanationClosed: () => lesson.requestResume(),
    onVoiceBlocked: () => {
      blockedLiveOnlyRef.current = false;
      setVoiceBlocked(true);
    },
  });

  // Short label for the chat mic button while a live session is active/connecting.
  const liveMicLabel =
    tutor.status === "connecting"
      ? "Connecting…"
      : tutor.status === "drawing"
        ? "Drawing…"
        : tutor.speaking
          ? "Aria speaking…"
          // The mic is always open (2026-09-29: "the audio should always be open — just mute and
          // unmute"), so there is no call to end; the pill says what she is doing, Mute sits beside it.
          : tutor.muted
            ? "Muted"
            : "Listening";

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
    clearLiveBoard();
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
    clearLiveBoard();
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
        // Back to the ordinary lecture session, still listening for "Aria".
        t.setMicEnabled(autoVoiceAssistant);
        if (autoVoiceAssistant) void t.start();
      }
    }, CHECKIN_RECONNECT_GAP_MS);
    return () => clearTimeout(id);
  }, [checkin, autoVoiceAssistant]);

  /**
   * The two-minute floor.
   *
   * Only gates when Aria may ASK. She is cued through `say` and not `addContext`, because
   * `addContext` is a background note the model does not answer — and a silent cue to start talking
   * is no cue at all.
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
  useEffect(() => {
    transitionBoardShownRef.current = false;
    // A new beat has a new board, which has not painted yet, and its card starts its dwell now.
    titleShownAtRef.current = performance.now();
    setBoardPainted(false);
    setSandboxReady(false);
    setVoiceWaited(false);
    setCardDismissed(false);
    queueMicrotask(() => setAnimationTimedOut(false));
  }, [beat.id]);
  useEffect(() => {
    if (!currentAnimationPending || !lesson.playing || animationTimedOut) return;
    const t = setTimeout(() => setAnimationTimedOut(true), ANIMATION_PENDING_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [currentAnimationPending, lesson.playing, animationTimedOut, beat.id]);

  // Drives each beat: show its slide briefly, then (for normal beats) flip to the board
  // and narrate; on voice end, advance. Checkpoint beats narrate the question on the slide
  // itself and then STOP — they wait for submitCheckpoint() instead of auto-advancing.
  /*
   * Effect 1: hand the beat from its title card to its board. This effect ONLY sets `stage` — it
   * never starts narration itself, so it can't race with the narration effect's cleanup.
   *
   * THE HAND-OFF IS DRIVEN BY THE BOARD, NOT BY A CLOCK. The board is mounted underneath the title
   * from the moment the beat begins, so it is laying out and drawing during the card rather than
   * after it; `boardPainted` fires on its first real paint and the title yields immediately. The
   * timer that remains is only a ceiling for a board that never reports.
   *
   * A CONTINUATION PASS SKIPS THE CARD ENTIRELY. The second board of one subtopic is not a new
   * section, so it neither announces a title nor pauses: it slides straight on from the work above
   * it, which is what makes several explanations read as one idea.
   */
  useEffect(() => {
    if (!lesson.playing || stage !== "slide" || isCheckpoint || transitionIn || animationBlocking) return;

    if (continuesConcept) {
      setStage("board");
      setStartNonce((value) => value + 1);
      return;
    }

    /*
     * Narration begins when the card yields, on the same signal — so the voice starts as the board
     * is revealed rather than a fixed interval after the beat began. `cardDismissed` is driven by
     * the board's own first paint (with SLIDE_MS only as a ceiling), which is what removes the dead
     * air: on a ready board this is a few frames, not a second and a half.
     */
    if (!cardDismissed) return;
    setStage("board");
    // The narration effect does not depend on stage because a bridge changes slide -> board
    // without interrupting its audio. This nonce starts an ordinary beat once its card has gone.
    setStartNonce((value) => value + 1);
  }, [index, lesson.playing, stage, isCheckpoint, transitionIn, animationBlocking, cardDismissed, continuesConcept]);

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
    /*
     * A BRIDGED BEAT CAN ALWAYS START AGAIN.
     *
     * It starts on its title slide, bridge sentence first, and the narration itself moves it to the
     * board. This used to be the ONLY place it could start: once the board was showing, a beat whose
     * narration had been lost — cancelled under Aria's voice, or a resume that found nothing to
     * continue — could never be started by anything, not Resume, not the recovery below. The lecture
     * sat silent on the board with "Pause" on the button. Since every standard-track beat now has a
     * bridge (beat one opens with one), that trapped every beat.
     *
     * On the board the slide's moment has passed, so it restarts from the script, without the bridge.
     * `stage` is deliberately not a dependency, so this cannot start a beat twice.
     */
    const restartOnBoard = Boolean(transitionIn) && !isCheckpoint && stage === "board";
    const narrateOnBoard = !isCheckpoint && stage === "board";
    const narrateOnSlide = (isCheckpoint || Boolean(transitionIn)) && stage === "slide";
    if (!narrateOnBoard && !narrateOnSlide) return;
    /*
     * A PENDING BOARD SILENCES THE BOARD, NOT THE TEACHER.
     *
     * This used to block narration outright while a beat's animation was still being generated, so
     * the lecture simply stopped — up to the full 10s pending timeout of title card with nothing
     * spoken, which is most of the reported "huge gap between slides". The board's own content is
     * what has to wait; the sentence that introduces the section does not, and speaking it over the
     * card is exactly what a teacher does while writing.
     *
     * Only the SLIDE-stage narration is allowed through: on the board the script must stay in step
     * with drawing, so a board beat still waits for something to draw on.
     */
    if (!isCheckpoint && animationBlocking && !narrateOnSlide) return;
    const speakText = restartOnBoard ? (beat.script ?? "") : narrationText;
    const bridge = restartOnBoard ? 0 : bridgeSentences;
    const bridged = Boolean(transitionIn) && !restartOnBoard;
    const force = forceNextStartRef.current;
    forceNextStartRef.current = false;
    window.setTimeout(() => setDrawProgress(0), 0);
    /*
     * The voice numbers sentences over `narrationText`, bridge included; the board's
     * `data-teach-sentence` tags number the SCRIPT. Every cue and progress value is translated into
     * the script's numbering before it reaches the board, or a bridged beat draws one sentence ahead.
     */
    const narrationWeights = splitNarrationSentences(speakText).map(sentenceWeight);
    let narrationCue = 0;
    let tracedQuarter = -1;
    const started = voice.speakAsTeacher(
      speakText,
      {
        onStart: () => {
          tracePlayback("voice-start", { beat: index });
          setSpeaking(true);
        },
        onSentenceStart: (sentenceIndex, sentence, total) => {
          tutorRef.current.noteNarration?.(sentence);
          tracePlayback("sentence", { beat: index, narration: sentenceIndex, bridge, board: Math.max(0, sentenceIndex - bridge), total, text: sentence.slice(0, 50) });
          narrationCue = sentenceIndex;
          if (bridged && !isCheckpoint && sentenceIndex >= bridge && !transitionBoardShownRef.current) {
            transitionBoardShownRef.current = true;
            setStage("board");
          }
          setSentenceCue({
            index: Math.max(0, sentenceIndex - bridge),
            text: sentence,
            total: Math.max(1, total - bridge),
          });
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
        onProgress: (progress) => {
          const quarter = Math.floor(progress * 4);
          if (quarter !== tracedQuarter) {
            tracedQuarter = quarter;
            tracePlayback("progress", { beat: index, progress: Number(progress.toFixed(2)), cue: narrationCue });
          }
          if (!bridged || bridge === 0) {
            setDrawProgress(Math.max(0, progress));
            return;
          }
          const clock = scriptClockFromNarration(narrationWeights, bridge, narrationCue, progress);
          if (!isCheckpoint && !clock.onBridge && !transitionBoardShownRef.current) {
            transitionBoardShownRef.current = true;
            setStage("board");
          }
          setDrawProgress(clock.scriptProgress);
        },
        onEnd: () => {
          tracePlayback("voice-end", { beat: index, mode: lesson.modeRef.current });
          setSpeaking(false);
          narrationLiveForRef.current = null;
          /*
           * The narration is over, so the board is finished — in EVERY mode. This used to run only
           * after the mode check below, so a narration that ended while the student was asking a
           * question (or had just paused) left the board frozen wherever the last progress tick
           * landed: a label clipped mid-word, "chlorophyll" reading "chlo". onEnd fires only on a
           * natural end (a cancel never calls it), so completing the board here cannot pre-empt a
           * beat that is still being spoken.
           */
          setDrawProgress(1);
          // If playback was paused between the last cue and this onEnd firing, do NOT advance —
          // freeze on the current beat. Read the LIVE mode (not the captured `lesson.playing`).
          if (lesson.modeRef.current !== "teaching") return;
          // A pending question holds the beat the way a checkpoint does: the learner's answer
          // advances it, not the end of the narration.
          if (mcqRef.current) return;
          setNarrationDoneIndex(index);
          // A canvas board with a task holds here: the student's "Continue" advances it.
          if (canvasTaskRef.current) {
            setCanvasHoldIndex(index);
            return;
          }
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
            /*
             * LET THE FINISHED BOARD LAND. The next slide used to replace this one the instant the
             * last word ended — before the student had seen the completed drawing, and while its final
             * strokes were still easing in. The board now holds, complete, for a moment first. The
             * hold is cancelled by a pause, a question or a manual skip (anything that leaves teaching
             * or moves the index), so it never fights the student.
             */
            const heldIndex = index;
            pendingAdvanceRef.current = heldIndex;
            window.setTimeout(() => {
              /*
               * A pause or a question during the hold used to DROP the advance: this beat's narration
               * had already ended, so resuming found nothing to continue and the lecture sat silent
               * on a finished board — the "paused weirdly, then a huge pause". The advance now stays
               * pending and happens the moment teaching resumes (see the effect below).
               */
              if (lesson.modeRef.current !== "teaching" || mcqRef.current) return;
              advanceFromHeld(heldIndex);
              // The pause after a finished board keeps pace with the voice before it.
            }, BOARD_HOLD_AFTER_NARRATION_MS / rateRef.current);
          }
        },
        onBlocked: () => {
          // Autoplay refused the narration: nothing is audible, so she is not "speaking".
          blockedLiveOnlyRef.current = false;
          setSpeaking(false);
          setVoiceBlocked(true);
        },
        // Read through the ref, not as a dependency: changing speed must not restart the narration.
        rate: rateRef.current,
      },
      "lecture",
      { force },
    );
    /*
     * A REFUSAL IS NOT A DEAD END.
     *
     * `speakAsTeacher` plays nothing while the chatbot holds the channel, and this used to simply
     * return — so a beat that happened to reach the board under her voice never narrated at all, and
     * nothing retried when she went quiet. The recovery effect below picks this up.
     */
    tracePlayback(started ? "narration-start" : "narration-refused", { beat: index, stage, bridge, restartOnBoard, force, owner: voice.owner });
    if (!started) {
      startRefusedForRef.current = index;
      return;
    }
    startRefusedForRef.current = null;
    narrationLostForRef.current = null;
    narrationLiveForRef.current = index;

    return () => {
      // Cancelled before it finished — this effect re-running for the SAME beat, not the lecture
      // moving on (a narration that ended cleared the live marker in onEnd). The audio is gone, not
      // paused, so record the loss: the recovery below restarts the beat once the channel is free.
      if (narrationLiveForRef.current === index) narrationLostForRef.current = index;
      narrationLiveForRef.current = null;
      voice.stopTeacher();
      setSpeaking(false);
    };
    // `chat.busy` is deliberately only the start-time guard above. Making it a dependency runs this
    // effect's cleanup as soon as a question opens, which cancels (rather than pauses) the preserved
    // lecture handle and makes the eventual resume restart the beat from line one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, startNonce, isCheckpoint, adhd, narrationText, transitionIn, bridgeSentences, deafMode, animationBlocking]);

  // A speed change reaches the narration that is already speaking, mid-sentence, without a restart.
  const setTeacherRate = voice.setTeacherRate;
  useEffect(() => {
    setTeacherRate(rate);
  }, [rate, setTeacherRate]);

  /** Beat whose narration has ended and whose move to the next slide is still owed. */
  const pendingAdvanceRef = useRef<number | null>(null);
  const advanceFromHeld = useCallback((heldIndex: number) => {
    if (pendingAdvanceRef.current !== heldIndex) return;
    pendingAdvanceRef.current = null;
    setIndex((i) => {
      if (i !== heldIndex) return i;
      const tail = playbackTailRef.current;
      if (i < tail.beatsLength - 1) {
        setStage("slide");
        return i + 1;
      }
      if (tail.hasMoreBeats) setWaitingForNextBeat(true);
      // The parent's own state changes on completion; a state updater must not set another
      // component's state (React: "Cannot update a component while rendering a different one").
      else queueMicrotask(() => tail.onComplete?.());
      return i;
    });
  }, []);
  // Teaching resumed with an advance still owed: move on now instead of sitting on the finished board.
  useEffect(() => {
    if (lesson.mode !== "teaching" || pendingAdvanceRef.current !== index || mcqRef.current) return;
    const held = index;
    const t = window.setTimeout(() => advanceFromHeld(held), 400);
    return () => window.clearTimeout(t);
  }, [lesson.mode, index, advanceFromHeld]);
  // Any manual move (Next, Previous, a jump) settles the owed advance.
  useEffect(() => {
    if (pendingAdvanceRef.current !== null && pendingAdvanceRef.current !== index) pendingAdvanceRef.current = null;
  }, [index]);

  // Pause/resume IN PLACE, driven by the single mode value. Leaving `teaching` freezes the audio
  // (and with it the board reveal + sentence cue); returning to it continues from the exact same
  // spot — the pause button and "resume the lecture" both land here. When there is nothing to resume
  // (a fresh beat, or the browser-TTS fallback), `startNonce` starts the beat instead.
  useEffect(() => {
    if (lesson.mode === "teaching") {
      /*
       * Restart the beat ONLY when there is genuinely nothing to continue.
       *
       * `resumeTeacher()` returns false for two different reasons: nothing is frozen, or Aria still
       * holds the channel. This treated both as "nothing to continue" and bumped the nonce — which
       * re-runs the narration effect, whose cleanup CANCELS the frozen lecture it was meant to
       * continue. The student's question was answered and their lecture was destroyed with it.
       * Now a frozen lecture refused only because the channel is busy is left frozen, and the
       * recovery below continues it, mid-sentence, the moment she goes quiet.
       */
      // A beat whose narration already FINISHED (its advance is owed) moves on; it is not replayed.
      if (!voice.resumeTeacher() && !voice.hasFrozenTeacher() && pendingAdvanceRef.current !== index) queueMicrotask(() => setStartNonce((n) => n + 1));
    } else {
      voice.pauseTeacher();
      queueMicrotask(() => setSpeaking(false));
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
      narrationLost: narrationLostForRef.current === index,
    });
    tracePlayback("recovery", {
      beat: index,
      action,
      mode: lesson.mode,
      owner: voice.owner,
      chatbotSpeaking: voice.isChatbotSpeaking(),
      tutorSpeaking: tutor.speaking,
      tutorStatus: tutor.status,
      frozen: voice.hasFrozenTeacher(),
      utterance: voice.hasPendingUtterance(),
    });
    if (action === "resume") {
      voice.resumeTeacher();
    } else if (action === "restart") {
      startRefusedForRef.current = null;
      narrationLostForRef.current = null;
      setStartNonce((n) => n + 1);
    }
    // `quiz.phase` is in here for a reason that is easy to delete by accident: cancelling an
    // utterance (skipping the question) calls the handle's `cancel()`, which never fires `onEnd`, so
    // the director never releases the channel and `voice.owner` does NOT change. The phase going
    // back to "idle" is the only observable signal that the question is over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.mode, voice.owner, tutor.speaking, tutor.status, quiz.phase, index, stage, startNonce]);

  /*
   * A QUESTION THAT NEVER CAME. The voice gate can take the floor on a sustained voice before any
   * words arrive (a student who starts to speak and trails off, a voice in the room). If no words
   * and no reply ever follow, nothing calls back — the lecture sat in `chatting`, silent, for good.
   * Once the gate has settled, Aria is silent, and the automatic "resume after the answer" is still
   * waiting, the lecture continues after 8 s. It never overrides a pause the student asked for.
   */
  useEffect(() => {
    if (lesson.mode !== "chatting") return;
    let quietSince = Date.now();
    const timer = window.setInterval(() => {
      // A string: the gate also reports the arbiter's "processing" (waiting on a reply) as-is.
      const stage: string = tutorRef.current.getVoiceDiagnostics().gate?.stage ?? "idle";
      const studentOrAriaActive =
        stage === "candidate" || stage === "verifying" || stage === "listening" || stage === "committed" || stage === "processing" ||
        tutorRef.current.isSpeaking() || checkinRef.current !== null;
      if (studentOrAriaActive || !lesson.hasDeferredResume() || lesson.isHeldByStudent()) {
        quietSince = Date.now();
        return;
      }
      if (Date.now() - quietSince >= 8_000 && lesson.modeRef.current === "chatting") {
        tracePlayback("chat-stall-release", { beat: index });
        lesson.flushDeferredResume();
      }
    }, 1_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.mode]);

  /**
   * The backstop, for the stall no render announces.
   *
   * `isChatbotSpeaking()` reads live refs inside the tutor hook. If one of those is left set — a
   * response abandoned mid-flight, a board chain that never settled — the recovery above keeps
   * correctly bowing out and the lecture stays frozen with nothing to fix it. The cross-check is the
   * point: the refs say she holds the channel, React state says she is silent, and several seconds
   * have passed. Then the refs are wrong — so it OVERRIDES them. It used to ask those same refs for
   * permission (`resumeTeacher()` refuses while they say she is talking) and was refused, which is
   * why it could never unstick anything.
   *
   * It restarts a beat only when one is on record as refused or lost (lib/narrationRecovery.ts
   * `backstopRecovery`), never one that is merely waiting — so it cannot replay a finished beat while
   * the next is still being generated. The decision is re-read when the timer fires, not trusted
   * from six seconds earlier; a successful start clears the record, so it cannot loop.
   */
  useEffect(() => {
    if (lesson.mode !== "teaching" || tutor.speaking) return;
    const snapshot = () => backstopRecovery({
      mode: lesson.modeRef.current,
      tutorSpeaking: tutor.speaking,
      chatbotHoldsChannel: voice.owner === "chatbot" || voice.isChatbotSpeaking(),
      utteranceInFlight: voice.hasPendingUtterance(),
      lectureFrozen: voice.hasFrozenTeacher(),
      startRefused: startRefusedForRef.current === index,
      narrationLost: narrationLostForRef.current === index,
    });
    if (snapshot() === "none") return;
    const t = setTimeout(() => {
      const action = snapshot();
      tracePlayback("backstop", { beat: index, action });
      if (action === "resume") {
        voice.resumeTeacher({ force: true });
      } else if (action === "restart") {
        startRefusedForRef.current = null;
        narrationLostForRef.current = null;
        forceNextStartRef.current = true;
        setStartNonce((n) => n + 1);
      }
    }, NARRATION_STALL_MS);
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

  // The periodic "Quick check — in your own words…" pop-up was removed at the owner's request
  // (2026-09-30): it interrupted the lecture every few parts. The plan's own checkpoints and the
  // focus pause above are unaffected.

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
      if (hasMoreBeats) setWaitingForNextBeat(true);
      else queueMicrotask(() => onComplete?.());
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
      onLearnerInteraction?.({ kind: "checkpoint", correct: true, detail: answer });
      onCheckpointGraded?.({ concept: beat.title, correct: true, revealed: false });
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
        onCheckpointGraded?.({ concept: beat.title, correct: data.correct, revealed: false });
        if (data.correct) {
          onLearnerInteraction?.({ kind: "checkpoint", correct: true, detail: answer });
          window.setTimeout(advanceFromCheckpoint, 2200);
          return;
        }
        setCheckpointAttempts((n) => n + 1);
        onLearnerInteraction?.({ kind: "checkpoint", correct: false, detail: answer });
        return;
      }
      throw new Error("grader unavailable");
    } catch {
      setCheckpointResult(keywordResult);
      setCheckpointAttempts((n) => n + 1);
      onLearnerInteraction?.({ kind: "checkpoint", correct: false, detail: answer });
    }
  }

  function revealCheckpointAnswer() {
    if (!beat.checkpoint) return;
    // Revealed, not answered. Recorded as NOT correct: needing the answer shown is evidence about
    // this concept, and counting it as mastery would inflate the next lesson's starting depth.
    onCheckpointGraded?.({ concept: beat.title, correct: false, revealed: true });
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
          `The student just ${/^(?:circled|underlined|highlighted|marked) /.test(t) ? t : `highlighted "${t}"`} on the board. If they ask about it, explain THAT specifically, in detail.`,
        );
      }, 400);
    },
    [tutor],
  );

  // New section (board content changes) -> old highlights no longer map to it. Clear them.
  useEffect(() => {
    queueMicrotask(() => setHighlightStrokes([]));
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
    // Strict: every spoken explanation request carries the rule too, so a "explain this in detail"
    // is not read as licence to go past the page.
    const spoken = strictSource
      ? `${prompt} Strict source mode: say only what the student's document says; if it does not cover this, say so plainly and add nothing from outside it.`
      : prompt;
    const sayWhenReady = (attempt = 0) => {
      const current = tutorRef.current;
      if (current.status === "live" || attempt > 20) {
        current.say(spoken);
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

  /*
   * A MARK WITH NO WORDS UNDER IT still tells Aria something (2026-09-29: "the pen and highlighter
   * should work with visual context"). On a picture board the parts it covers are named from the
   * picture's own map (lib/board/markContext.ts) — instant and free. Anywhere else, once the student
   * pauses marking, a quick look at just the marked crop names what is there. Either way the live
   * session is told, so "what's this?" by voice is about the right thing.
   */
  const markDescribeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function describeMarkForTutor(stroke: AnnotationStroke) {
    const verb = stroke.kind === "highlight" ? "highlighted" : "circled";
    const code = (beat.draw?.ops ?? []).map((op) => (op as { code?: unknown }).code).find((c): c is string => typeof c === "string");
    const parts = picturePartsInMark(code, stroke.points);
    if (parts.length) {
      pushHighlightContext(`${verb} the ${parts.join(" and the ")} in the picture`);
      return;
    }
    if (markDescribeTimer.current) clearTimeout(markDescribeTimer.current);
    markDescribeTimer.current = setTimeout(() => {
      const surface = boardSurfaceRef.current;
      const region = boundsOf([stroke]);
      if (!surface || !region) return;
      void captureSelectedBoardRegion(surface, region)
        .then((image) => fetch("/api/ask-drawing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image,
            topic: title,
            beatContext: `${beat.title}: ${beat.script}`,
            question: "In at most twelve words, name exactly what is inside the marked area of this board crop — the part, word, symbol or shape. If it is blank paper, answer exactly: nothing specific.",
            selectedRegion: region,
            answerOnly: true,
          }),
        }))
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          recordJsonCost("questions", data);
          const what = typeof data?.script === "string" ? data.script.trim().replace(/[.\s]+$/, "") : "";
          if (what && !/nothing specific/i.test(what)) pushHighlightContext(`marked ${what} on the board`);
        })
        .catch(() => {});
    }, 1200);
  }

  async function explainMarkedRegion(request: ExplainRequest) {
    if (checkinRef.current) return;
    setExplainBusy(true);
    setExplainDismissed(true);
    try {
      const surface = boardSurfaceRef.current;
      if (!surface) throw new Error("Teaching board is unavailable.");
      const image = await captureSelectedBoardRegion(surface, request.region);
      const response = await fetch("/api/ask-drawing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image,
          topic: title,
          beatContext: `${beat.title}: ${beat.script}`,
          question: request.question,
          selectedRegion: request.region,
          selectedText: request.selectedText,
          // Only the answer is used below (the live tutor speaks it); no board to plan or fill.
          answerOnly: true,
          ...(hasSourceDocument && sourceScope ? { sourceScope, beatSource: beatSourceFor(beat) } : {}),
        }),
      });
      const answer = await response.json().catch(() => ({}));
      if (!response.ok || typeof answer.script !== "string" || !answer.script.trim()) {
        throw new Error(typeof answer.error === "string" ? answer.error : "Aria could not inspect that region.");
      }
      const grounded = answer.script.trim();
      tutor.addContext(
        `A vision pass inspected only the student's selected board crop (${request.gesture}). ` +
        `${request.selectedText ? `The board text under it is "${request.selectedText}". ` : ""}` +
        `It concluded: ${grounded}`,
      );
      explainWithTutor(
        `${request.question} A vision pass of the selected crop found: ${grounded} ` +
        "Explain that exact selection now; do not broaden the answer to the whole board.",
      );
    } catch {
      // The text-under-selection and lesson context still make a precise answer possible when a
      // browser cannot rasterise an exotic renderer (video/cross-origin image).
      explainWithTutor(request.question);
    } finally {
      setExplainBusy(false);
    }
  }

  function startLesson() {
    unlockAudio(); // must run inside this click handler — that's what satisfies the autoplay gate
    setVoiceBlocked(false);
    lesson.startTeaching();
    if (REALTIME_TUTOR_ENABLED && autoVoiceAssistant && tutor.status === "idle") {
      // The click is a browser permission gesture: initialize once, listening for "Aria" (the gate
      // sends nothing to the model until it hears words for her), and leave the lecture playing.
      tutor.setMicEnabled(true);
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
      /*
       * PLAY TAKES THE FLOOR BACK. Pressing Play while Aria is still answering used to start the
       * lecture over her: a typed-chat answer is spoken outside the voice director, so nothing held
       * the lecture for it. Pressing Play is the student saying "carry on" — so she stops, and the
       * lecture continues. A live-session reply is silenced the same way; the session stays open.
       * EXPLICIT: after she answers, the lecture is held for the student (see holdForStudent), and
       * only an explicit resume lifts that hold — Play is exactly that.
       */
      if (chat.explainBoard) chat.closeExplanation();
      else chat.stopSpeaking();
      const tutorWasSpeaking = tutor.isSpeaking();
      if (tutorWasSpeaking) tutor.silence();
      lesson.requestResume({ explicit: true });
      // Just after silence() the director can still read her as speaking and defer; this is the
      // machine's own "she has finished" path, which honours the request at once.
      if (tutorWasSpeaking) lesson.flushDeferredResume();
    }
  }
  /**
   * Carry on after the teacher's quick question — skipped or answered.
   *
   * THE QUESTION IS OFTEN ASKED INTO SILENCE. The periodic check fires only while Aria is not
   * speaking, so there is frequently no narration to freeze under it. `requestResume()` then finds
   * nothing to continue, the mode never left `teaching`, and the lecture sat silent while the button
   * still showed Pause — until Pause then Resume forced a real mode change that restarted the beat.
   *
   * So when there is nothing frozen and this beat's narration is not live, record it as lost: the
   * recovery effect (keyed on `quiz.phase`, which this same tick sets back to "idle") restarts it.
   * A frozen lecture is still continued mid-sentence by `requestResume()` as before.
   */
  function resumeAfterQuestion() {
    lesson.requestResume();
    if (
      !voice.hasFrozenTeacher() &&
      narrationLiveForRef.current !== index &&
      stage === "board" &&
      !waitingForNextBeat &&
      !waitingOnCheckpoint
    ) {
      narrationLostForRef.current = index;
    }
  }
  function retryVoice() {
    unlockAudio();
    setVoiceBlocked(false);
    // Only Live Aria's output was held: the tap has resumed it. Restarting the part would replay
    // narration the student already heard.
    if (blockedLiveOnlyRef.current) {
      blockedLiveOnlyRef.current = false;
      return;
    }
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
    if (index < beats.length - 1) {
      emitAdhdEvent({ type: "beat-skipped" });
      goTo(index + 1);
      return;
    }
    // The planned next beat exists but has not reached the contiguous playback buffer yet. Stop
    // this beat once and wait at its completed frame; changing stage/index here used to restart the
    // same narration, while disabling Skip left the learner trapped on it.
    if (hasMoreBeats) {
      stopVoice();
      setDrawProgress(1);
      setWaitingForNextBeat(true);
    }
  }

  const hasStarted = lesson.mode !== "idle" || index > 0 || stage === "board";
  const progressPct = ((index + (stage === "board" ? 0.5 : 0)) / displayBeatCount) * 100;

  const statusText = waitingForNextBeat ? "preparing next part" : speaking ? "explaining" : waitingOnCheckpoint ? "waiting on you" : stage === "slide" ? "setting up" : "drawing";
  const accent = deafMode ? "var(--accent-deaf)" : "var(--hud-cyan)";
  const currentCaption = sentenceCue.text || beat.script;
  /*
   * The split PDF workspace is STRICT mode's screen. A reference lesson takes ideas from the document
   * rather than walking through it, so it gets the same screen as a typed topic: the board, the chat
   * beside it, no page viewer. Everything downstream of this flag falls back to that layout.
   */
  const pdfWorkspace = Boolean(documentId && sourceDocument && sourceScope) && sourceScope?.fidelity === "strict";
  // Where the spoken passage sits on the PDF, for the arrow that joins it to the board.
  const [pointerRect, setPointerRect] = useState<DOMRect | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  // In the source workspace the ask input lives in the bottom bar; accessibility tracks keep their panels.
  const chatInDock = pdfWorkspace && !deafMode && !adhd;
  /*
   * Which source pages the current part teaches, for the label that ties the board to the PDF's
   * highlight ("Part 2 of 5 · Energy transfer · page 1").
   */
  /*
   * A part whose source has a printed figure is taught ON that figure (SourceFigureBoard): the
   * student's own diagram, each part lit up as it is named. Everything else keeps its drawn board.
   */
  // Gated on the DOCUMENT, not the workspace: a reference lesson has no page viewer but still reuses a
  // printed figure on the part that matches it — the student's own diagram beats a redrawn one.
  // Never in STRICT: its PDF is on screen beside the board with the passage boxed, so a crop of the
  // same page on the board only repeated it. The slide keeps its drawn board there.
  const beatFigures = sourceScope && sourceScope.fidelity !== "strict" && isSuprnotesLessonInput(sourceDocument)
    ? sourceFiguresFor(sourceDocument.contentBlocks ?? [], beat.sourceBlockIds, sourceDocument.assets ?? [])
    : [];
  const spokenSentences = beatFigures.length
    ? splitSentences(beat.script ?? "").slice(0, (stage === "board" ? sentenceCue.index : 0) + 1)
    : [];
  const spokenSoFar = spokenSentences.join(" ");
  // A part can teach several figures (Figure 19.2, then 19.3): the one on the board is the one the
  // narration last turned to, replayed sentence by sentence so it is the same on every render.
  const beatFigure = beatFigures.length
    ? beatFigures[spokenSentences.reduce((current, sentence) => activeFigureIndex(beatFigures, sentence, current), 0)]
    : null;
  /*
   * The figure and the drawing TOGETHER. The book's own figure used to replace the animated board;
   * the student wants both — the real drawing from their page, and the board that explains it,
   * whatever kind of board the part has.
   * A wide figure (two trees side by side) sits above the board; a tall one beside it.
   */
  /* Strict: a note is written only if every content word in it is the source's own. */
  const boardNotePoints = !pdfWorkspace || isCheckpoint
    ? []
    : strictSource
      ? (() => {
          const source = beatSourceFor(beat);
          if (!source) return [];
          const vocab = sourceVocabulary(source);
          return boardNotesFor(beat).filter((point) => sentenceIsGrounded(point, vocab));
        })()
      : boardNotesFor(beat);
  const boardNotes = (embedded: boolean) => (
    <BoardNotes
      key={beat.id}
      points={boardNotePoints}
      sentenceIndex={stage === "board" ? sentenceCue.index : -1}
      sentenceTotal={sentenceCue.total}
      complete={drawProgress >= 1}
      embedded={embedded}
    />
  );
  const figureIsWide = beatFigure ? (beatFigure.crop.width * 0.77) / Math.max(0.01, beatFigure.crop.height) >= 1.35 : false;
  const beatSourcePages = pdfWorkspace && isSuprnotesLessonInput(sourceDocument)
    ? [...new Set((sourceDocument.contentBlocks ?? [])
        .filter((block) => beat.sourceBlockIds?.includes(block.id) && typeof block.pageNumber === "number")
        .map((block) => block.pageNumber as number))].sort((a, b) => a - b)
    : [];
  const voicePhase = derivePhase({
    status: tutor.status,
    // Audible speech only. `isSpeaking()` also covers her thinking and drawing, which showed
    // "Aria is speaking" with nothing to hear.
    ariaSpeaking: speaking || tutor.speaking || boardNarrating,
    // What the voice session actually knows. This was "live, unmuted, and the lecture is quiet" —
    // true through every pause and every narrated board, so it read "You're speaking" at nobody.
    studentSpeaking: tutor.voiceSession.state === "USER_SPEAKING",
    muted: tutor.muted,
    paused: !lesson.playing && hasStarted,
  });
  /*
   * THE QUESTIONS PANEL IS A SHEET, CLOSED UNTIL WANTED. A standing "chat with the tutor" beside
   * the board is extraneous while the student watches (and, in the Khanmigo trial, went unused);
   * it opens from the dock's Ask button, and opens itself the moment Aria answers or offers a
   * drawing, so nothing she says is missed. The deaf and ADHD panels stay: they carry the lesson.
   */
  const [askOpen, setAskOpen] = useState(false);
  const chatCount = chat.chat.length;
  const chatExplaining = chat.explaining;
  const seenChatCount = useRef(0);
  useEffect(() => {
    if (chatCount > seenChatCount.current || chatExplaining) setAskOpen(true);
    seenChatCount.current = chatCount;
  }, [chatCount, chatExplaining]);
  const sidePanelAlways = adhd || deafMode;
  const sideOpen = sidePanelAlways || askOpen;
  /*
   * ARIA'S FACE beside the board: a photoreal head lip-synced from her voice, on the student's own
   * GPU (components/avatar/AriaAvatar.tsx). Off by a tap, remembered per browser; gone by itself
   * where it cannot render. The ADHD track keeps its own drawn teacher.
   */
  const [avatarOn, setAvatarOn] = useState(true);
  const [avatarUnavailable, setAvatarUnavailable] = useState(false);
  useEffect(() => {
    let remembered = true;
    try { remembered = localStorage.getItem("aria.avatar") !== "off"; } catch { /* default on */ }
    if (!remembered) queueMicrotask(() => setAvatarOn(false));
  }, []);
  const toggleAvatar = () => setAvatarOn((on) => {
    try { localStorage.setItem("aria.avatar", on ? "off" : "on"); } catch { /* not remembered */ }
    return !on;
  });
  const avatarState: AvatarState = avatarStateFor(voicePhase, speaking || tutor.speaking);
  const showAvatar = avatarOn && !avatarUnavailable && !adhd && !pdfWorkspace;
  /*
   * WHERE ARIA STANDS. One instance flies between places (components/avatar/AvatarFlyer.tsx):
   * large on the section card when a part begins — the teacher introducing it — then beside the
   * board in her own column (never over the drawing), or at the top of the questions sheet while
   * it is open. On a screen too narrow for a column she takes the board's lower-right corner.
   */
  const mainRef = useRef<HTMLElement>(null);
  const presenterSlotRef = useRef<HTMLDivElement>(null);
  const asideSlotRef = useRef<HTMLDivElement>(null);
  const cornerSlotRef = useRef<HTMLDivElement>(null);
  const sheetSlotRef = useRef<HTMLDivElement>(null);
  const coverSlotRef = useRef<HTMLDivElement>(null);
  // Before the first Play she stands centre stage over the board; a section card is her stage too.
  const avatarPlace: "sheet" | "stage" | "beside" = sideOpen && !chatInDock ? "sheet" : showSectionCard || !hasStarted ? "stage" : "beside";
  const avatarSlots = avatarPlace === "sheet" ? [sheetSlotRef, asideSlotRef, cornerSlotRef] : avatarPlace === "stage" ? [presenterSlotRef, coverSlotRef, asideSlotRef, cornerSlotRef] : [asideSlotRef, cornerSlotRef];
  const avatarColumn = showAvatar && !sideOpen && !pdfWorkspace;
  const renderChatPanel = (variant: { compact?: boolean; inline?: boolean }) => (
    <ChatPanel
      onClose={sidePanelAlways ? undefined : () => setAskOpen(false)}
      chat={chat.chat}
      explaining={chat.explaining}
      listening={chat.listening}
      interim={chat.interim}
      voiceSupported={REALTIME_TUTOR_ENABLED ? true : chat.voiceSupported}
      onAsk={chat.ask}
      onAnswerOffer={chat.answerVisualOffer}
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
      liveAlwaysOn={REALTIME_TUTOR_ENABLED && autoVoiceAssistant}
      liveMuted={tutor.muted}
      onLiveMute={tutor.toggleMute}
      liveError={tutor.errorMessage}
      {...variant}
    />
  );

  // `reading-room` re-points the design tokens to their dark values for this subtree only. The
  // marketing pages are paper; the lesson is a darkened theatre, because the generated boards
  // paint light strokes on a dark ground and inverting that would break every animation the
  // pipeline produces. Every child keeps using the same token names.
  return (
    <main ref={mainRef} className="reading-room relative h-screen overflow-hidden bg-[var(--hud-bg)] text-[var(--hud-text)]">
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
      <div className="pointer-events-none absolute inset-0 bg-[var(--hud-bg)]" />

      {/* The board is the visual priority, so the layout is a flex COLUMN rather than absolute
          boxes: status bar, then the board taking every remaining pixel, then controls.

          The predecessor floated the header as an absolute overlay and pushed the board down with
          pt-[190px] to clear it — 190px of permanently dead space above the one surface the
          student is meant to read, and a value that had to be re-guessed whenever the header
          wrapped to a second line. In a flex column the header simply takes the height it needs
          and the board gets the rest, at any viewport, with no magic numbers. */}
      <div className="absolute inset-0 flex flex-col">
        <div ref={workspaceRef} className={pdfWorkspace
          /*
           * Source and board are ONE framed surface: side by side, a single hairline between them,
           * the full height of the screen. There is no header above and no chat row below — the
           * bottom bar carries leave, transport, the ask input and status in one line.
           */
          ? "relative m-2 grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)_auto] overflow-hidden rounded-[var(--radius)] border border-[var(--hud-line)] lg:m-3 lg:grid-cols-[minmax(22rem,1fr)_minmax(0,1.15fr)] lg:grid-rows-[minmax(0,1fr)_auto]"
          : `flex min-h-0 flex-1 gap-2 p-2 lg:gap-3 lg:p-3 xl:grid ${sideOpen ? "xl:grid-cols-[minmax(0,1fr)_340px]" : avatarColumn ? "xl:grid-cols-[minmax(0,1fr)_12.5rem]" : "xl:grid-cols-[minmax(0,1fr)]"}`}
        >
          {pdfWorkspace && sourceScope && (
            <PdfSourcePanel
              documentId={documentId}
              sourceDocument={sourceDocument}
              beats={beats}
              currentIndex={index}
              fidelity={sourceScope.fidelity}
              embedded
              activeSentence={sentenceCue.text}
              onPointerRect={setPointerRect}
            />
          )}
          {pdfWorkspace && (
            <SourceToBoardArrow pointer={pointerRect} workspace={workspaceRef.current} board={boardSurfaceRef.current} />
          )}
          {/*
           * Labelled so assistive tech and the annotation layer can both find the board. The SVG
           * inside is aria-hidden, so without this the teaching surface is nameless to a screen
           * reader — and the "Explain this" anchor has nothing to measure against.
           */}
          <section ref={boardSurfaceRef} aria-label="Teaching board" className={`relative min-h-0 flex-1 overflow-hidden bg-[var(--hud-surface)] ${pdfWorkspace ? "flex flex-col" : "rounded-[var(--radius)] border border-[var(--hud-line)]"}`}>
            {/* Aria's corner, for screens with no room for her column beside the board. */}
            {showAvatar && <div ref={cornerSlotRef} aria-hidden="true" className="pointer-events-none absolute bottom-2 right-2 z-10 hidden h-[10.5rem] w-[8.25rem] md:block xl:hidden" />}
            {/* Centre stage before the lesson starts: she greets, then flies to her column on Play. */}
            {showAvatar && !hasStarted && !showSectionCard && (
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
                <div ref={coverSlotRef} className="aspect-[4/5] h-[min(64%,28rem)]" />
              </div>
            )}
            {/*
             * THE LINK BETWEEN THE TWO HALVES. The same amber as the source highlight, naming the
             * part and where it comes from, level with the source panel's own bar — so the board
             * visibly explains the passage lit up beside it.
             */}
            {pdfWorkspace && (
              <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--hud-line)] bg-[var(--hud-surface)] px-3 text-[0.74rem]">
                <span className="shrink-0 rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 font-bold tabular-nums text-[var(--hud-cyan)]">
                  Part {index + 1} of {displayBeatCount}
                </span>
                <span className="min-w-0 truncate font-semibold text-[var(--hud-text)]">{beat.title}</span>
                {beatSourcePages.length > 0 && (
                  <span className="ml-auto hidden shrink-0 items-center gap-1 text-[var(--hud-cyan)] sm:flex">
                    <span aria-hidden="true">←</span>
                    highlighted on {beatSourcePages.length > 1 ? `pages ${beatSourcePages[0]}–${beatSourcePages[beatSourcePages.length - 1]}` : `page ${beatSourcePages[0]}`}
                  </span>
                )}
              </div>
            )}
            {/* Notes ABOVE the drawing: what Aria is saying is read first, right under the part strip, and
                sits where the arrow from the PDF enters the board. */}
            {/* With a figure, the notes sit beside it instead (see the figure layout below). */}
            {pdfWorkspace && !isCheckpoint && !beatFigure && boardNotes(false)}
            <div className={pdfWorkspace ? "relative min-h-0 flex-1" : "contents"}>
            {isCheckpoint ? (
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
            ) : canvasLesson ? (
              <div className="relative h-full">
                <PaintSignal key={beat.id} onPainted={handleBoardPainted} />
                <LessonCanvas
                  panels={canvasPanels}
                  currentIndex={canvasIndex}
                  sentence={stage === "board" ? narrationSentenceTiming(beat.script, sentenceCue.index, drawProgress).index : -1}
                  sentenceProgress={narrationSentenceTiming(beat.script, sentenceCue.index, drawProgress).progress}
                  finished={narrationDoneIndex === index}
                  waitingForStudent={canvasHoldIndex === index}
                  playing={lesson.playing}
                  topic={title}
                  onSpeak={speakCanvasLine}
                  onTellAria={tellAriaCanvas}
                  knowledge={canvasKnowledge}
                  onTaskResult={recordCanvasTask}
                  onOpenEarlier={(from) => {
                    lesson.pause("user");
                    setPeek(from);
                  }}
                  onContinue={() => {
                    setCanvasHoldIndex(null);
                    bumpInteraction();
                    advanceFromCheckpoint();
                  }}
                />
                {peek && <BoardPeek target={peek} onClose={() => setPeek(null)} />}
              </div>
            ) : (
              <BoardStage
                boardKey={beat.id}
                sections={priorBoardSections}
                move={teachingEntry?.move}
                transition={teachingEntry?.move === "continue" || teachingEntry?.move === "refer-back" ? "slide" : "erase"}
                /*
                 * The section card, over a board that is already mounting behind it. It names the
                 * subtopic being started and then gets out of the way the moment the board has
                 * something to show — so the title is read DURING the board's preparation rather
                 * than instead of it. A continuation pass passes null: the second board of one
                 * subtopic is not a new section and must not re-announce itself.
                 */
                title={showSectionCard ? beat.title : null}
                titleEyebrow={`Part ${index + 1} of ${displayBeatCount}`}
                /* While the board is still being generated, say so on the card rather than leaving
                   the student in front of a silent title wondering whether the lecture has hung. */
                titlePending={currentAnimationPending}
                onBoardPainted={handleBoardPainted}
                presenterSlot={showAvatar ? presenterSlotRef : undefined}
              >
              <div className="relative h-full">
                {beatFigure ? (
                  /*
                   * FIGURE, NOTES AND BOARD, EACH AT A USEFUL SIZE. Stacked as three bands (notes, then
                   * figure, then board) every one of them came out small and zoomed out. A wide
                   * figure now shares a top strip with the notes and the board takes the full width
                   * below; a tall figure runs down the left beside the notes and the board.
                   */
                  figureIsWide ? (
                    <div className="flex h-full min-h-0 flex-col bg-[#fbfbf8]">
                      <div className="flex h-[38%] min-h-0 shrink-0 border-b border-slate-200">
                        <div className="min-w-0 flex-[3]">
                  <SourceFigureBoard
                    key={beat.id}
                    documentId={documentId}
                    pageNumber={beatFigure.pageNumber}
                    crop={beatFigure.crop}
                    labels={beatFigure.labels}
                    caption={beatFigure.caption}
                    sentence={stage === "board" ? sentenceCue.text : ""}
                    spoken={stage === "board" ? spokenSoFar : ""}
                  />
                        </div>
                        {boardNotePoints.length > 0 && <div className="min-w-0 flex-[2] border-l border-slate-200">{boardNotes(true)}</div>}
                      </div>
                      <div className="relative min-h-0 flex-1">
                        <Board key={beat.id} beat={beat} sentenceCue={sentenceCue} drawProgress={drawProgress} paused={hasStarted && !lesson.playing} onSandboxReady={handleSandboxReady} />
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full min-h-0 bg-[#fbfbf8]">
                      <div className="h-full w-[36%] min-w-0 shrink-0 border-r border-slate-200">
                  <SourceFigureBoard
                    key={beat.id}
                    documentId={documentId}
                    pageNumber={beatFigure.pageNumber}
                    crop={beatFigure.crop}
                    labels={beatFigure.labels}
                    caption={beatFigure.caption}
                    sentence={stage === "board" ? sentenceCue.text : ""}
                    spoken={stage === "board" ? spokenSoFar : ""}
                  />
                      </div>
                      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                        {boardNotePoints.length > 0 && <div className="max-h-[34%] min-h-0 shrink-0 border-b border-slate-200">{boardNotes(true)}</div>}
                        <div className="relative min-h-0 flex-1">
                          <Board key={beat.id} beat={beat} sentenceCue={sentenceCue} drawProgress={drawProgress} paused={hasStarted && !lesson.playing} onSandboxReady={handleSandboxReady} />
                        </div>
                      </div>
                    </div>
                  )
                ) : (
                  <Board key={beat.id} beat={beat} sentenceCue={sentenceCue} drawProgress={drawProgress} paused={hasStarted && !lesson.playing} onSandboxReady={handleSandboxReady} />
                )}
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
                {(deafMode || captions) && <div
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
                </div>}
              </div>
              </BoardStage>
            )}
            </div>

            {/* Fresh explanation board for a chat question */}
            {chat.explainBoard && (
              <ExplainOverlay board={chat.explainBoard} progress={chat.drawProgress} onClose={chat.closeExplanation} />
            )}

            {/* Live-tutor board (drawn by the realtime show_board tool). Closing it just clears the
                board — the live session stays active and the tutor keeps talking. */}
            {liveBoards.length > 0 && (
              <ExplainOverlay
                board={liveBoards[liveBoards.length - 1]}
                earlier={liveBoards.slice(0, -1)}
                progress={liveBoardProgress}
                onClose={clearLiveBoard}
              />
            )}

            {/* An earlier slide, back for a question about it; the lecture resumes underneath. */}
            {revisit && beats[revisit.index] && (() => {
              const past = beats[revisit.index];
              const sentences = splitNarrationSentences(past.script);
              return (
                <RevisitOverlay
                  slideNumber={revisit.index + 1}
                  title={past.title}
                  marks={revisit.marks}
                  note={revisit.note}
                  onContinue={() => {
                    if (!lesson.playing) togglePlay();
                    setRevisit(null);
                  }}
                >
                  <Board
                    beat={past}
                    sentenceCue={{ index: Math.max(0, sentences.length - 1), total: Math.max(1, sentences.length), text: sentences[sentences.length - 1] ?? past.script }}
                    drawProgress={1}
                  />
                </RevisitOverlay>
              );
            })()}

            {/* While a board is being generated, the whole board says so — no silent 20 s wait. */}
            {(tutor.status === "drawing" || chat.drawingBoard) && <TeacherDrawingNotice />}

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
                  resumeAfterQuestion();
                }}
              />
            )}
            {/*
             * The student's own marks, above the board and below any status veil. One layer for
             * pen, highlighter and eraser — the two old overlays could not be used together.
             */}
            <AnnotationLayer
              boardId={beat.id}
              tool={boardTool}
              state={annotations}
              onChange={setAnnotations}
              visible
              onStrokeFinished={(stroke) => {
                // Any mark over real board text is a question waiting to be asked — pen as much as
                // highlighter. Pushed into the live session so "what's that?" by voice already has it.
                if (stroke.coveredText) pushHighlightContext(marksNarrative([stroke]) || stroke.coveredText);
                else describeMarkForTutor(stroke);
                // Offer to explain what was just marked, rather than silently posting the whole
                // board to the model the way the old auto-describe did.
                setExplainDismissed(false);
              }}
            />
          </section>

          {avatarColumn && (
            <div className="hidden min-h-0 xl:flex xl:flex-col xl:justify-end">
              <div ref={asideSlotRef} aria-hidden="true" className="aspect-[4/5] w-full" />
            </div>
          )}

          {!chatInDock && sideOpen && <div className={pdfWorkspace
            ? "flex min-h-0 flex-col gap-2 border-t border-[var(--hud-line)] p-2 lg:col-span-2"
            // A column beside the board on a wide screen; a sheet over its right edge on a narrow one.
            : "home-sheet-in fixed inset-y-2 right-2 z-40 flex w-[min(22rem,92vw)] min-h-0 flex-col gap-3 xl:static xl:inset-auto xl:z-auto xl:w-auto [&>*:last-child]:min-h-0 [&>*:last-child]:flex-1"}
          >
            {/*
              THE teacher, at a size that actually draws the eye.
              She lived at 88px over the board and covered the slide title; here she has a 340px
              column to herself. Rendered outside ChatPanel so the standard player is untouched.
            */}
            {showAvatar && <div ref={sheetSlotRef} aria-hidden="true" className="mx-auto aspect-[4/5] h-[9rem] shrink-0 xl:h-[11rem]" />}
            {adhd && (
              <div className="flex shrink-0 flex-col items-center gap-2 rounded-[1.5rem] border border-[var(--hud-line)] bg-[var(--hud-bg-2)] px-3 py-3">
                <TeacherAvatar speaking={speaking} size={150} expression={face} />
                {reproach && (
                  <p
                    data-reproach
                    className={`w-full rounded-xl px-3 py-2 text-center text-[0.78rem] font-semibold leading-snug beat-fade-in ${
                      face === "furious"
                        ? "bg-[var(--danger-dim)] text-[var(--hud-danger)] ring-1 ring-[var(--hud-line)]"
                        : face === "sad"
                          ? "bg-[var(--warn-dim)] text-[var(--hud-warn)] ring-1 ring-[var(--hud-line)]"
                          : "bg-[var(--ok-dim)] text-[var(--ok)] ring-1 ring-[var(--hud-line)]"
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
                signingTranscript={tutor.speaking && liveSigningCaption ? liveSigningCaption : currentCaption}
                signingActive={speaking || tutor.speaking}
                waitingOnCheckpoint={waitingOnCheckpoint}
                stage={stage}
              />
            ) : (
              renderChatPanel({ compact: pdfWorkspace })
            )}
          </div>}
        </div>

        {/* The status bar. Now a flow element at the top of the column rather than an absolute
            overlay: it takes exactly the height it needs, the board takes the rest, and a header
            that wraps to two lines can no longer bleed over the board or require the pt-[190px]
            spacer the previous layout depended on.

            `order-first` keeps it visually above the board while leaving it after the board in the
            DOM would have hurt nothing — but it reads top-to-bottom for a screen reader this way,
            which matches the visual order. */}
        <BoardDock
          playing={lesson.playing}
          onTogglePlay={() => (hasStarted ? togglePlay() : startLesson())}
          onPrevious={index > 0 ? () => goTo(index - 1) : undefined}
          onNext={skipForward}
          onSummarize={onSummarize}
          summaryUnlocked={summaryUnlocked}
          speed={rate}
          onSpeedChange={setRate}
          canGoPrevious={index > 0}
          canGoNext={index < displayBeatCount - 1 && !waitingForNextBeat}
          tool={boardTool}
          onToolChange={setBoardTool}
          /* Closing the tools puts the board back: the highlight was the question, and it has been
             asked. Pen notes stay, and Undo restores a highlight closed by mistake. */
          onCloseTools={() => {
            setAnnotations((current) => clearKind(current, beat.id, "highlight"));
            setExplainDismissed(true);
          }}
          onUndo={() => setAnnotations(annUndo(annotations))}
          canUndo={annCanUndo(annotations)}
          askOpen={askOpen}
          onToggleAsk={!chatInDock && !sidePanelAlways ? () => setAskOpen((open) => !open) : undefined}
          avatarOn={showAvatar}
          onToggleAvatar={!avatarUnavailable && !adhd && !pdfWorkspace ? toggleAvatar : undefined}
          micOn={tutor.status === "live" && !tutor.muted}
          onToggleMic={() => {
            if (tutor.status === "live") tutor.toggleMute();
            else void tutor.start();
          }}
          micAvailable={REALTIME_TUTOR_ENABLED}
          positionLabel={
            teachingEntry?.sectionInConcept && teachingEntry.sectionInConcept > 1
              ? `${teachingProgress.current?.title ?? beat.title} · board ${teachingEntry.sectionInConcept}`
              : `Part ${index + 1} of ${displayBeatCount}`
          }
          busy={explainBusy}
          explainSelectionLabel={
            !explainDismissed && selectionRequest
              ? selectionRequest.selectedText
                ? `Explain “${selectionRequest.selectedText.length > 30 ? `${selectionRequest.selectedText.slice(0, 30)}…` : selectionRequest.selectedText}”`
                : "Explain selected region"
              : undefined
          }
          onExplainSelection={selectionRequest ? () => void explainMarkedRegion(selectionRequest) : undefined}
          /* The source workspace has no header: leave, the ask input and status ride in this bar. */
          wide={pdfWorkspace}
          onUnderstood={onUnderstood}
          leading={pdfWorkspace ? (
            <button
              onClick={onExit}
              aria-label="Leave the lecture"
              title="Leave the lecture"
              className="flex h-11 shrink-0 items-center gap-1 rounded-xl px-2.5 text-[0.84rem] font-medium text-[var(--hud-text-dim)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--hud-cyan)]"
            >
              <ChevronLeft size={18} />
              <span className="hidden xl:inline">Leave</span>
            </button>
          ) : undefined}
          center={chatInDock ? renderChatPanel({ inline: true }) : undefined}
          trailing={pdfWorkspace ? <VoiceState phase={voicePhase} className="hidden shrink-0 lg:flex" /> : undefined}
        />

        {/*
         * THE TOP STRIP: who is teaching, what part, and one status word. Nothing else.
         *
         * This replaces a header carrying eight icon buttons (rate, draw, highlight, export, skip,
         * play, restart, exit) of which exactly one had a visible label, plus two separate controls
         * that both exited the lecture. Transport now lives in the dock BELOW the board, where it
         * cannot cover the teaching content.
         *
         * Not in the source workspace: there the board's own "Part N · title" strip names what is
         * being taught, and a second title bar above it only took height from the PDF.
         */}
        {!pdfWorkspace && <header className="order-first flex shrink-0 items-center justify-between gap-3 border-b border-[var(--hud-line)] bg-[var(--hud-bg-2)] px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={onExit}
              aria-label="Leave the lecture"
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[0.82rem] font-medium text-[var(--hud-text-dim)] transition hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--listening)]"
            >
              <ChevronLeft size={17} />
              <span className="hidden sm:inline">Leave</span>
            </button>
            <div className="min-w-0">
              {/* The title alone: what is established and what comes next is the lesson's own business. */}
              <p className="truncate font-display text-[1.15rem] leading-tight text-[var(--hud-text)]">{title}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <BoardTelemetry beats={beats} index={index} planned={displayBeatCount} />
            <VoiceState phase={voicePhase} />
          </div>
        </header>}

        {/* ARIA, flown to whichever slot is hers (see `avatarPlace`): her bust as a cutout, a soft
            light behind her when she speaks, pointer events passing through. */}
        {showAvatar && (
          <AvatarFlyer within={mainRef} place={`${avatarPlace}:${sideOpen ? 1 : 0}:${showSectionCard ? 1 : 0}:${hasStarted ? 1 : 0}`} slots={avatarSlots} state={avatarState} onUnavailable={() => setAvatarUnavailable(true)} />
        )}

        {voiceBlocked && (
          <div className="absolute left-4 right-4 top-28 z-50 flex items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-[var(--hud-line)] bg-[var(--warn-dim)] px-5 py-3.5 shadow-[var(--elev-2)] lg:left-6 lg:right-6">
            <p className="text-sm font-medium text-[var(--hud-text)]">
              Your browser blocked the teacher&rsquo;s voice (autoplay is muted until you interact). Tap to enable sound.
            </p>
            <button onClick={retryVoice} className="hud-btn-primary shrink-0 px-5 py-2 text-sm">
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
  signingTranscript,
  signingActive,
  waitingOnCheckpoint,
  stage,
}: {
  beat: Beat;
  caption: string;
  captionLog: string[];
  speaking: boolean;
  signingTranscript: string;
  signingActive: boolean;
  waitingOnCheckpoint: boolean;
  stage: Stage;
}) {
  const visualState = waitingOnCheckpoint ? "Checkpoint waiting" : speaking ? "Caption live" : stage === "slide" ? "Visual setup" : "Board drawing";
  const terms = deafKeywords(beat.title, caption);
  const lines = captionLog.length ? captionLog : [caption];

  return (
    <aside className="relative flex h-full min-h-0 flex-col gap-3 overflow-y-auto rounded-xl border border-[var(--accent-deaf)]/25 bg-[var(--hud-surface)] p-4 shadow-[var(--elev-1)]">
      <HudCorners accent="var(--accent-deaf)" />

      <div className="rounded-lg border border-[var(--accent-deaf)]/25 bg-[var(--accent-deaf-glow)] px-4 py-3">
        <p className="text-[0.65rem] font-black uppercase tracking-[0.18em] text-[var(--accent-deaf)]">Deaf mode</p>
        <h2 className="mt-1 text-lg font-black text-[var(--hud-text)]">Caption-first lesson</h2>
      </div>

      <DeafSigningExtension transcript={signingTranscript} active={signingActive} />

      <div className="rounded-lg border border-[var(--hud-line)] bg-[var(--hud-surface-2)] p-4">
        <p className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-[var(--hud-text-dim)]">Visual sound cue</p>
        <div className="mt-3 flex items-center gap-3">
          <span className={`size-4 rounded-full ${speaking ? "animate-pulse bg-[var(--accent-deaf)] shadow-[0_0_20px_var(--accent-deaf)]" : waitingOnCheckpoint ? "bg-[var(--hud-warn)]" : "bg-[var(--hud-line-strong)]"}`} />
          <p className="text-base font-black text-[var(--hud-text)]">{visualState}</p>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--hud-line)] bg-[var(--hud-surface-2)] p-4">
        <p className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-[var(--hud-text-dim)]">Current caption</p>
        <p className="mt-3 text-base font-bold leading-snug text-[var(--hud-text)]">{caption}</p>
      </div>

      <div className="rounded-lg border border-[var(--hud-line)] bg-[var(--hud-surface-2)] p-4">
        <p className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-[var(--hud-text-dim)]">Key terms</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {terms.map((term) => (
            <span key={term} className="rounded-full border border-[var(--accent-deaf)]/25 bg-[var(--accent-deaf-glow)] px-3 py-1.5 text-xs font-black text-[var(--accent-deaf)]">
              {term}
            </span>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-[var(--hud-line)] bg-[var(--hud-surface-2)] p-4">
        <p className="text-[0.65rem] font-black uppercase tracking-[0.16em] text-[var(--hud-text-dim)]">Recent transcript</p>
        <div className="mt-3 flex max-h-full flex-col gap-2 overflow-y-auto pr-1">
          {lines.map((line, i) => (
            <p key={`${i}-${line}`} className="rounded-lg bg-[var(--hud-surface)] px-3 py-2 text-sm font-medium leading-snug text-[var(--hud-text)]">
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
  paused = false,
  onSandboxReady,
}: {
  beat: Beat;
  sentenceCue: { index: number; total: number; text: string };
  drawProgress?: number;
  /**
   * The lesson is paused. The board's pen stops on the word it is writing instead of carrying on
   * through everything already revealed (ReactAnimationSandbox `settled`).
   */
  paused?: boolean;
  /** The generated animation is on screen and listening — see ReactAnimationSandbox.onReady. */
  onSandboxReady?: () => void;
}) {
  // Enrichment keeps a beat id stable while replacing its provisional drawing. Key the visual
  // subtree by the actual payload as well, so a sandbox/Manim upgrade resets renderer-local state
  // without remounting the player or restarting narration.
  const visualRevision = visualFingerprint(beat);
  return (
    <div className="absolute inset-0 bg-slate-950">
      <VisualDirector key={`${beat.id}:${visualRevision}`} beat={beat} sentenceCue={sentenceCue} drawProgress={drawProgress} paused={paused} onSandboxReady={onSandboxReady} />
    </div>
  );
}

function visualFingerprint(beat: Beat): string {
  const value = JSON.stringify({ draw: beat.draw, manimVideoUrl: beat.manimVideoUrl });
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function VisualDirector({
  beat,
  sentenceCue,
  drawProgress,
  paused = false,
  onSandboxReady,
}: {
  beat: Beat;
  sentenceCue: { index: number; total: number; text: string };
  drawProgress?: number;
  paused?: boolean;
  onSandboxReady?: () => void;
}) {
  const text = sentenceCue.text;
  const cue = sentenceCue.index;
  const sentenceTiming = narrationSentenceTiming(beat.script, cue, drawProgress ?? 0);
  const coordinatedDraw = useMemo(
    () => beat.draw
      ? coordinateTeachingTimeline(beat.draw, {
          title: beat.title,
          objective: beat.conceptObjective ?? beat.teacherMove,
          script: beat.script,
        }).draw
      : undefined,
    [beat.draw, beat.title, beat.conceptObjective, beat.teacherMove, beat.script],
  );
  const coordinatedBeat = coordinatedDraw ? { ...beat, draw: coordinatedDraw } : beat;
  const bespokeScene = isCuratedPhotosynthesisBeat(beat) ? photosynthesisSceneForBeat(beat.id, cue) : null;
  // Once the sandboxed animation fails for this beat (transpile error, runtime throw, watchdog
  // timeout), show an explicit unavailable board for the rest of this beat's lifetime. Resets
  // naturally: Board renders VisualDirector with `key={beat.id}`, so this state is fresh per beat.
  const [sandboxFailed, setSandboxFailed] = useState(false);
  // Same lifetime rule as sandboxFailed: once Manim fails for this beat, fall back to the live
  // board for the rest of the beat rather than retrying a render that costs seconds.
  const [manimFailed, setManimFailed] = useState(false);
  const rendererSelection = coordinatedDraw
    ? selectAnimationRenderer(coordinatedDraw, {
        gsapEnabled: GSAP_RENDER_ENABLED,
        manimEnabled: MANIM_RENDER_ENABLED && !manimFailed,
      })
    : null;

  const canvasOp = beat.draw?.ops.find((op) => (op as { kind: string }).kind === "canvasBoard") as { spec?: CanvasBoardSpec } | undefined;
  if (canvasOp?.spec) {
    return <LessonCanvas panels={[{ key: beat.id, spec: canvasOp.spec }]} currentIndex={0} sentence={Number.MAX_SAFE_INTEGER} sentenceProgress={1} finished waitingForStudent={false} topic={beat.title} onSpeak={() => {}} onTellAria={() => {}} onContinue={() => {}} />;
  }

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
  if (coordinatedDraw) {
    // A chalkBoard beat: its real chalk ops are authored server-side; unwrap them into LiveSketch
    // (chalk rendering). Pending → preparing card; failed → unavailable card (never the old
    // template board, per the design).
    const chalkOp = findChalkBoardOp(coordinatedBeat);
    if (chalkOp?.kind === "chalkBoard") {
      if (chalkOp.ops && chalkOp.ops.length > 0 && BLACKBOARD_GEN_ENABLED) {
        return (
          <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-2 text-white lg:p-3">
            <LiveSketch key={beat.id} script={{ ...coordinatedDraw, ops: chalkOp.ops }} progress={sentenceTiming.alignedProgress} />
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

    const animationOp = findReactAnimationOp(coordinatedBeat);
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
            /*
             * PAUSE STOPS THE PEN. The sandbox has always had this switch, and nothing turned it on:
             * paused, the narration froze but the pen kept writing every line already revealed and
             * only stopped seconds later, when it ran out of text. Now it finishes the word it is on
             * and stops, and picks up from there on Play.
             */
            settled={paused}
            onReady={onSandboxReady}
            // A failed sandbox falls back to a board that paints synchronously, so from the title
            // card's point of view the board is ready — it must not wait on a ready that never comes.
            onError={() => {
              setSandboxFailed(true);
              onSandboxReady?.();
            }}
          />
          <RendererBadge kind="sandbox" detail={animationChipDetail(animationOp.model, animationOp.trial?.costUsd)} />
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
      const structureOp = coordinatedDraw.ops.find((op) => op.kind === "structureScene");
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
      const plotOp = coordinatedDraw.ops.find((op) => op.kind === "plotBoard");
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
      const equationOp = coordinatedDraw.ops.find((op) => op.kind === "equationBoard");
      if (equationOp?.kind === "equationBoard" && equationOp.spec) {
        return (
          <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-2 text-white lg:p-3">
            <EquationBoard key={beat.id} spec={equationOp.spec as EquationSpec} progress={drawProgress} />
            <RendererBadge kind="equation" />
          </section>
        );
      }
    }
    if (rendererSelection?.renderer === "code") {
      const codeOp = coordinatedDraw.ops.find((op) => op.kind === "codeBoard");
      if (codeOp?.kind === "codeBoard" && codeOp.spec) {
        return (
          <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-2 text-white lg:p-3">
            <CodeBoard key={beat.id} spec={codeOp.spec as CodeSpec} progress={drawProgress} />
            <RendererBadge kind="code" />
          </section>
        );
      }
    }
    if (rendererSelection?.renderer === "gsap") {
      return (
        <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-2 text-white lg:p-3">
          <GsapSketch key={beat.id} script={coordinatedDraw} progress={drawProgress} />
          <RendererBadge kind="gsap" />
        </section>
      );
    }
    if (rendererSelection?.renderer === "manim") {
      return (
        <section className="relative h-full min-h-0 overflow-hidden bg-slate-950 p-2 text-white lg:p-3">
          {/* ManimBoard renders its own badge: only it knows whether the video is ready or it
              is currently falling back to the live SVG board. */}
          <ManimBoard
            key={beat.id}
            script={coordinatedDraw}
            progress={drawProgress}
            savedUrl={beat.manimVideoUrl}
            onError={() => setManimFailed(true)}
          />
        </section>
      );
    }
    const manimSceneOp = coordinatedDraw.ops.find((op) => op.kind === "manimScene");
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
        <LiveSketch key={beat.id} script={coordinatedDraw} progress={drawProgress} />
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

/**
 * The math lives in lib/narrationClock.ts, beside its inverse, so the round trip between what
 * lib/voice.ts emits and what the board reads can be tested against the real code.
 */
function narrationSentenceTiming(script: string, cueIndex: number, beatProgress: number) {
  return timingFromProgress(splitNarrationSentences(script).map(sentenceWeight), cueIndex, beatProgress);
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

/**
 * THE ARROW FROM THE PDF TO THE BOARD.
 *
 * The passage being spoken is marked on the page, and the board beside it explains that passage —
 * but nothing on screen joined the two, so the student had to infer the connection. A curved amber
 * arrow now runs from the marked passage across the seam into the board, following the passage as
 * it moves and as the PDF scrolls. Hidden when the passage is out of view or the panes are stacked.
 */
function SourceToBoardArrow({ pointer, workspace, board }: { pointer: DOMRect | null; workspace: HTMLElement | null; board: HTMLElement | null }) {
  if (!pointer || !workspace || !board) return null;
  const frame = workspace.getBoundingClientRect();
  const target = board.getBoundingClientRect();
  // Only when the source and the board sit side by side.
  if (target.left < pointer.right) return null;
  const sx = pointer.right - frame.left + 22;
  const sy = pointer.top + pointer.height / 2 - frame.top;
  const ex = target.left - frame.left + 46;
  const ey = Math.max(target.top - frame.top + 90, Math.min(target.bottom - frame.top - 120, sy));
  const bend = Math.max(60, (ex - sx) * 0.45);
  const path = `M ${sx} ${sy} C ${sx + bend} ${sy}, ${ex - bend} ${ey}, ${ex} ${ey}`;
  return (
    <svg className="pointer-events-none absolute inset-0 z-30 hidden h-full w-full overflow-visible lg:block" aria-hidden="true">
      <defs>
        <marker id="source-board-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
        </marker>
      </defs>
      <circle cx={sx} cy={sy} r="4.5" fill="var(--accent)" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeDasharray="7 6" markerEnd="url(#source-board-head)" className="source-board-arrow" />
      <style>{`.source-board-arrow{animation:source-board-flow 1.1s linear infinite}@keyframes source-board-flow{to{stroke-dashoffset:-26}}@media (prefers-reduced-motion:reduce){.source-board-arrow{animation:none}}`}</style>
    </svg>
  );
}

/**
 * WHAT ARIA IS SAYING, WRITTEN ON THE BOARD AS SHE SAYS IT.
 *
 * A board could hold a sparse drawing while the narration ran on for a minute, so the teacher
 * appeared to talk without writing. Under the drawing, the part's key points are now written one
 * at a time, each when the voice reaches its share of the narration — timed by the voice itself,
 * so the writing can never run ahead of or behind what is being said.
 */
function BoardNotes({ points, sentenceIndex, sentenceTotal, complete, embedded = false }: { points: string[]; sentenceIndex: number; sentenceTotal: number; complete: boolean; /** Fills a column beside a figure instead of a band above the board. */ embedded?: boolean }) {
  const notes = points.map((point) => point.trim()).filter(Boolean).slice(0, 6);
  if (notes.length === 0) return null;
  const total = Math.max(1, sentenceTotal);
  const shown = complete
    ? notes.length
    : sentenceIndex < 0
      ? 0
      : notes.filter((_, k) => sentenceIndex >= Math.floor((k * total) / notes.length)).length;
  return (
    <div className={embedded ? "h-full overflow-y-auto bg-[#fbfbf8] px-4 py-3" : "shrink-0 border-b border-slate-200 bg-[#fbfbf8] px-5 py-3"} style={embedded ? undefined : { maxHeight: "34%" }}>
      <style>{`@font-face{font-family:"Aria Board";src:url(/fonts/Nunito-SemiBold.ttf) format("truetype");font-weight:600;font-display:swap}.board-note-write{animation:board-note-write .7s steps(24,end) both}@keyframes board-note-write{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}@media (prefers-reduced-motion:reduce){.board-note-write{animation:none}}`}</style>
      <ol className="space-y-1.5 overflow-hidden" style={{ fontFamily: '"Aria Board","Nunito",system-ui,sans-serif' }}>
        {notes.map((note, k) => (
          <li
            key={k}
            className={`flex gap-2.5 text-[0.98rem] font-semibold leading-snug transition-opacity duration-300 ${k < shown ? "opacity-100" : "opacity-0"}`}
          >
            <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[0.7rem] ${k === shown - 1 && !complete ? "bg-amber-400 text-[#1a1206]" : "bg-slate-200 text-slate-600"}`}>{k + 1}</span>
            <span className={`text-slate-800 ${k < shown ? "board-note-write" : ""} ${k === shown - 1 && !complete ? "underline decoration-amber-400 decoration-2 underline-offset-4" : ""}`}>{note}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The notes written on a board: its key points, then any key claim that says something the points
 * do not — up to six, in the order the script makes them. Two or three points alone left the notes
 * panel thin while the narration covered much more.
 */
function boardNotesFor(beat: Beat): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...(beat.points ?? []), ...(beat.keyClaims ?? [])]) {
    const note = raw.trim().replace(/\.$/, "");
    const key = note.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!note || seen.has(key) || [...seen].some((k) => k.includes(key) || key.includes(k))) continue;
    seen.add(key);
    out.push(note);
    if (out.length >= 6) break;
  }
  return out;
}

/** The canvas boards of a lecture, in order; empty for a lecture taught on ordinary boards. */
function isCanvasBeat(b: Beat | undefined): boolean {
  return Boolean(b?.draw?.ops.some((o) => (o as { kind: string }).kind === "canvasBoard"));
}

function canvasPanelsOf(beats: Beat[]): CanvasPanelInput[] {
  return beats.flatMap((b) => {
    const op = b.draw?.ops.find((o) => (o as { kind: string }).kind === "canvasBoard") as { spec?: CanvasBoardSpec } | undefined;
    return op?.spec ? [{ key: b.id, spec: op.spec }] : [];
  });
}

/** Reports "the board has painted" two frames after mounting — what BoardStage does for its boards. */
function PaintSignal({ onPainted }: { onPainted: () => void }) {
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(onPainted);
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [onPainted]);
  return null;
}

/** Her face follows the voice: talking (hers or the lecture's) speaks, a reply being formed thinks, an open mic listens. */
function avatarStateFor(phase: VoicePhase, talking: boolean): AvatarState {
  if (talking || phase === "aria-speaking") return "speaking";
  if (phase === "thinking" || phase === "drawing" || phase === "connecting" || phase === "reconnecting") return "thinking";
  if (phase === "listening" || phase === "student-speaking") return "listening";
  return "idle";
}
