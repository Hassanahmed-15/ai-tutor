"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Mic, MicOff, Pause, Play, Send, Square, Volume2, VolumeX } from "lucide-react";
import { HudCorners } from "../hud/HudKit";
import { TeacherAvatar } from "../TeacherAvatar";
import { useGeminiLiveTutor } from "@/lib/useGeminiLiveTutor";
import { DESIGN_CUES, LESSON_DESIGN_TOOLS } from "@/lib/lessonDesignContract";
import {
  LESSON_DESIGN_STAGES,
  estimateRemainingMs,
  formatRemaining,
  progressFor,
  spokenPercent,
  stageById,
  stageIndex,
  type LessonDesignStageId,
} from "@/lib/lessonDesignStages";
import { BuildTimeline } from "./BuildTimeline";
import type { ProgressiveLectureSnapshot } from "@/lib/progressiveLectureTypes";

/**
 * Live Lesson Design Mode — what the student sees while their lesson is generated.
 *
 * REPLACES a spinner and one line of status text. The problem with that screen was not that it was
 * ugly; it was that a four-minute wait with no detail is indistinguishable from a crash, so
 * students reloaded mid-build and paid for the lecture twice.
 *
 * TWO INDEPENDENT STATE MACHINES, DELIBERATELY. Generation state (which stage, what percent) comes
 * from the server job and is owned by `progress`. Conversation state (connecting, listening,
 * speaking, muted, paused) is owned by the Gemini Live hook. They are wired together — a stage
 * change can prompt a remark — but neither can block the other: the build never waits for the
 * student to answer, and a failed or refused microphone leaves the progress UI fully functional.
 * That independence is the whole design, and it is why there is no combined status enum.
 *
 * WHO OWNS TIMING. The persona says to be occasional; this component enforces it. An instruction to
 * a model about frequency is a suggestion it drifts away from over four minutes, so the decision of
 * WHEN to speak lives in code (see `maybeSpeak`) and only the wording is left to Gemini.
 */

export type DesignProgress = {
  stage: LessonDesignStageId;
  stageFraction: number;
  detail: string | null;
  /** Server-reported status prose. Shown as the fallback line before any stage data arrives. */
  status: string;
  elapsedMs: number;
};

export type LessonDesignModeProps = {
  topic: string;
  /** The learning track's name. Not rendered — the classroom header leads with the topic — but it
   *  is part of the mood string handed to the live tutor. */
  mode?: string;
  /** Live generation progress, polled from the job by the caller. */
  progress: DesignProgress;
  /** True once the lecture is built and the caller is ready to hand over to the player. */
  ready: boolean;
  sourceKind: "pdf" | "pptx" | "pages" | "topic";
  mood: string;
  blindMode: boolean;
  studentName?: string;
  /** The running job, so spoken steering can be recorded against it. Null before it starts. */
  jobId: string | null;
  /**
   * The uploaded document — its page images and its extracted text. The build-time Aria had
   * neither, so while the lecture generated she chatted about a document she had never seen.
   */
  documentId?: string;
  documentContext?: string;
  /** Called when the student ends the build. */
  onStop: () => void;
  /** Every planned beat with its measured timings, from the progressive build (optional). */
  beatStatus?: NonNullable<ProgressiveLectureSnapshot["beatStatus"]>;
  /** When the build started, for "started N s ago". */
  buildStartedAt?: string;
  /** Called once the ready hand-off is complete (after Aria's closing line, if she is speaking). */
  onStart: () => void;
};

/**
 * Quiet stretch before Aria fills the silence, in ms.
 *
 * Tuned against a MEASURED build rather than guessed: a real four-minute lecture sat in
 * "structuring" from 5s to 115s and in "visuals" from 120s to 230s, so stage changes alone left two
 * silences of roughly two minutes each. At 30s this puts three or four remarks into a gap that
 * previously had none, which is the difference between a companion and a dead screen.
 */
const QUIET_GAP_MS = 12_000;
/** Minimum spacing between ANY two prompted remarks, so a stage change cannot stack onto a lesson. */
const MIN_SPEAK_GAP_MS = 7_000;

/**
 * What Aria contributes during a wait, in rotation.
 *
 * Rotating matters more than the individual wordings: the same instruction repeated produces the
 * same sentence repeated, which is its own kind of dead air. The last entry is the only one that
 * asks a question, so teaching dominates and questions stay occasional — the "do not bombard"
 * requirement expressed as a ratio rather than as a hope.
 */
const WAIT_ANGLES = [
  "DISCOVERY",
  "Explain one core idea behind this topic in a couple of sentences — something they will actually use once the lesson starts.",
  "ASK_QUESTION",
  "DISCOVERY",
  "Mention the thing people most often get wrong about this topic, and the way of thinking about it that fixes it.",
  "Give a concrete, everyday example of this topic. Keep it short and vivid.",
  "ASK_QUESTION",
  "Say briefly why this topic is worth knowing — where it shows up or what it unlocks.",
] as const;

export function LessonDesignMode({
  topic,
  progress,
  ready,
  sourceKind,
  mood,
  blindMode,
  studentName,
  jobId,
  documentId,
  documentContext = "",
  onStop,
  onStart,
  beatStatus,
  buildStartedAt,
}: LessonDesignModeProps) {
  const [captions, setCaptions] = useState<Array<{ role: "student" | "tutor"; text: string; final: boolean }>>([]);
  const [paused, setPaused] = useState(false);
  const [questionsSilenced, setQuestionsSilenced] = useState(false);
  /** Set only by the student explicitly asking for quiet — stops teaching as well as questions. */
  const [fullySilenced, setFullySilenced] = useState(false);
  /**
   * Live starts on its own in EVERY mode, not just blind.
   *
   * It was opt-in for sighted students to avoid paying for a session nobody used. Seen running,
   * that was the wrong trade: the screen opened on "Not connected" and stayed silent for the whole
   * build, which is the passive loading screen this mode exists to replace, only with a nicer bar.
   * The student can still end the session, and `stop_asking` still silences her.
   */
  const [liveRequested] = useState(true);
  const [adaptations, setAdaptations] = useState<string[]>([]);
  /** The typed-message box. Text and voice are the same session, not two conversations. */
  const [draft, setDraft] = useState("");
  const [controlError, setControlError] = useState<string | null>(null);
  const captionEndRef = useRef<HTMLDivElement | null>(null);
  /** What the student has told us so far — threaded into later prompts so turns build on each other. */
  const knownRef = useRef<string[]>([]);
  /** An answer that has arrived but not yet been reacted to. Cleared once Aria responds to it. */
  const pendingAnswerRef = useRef<string | null>(null);

  const percent = ready ? 1 : progressFor(progress.stage, progress.stageFraction);
  const remainingMs = ready ? 0 : estimateRemainingMs(progress.elapsedMs, percent);
  const remainingLabel = formatRemaining(remainingMs);
  const current = stageById(progress.stage);
  const currentIndex = stageIndex(progress.stage);

  // Refs mirror state for use inside timers and tool handlers, which must not re-subscribe on
  // every render — the same pattern VoiceTutor uses for its build-wait loop.
  const lastSpokeAtRef = useRef(0);
  const studentSpokeAtRef = useRef(0);
  const silencedRef = useRef(false);
  const questionsOffRef = useRef(false);
  const pausedRef = useRef(false);
  const progressRef = useRef(progress);
  const percentRef = useRef(percent);
  const remainingRef = useRef(remainingLabel);
  const jobIdRef = useRef(jobId);

  const sourceLine = useMemo(
    () =>
      sourceKind === "pdf"
        ? "It is being built from the PDF they uploaded."
        : sourceKind === "pptx"
          ? "It is being built from the slide deck they uploaded."
          : sourceKind === "pages"
            ? "It is being built from the pages they selected."
            : "It is being written from scratch for the topic they typed.",
    [sourceKind],
  );

  /**
   * Tool handler. Returns SENTENCES rather than status codes, because whatever this returns is fed
   * straight back into the conversation — "about 70 percent, roughly a minute left" gives Gemini
   * something to say, where "ok" leaves it to invent the numbers it was told never to invent.
   */
  const handleTool = useCallback(async (name: string, args: Record<string, unknown>) => {
    if (name === "describe_progress") {
      const state = progressRef.current;
      const stage = stageById(state.stage);
      const done = LESSON_DESIGN_STAGES.slice(0, stageIndex(state.stage)).map((s) => s.label);
      const left = LESSON_DESIGN_STAGES.slice(stageIndex(state.stage) + 1).map((s) => s.label);
      const pct = spokenPercent(percentRef.current);
      const remaining = remainingRef.current;
      return [
        `Currently: ${stage?.label ?? state.status}.`,
        state.detail ? `Detail: ${state.detail}.` : "",
        `About ${pct} complete.`,
        remaining ? `Roughly ${remaining} remaining.` : "Not enough measured progress yet to estimate the time left.",
        done.length ? `Already finished: ${done.join(", ")}.` : "",
        left.length ? `Still to come: ${left.join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
    }

    if (name === "adapt_lesson") {
      const note = typeof args.note === "string" ? args.note.trim() : "";
      if (!note) return "No instruction was given, so nothing was recorded.";
      const id = jobIdRef.current;
      if (!id) return "The build has not started yet, so there is nothing to adapt.";
      const res = await fetch("/api/generate-lecture/steer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: id, note }),
      }).catch(() => null);
      const data = await res?.json().catch(() => ({}));
      if (data?.applied) {
        setAdaptations((prev) => (prev.includes(note) ? prev : [...prev, note]));
        return `Recorded. Every part of the lesson still to be written will follow that. Tell the student in one sentence what you will do differently. Parts already written will not change.`;
      }
      if (data?.reason === "finished") {
        // Honest rather than encouraging: promising a change that cannot happen is worse than
        // saying the lesson is already written.
        return "The lesson finished generating before that could be applied, so it will not change the written content. Acknowledge it warmly and mention you will keep it in mind as you teach.";
      }
      return "That could not be applied to the build.";
    }

    if (name === "stop_asking") {
      setQuestionsSilenced(true);
      setFullySilenced(true);
      return "Understood — no more questions. Confirm in a few words and then stay silent until the lesson is ready or the student speaks first.";
    }

    return `Unknown tool "${name}".`;
  }, []);

  const tutor = useGeminiLiveTutor({
    gateProfile: "conversation",
    topic,
    documentId,
    getDocumentContext: () => documentContext,
    getBeatContext: () => {
      // There is no lecture yet. Saying so plainly is what stops the model describing a slide that
      // does not exist — the failure the design persona is written to avoid.
      const state = progressRef.current;
      return `No lecture is playing. The lesson is still being generated: ${stageById(state.stage)?.label ?? state.status}.`;
    },
    onBoardRequest: () => {
      // Design mode has no board. Declared to satisfy the hook's contract; the persona is told it
      // has no board, and no board tool is offered.
    },
    customTools: LESSON_DESIGN_TOOLS,
    onCustomToolCall: handleTool,
    onTranscript: (role, text, final) => {
      setCaptions((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === role && !last.final) {
          return [...prev.slice(0, -1), { role, text, final }];
        }
        return [...prev.slice(-14), { role, text, final }];
      });
      /*
       * Remember what the student says, so later turns can build on it.
       *
       * The first version displayed the transcript and did nothing else with it, which is why the
       * conversation felt one-sided: Aria asked what they knew, they answered, and the next prompted
       * turn started from nothing. Anything long enough to carry meaning is kept; "yeah" and "mm" are
       * not worth threading into a prompt.
       */
      if (role === "student" && final && text.trim().length > 8) {
        knownRef.current = [...knownRef.current.slice(-4), text.trim()];
        pendingAnswerRef.current = text.trim();
      }
    },
    onTutorTurnComplete: () => {
      lastSpokeAtRef.current = Date.now();
      setCaptions((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.final) return prev;
        return [...prev.slice(0, -1), { ...last, final: true }];
      });
    },
    onStudentSpeechStarted: () => {
      studentSpokeAtRef.current = Date.now();
    },
    onStudentSpeechStopped: () => {
      studentSpokeAtRef.current = 0;
    },
    mood,
    designMode: true,
    blindMode,
    sourceKind,
    studentName,
    // Design mode is a conversation, not a lecture — there is nothing to pause or resume yet.
    lectureControlTools: false,
    alwaysOn: true,
    // The session starts listening in every mode. Talk to Tutor is an explicit interruption/retry
    // control, not the gate that makes the teacher begin behaving like a teacher.
    startMuted: false,
  });

  const { start, stop, say, status: liveStatus, outputMuted, errorMessage, reconnecting } = tutor;
  const sayRef = useRef(say);
  const isSpeakingRef = useRef(tutor.isSpeaking);
  const liveStatusRef = useRef(liveStatus);

  /**
   * The controls, each wired to something the session actually does.
   *
   * PAUSE is the one worth explaining. It silences Aria immediately, mutes the microphone so a
   * paused session is not still listening, and sets `paused`, which every prompted turn checks — so
   * a pause stops the current sentence AND the ones that would have followed. Resume restores the
   * microphone and lets the normal cadence pick up from where it was; it deliberately does not
   * replay the interrupted turn, because the conversation has moved on.
   *
   * Generation pauses at the next real server pipeline boundary. An external model request already
   * in flight is allowed to finish, then later stages wait until resume.
   */
  const controlBuild = useCallback(async (action: "pause" | "resume" | "cancel") => {
    const id = jobIdRef.current;
    if (!id) return true;
    const response = await fetch("/api/generate-lecture/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: id, action }),
      keepalive: action === "cancel",
    }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    return Boolean(response?.ok && (data?.applied || action === "cancel" && data?.state === "cancelled"));
  }, []);

  const togglePause = useCallback(async () => {
    setControlError(null);
    if (!pausedRef.current) {
      tutor.silence();
      tutor.setMicEnabled(false);
      setPaused(true);
      const applied = await controlBuild("pause");
      if (!applied) setControlError("The conversation paused, but lesson generation could not be paused.");
      return;
    }

    const applied = await controlBuild("resume");
    if (!applied) {
      setControlError("Lesson generation could not resume. Please try again.");
      return;
    }
    setPaused(false);
    if (tutor.micAvailable) tutor.setMicEnabled(true);
    lastSpokeAtRef.current = 0;
    sayRef.current?.(DESIGN_CUES.resumed(topic, current?.label ?? progress.status));
  }, [controlBuild, current?.label, progress.status, topic, tutor]);

  /** Explicitly open the mic to interrupt. Never required — the session listens by default. */
  const talkToTutor = useCallback(async () => {
    if (liveStatus !== "live") {
      if (liveStatus === "connecting") return;
      await tutor.start();
    }
    tutor.silence();
    if (paused) await togglePause();
    tutor.setOutputMuted(false);
    if (tutor.micAvailable) tutor.setMicEnabled(true);
    else void tutor.requestMicrophone();
  }, [liveStatus, tutor, paused, togglePause]);

  const handleStop = useCallback(() => {
    tutor.stop();
    void controlBuild("cancel");
    onStop();
  }, [controlBuild, onStop, tutor]);

  const liveLabel = paused
    ? "Paused"
    : reconnecting
      ? "Reconnecting…"
      : liveStatus === "connecting"
        ? "Connecting…"
      : liveStatus === "mic-denied"
        ? "Microphone unavailable — you can still type"
        : liveStatus === "blocked"
          ? "Tap anywhere to allow audio"
          : liveStatus === "error"
            ? "Connection problem"
            : liveStatus !== "live"
              ? "Not connected"
              : outputMuted
                ? "Muted"
                : tutor.speaking
                  ? "Speaking…"
                  : tutor.muted
                    ? tutor.micAvailable ? "Mic off" : "Text session · microphone unavailable"
                    : "Listening…";

  /**
   * Mirror the latest render's values into refs, in an effect rather than during render.
   *
   * The timers and tool handlers below must see current values without re-subscribing on every
   * render — a question timer that resets each tick would never fire. Writing refs during render is
   * what React forbids (and what this project's lint rules catch), so the sync happens here, after
   * commit, which is both legal and the point at which the values are actually settled.
   */
  useEffect(() => {
    silencedRef.current = fullySilenced;
    questionsOffRef.current = questionsSilenced;
    pausedRef.current = paused;
    progressRef.current = progress;
    percentRef.current = percent;
    remainingRef.current = remainingLabel;
    jobIdRef.current = jobId;
    sayRef.current = say;
    isSpeakingRef.current = tutor.isSpeaking;
    liveStatusRef.current = liveStatus;
  });

  useEffect(() => {
    captionEndRef.current?.scrollIntoView({ block: "end" });
  }, [captions]);

  /** Connect once the student asks for it (or immediately, in blind mode). */
  useEffect(() => {
    if (!liveRequested) return;
    void start();
    return () => stop();
    // start/stop are stable for a given session; re-running on every render would reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRequested]);

  // A pause pressed during the short pre-job window must still reach the job once its id arrives.
  useEffect(() => {
    if (!paused || !jobId) return;
    void controlBuild("pause");
  }, [paused, jobId, controlBuild]);

  /**
   * The one gate every prompted remark passes through.
   *
   * Never speaks over the tutor's own audio, never over the student mid-sentence, never while
   * paused, and never twice inside MIN_SPEAK_GAP_MS. Speech older than 2.5s counts as finished so a
   * dropped stop event cannot mute Aria for the rest of the build — the same guard VoiceTutor uses.
   */
  const maybeSpeak = useCallback((cue: string, options: { force?: boolean } = {}) => {
    if (pausedRef.current) return false;
    if (liveStatusRef.current !== "live") return false;
    const now = Date.now();
    const studentActive = studentSpokeAtRef.current > 0 && now - studentSpokeAtRef.current < 2500;
    if (studentActive) return false;
    if (isSpeakingRef.current()) return false;
    if (!options.force && now - lastSpokeAtRef.current < MIN_SPEAK_GAP_MS) return false;
    lastSpokeAtRef.current = now;
    sayRef.current?.(cue);
    return true;
  }, []);

  /** Opening line, once, when the session first goes live. */
  const openedRef = useRef(false);
  useEffect(() => {
    if (liveStatus !== "live" || openedRef.current) return;
    openedRef.current = true;
    lastSpokeAtRef.current = 0;
    maybeSpeak(DESIGN_CUES.opening(topic, sourceLine), { force: true });
  }, [liveStatus, topic, sourceLine, maybeSpeak]);

  /**
   * Announce genuine stage changes.
   *
   * In blind mode this is forced past the spacing gate, because there the voice IS the progress bar
   * and a skipped announcement is information the student simply never receives. For a sighted
   * student the bar already says it, so the remark is optional and yields to the gap rule.
   */
  const announcedRef = useRef<string | null>(null);
  useEffect(() => {
    if (liveStatus !== "live" || ready) return;
    if (announcedRef.current === progress.stage) return;
    if (announcedRef.current === null) {
      // Do not announce the stage that was already current when the session opened.
      announcedRef.current = progress.stage;
      return;
    }
    const completed = stageById(announcedRef.current);
    announcedRef.current = progress.stage;
    const stage = stageById(progress.stage);
    if (!stage) return;
    maybeSpeak(DESIGN_CUES.stageChange(completed?.label ?? "The previous preparation stage", stage.label, spokenPercent(percent), null), {
      force: blindMode,
    });
  }, [progress.stage, liveStatus, ready, percent, remainingLabel, blindMode, maybeSpeak]);

  /**
   * Fill genuinely quiet stretches — mostly by teaching, occasionally by asking.
   *
   * This is what keeps the wait alive. Stage announcements cannot do it: measured builds hold one
   * stage for two minutes, so an announcement-only tutor says nothing for most of the build.
   *
   * The angle only advances when something was ACTUALLY said. maybeSpeak declines whenever Aria is
   * already talking or the student is mid-sentence, and advancing on a declined turn would silently
   * burn through the rotation and skip the teaching the student never heard.
   */
  const angleRef = useRef(0);
  useEffect(() => {
    if (liveStatus !== "live" || ready) return;
    const timer = setInterval(() => {
      if (pausedRef.current) return;

      /*
       * REACTING BEATS EVERYTHING ELSE.
       *
       * An unanswered answer is checked first and on a much shorter clock than a prompted remark,
       * because the gap that makes this feel like a chatbot is the one between the student
       * finishing a sentence and Aria acknowledging it. Gemini often replies on its own; this only
       * fires when it did not, so a reply is never simply lost.
       */
      const answer = pendingAnswerRef.current;
      if (answer) {
        const sinceAnswer = Date.now() - studentSpokeAtRef.current;
        if (sinceAnswer > 1200 && maybeSpeak(DESIGN_CUES.react(answer, topic), { force: true })) {
          pendingAnswerRef.current = null;
        }
        return;
      }

      if (silencedRef.current) return;
      if (Date.now() - lastSpokeAtRef.current < QUIET_GAP_MS) return;

      const angle = WAIT_ANGLES[angleRef.current % WAIT_ANGLES.length];
      // "Questions off" stops the asking, not the talking — a student who does not want to be
      // quizzed usually still wants the company. Full silence is `stop_asking`.
      if (angle === "ASK_QUESTION" && questionsOffRef.current) {
        angleRef.current += 1;
        return;
      }

      const state = progressRef.current;
      const spoke =
        angle === "ASK_QUESTION"
          ? maybeSpeak(DESIGN_CUES.question(topic))
          : angle === "DISCOVERY"
            ? maybeSpeak(
                DESIGN_CUES.discovery(
                  topic,
                  stageById(state.stage)?.label ?? state.status,
                  state.detail,
                  sourceLine,
                ),
              )
            : maybeSpeak(DESIGN_CUES.teach(topic, angle, knownRef.current));
      if (spoke) angleRef.current += 1;
    }, 2_000);
    return () => clearInterval(timer);
  }, [liveStatus, ready, topic, sourceLine, maybeSpeak]);

  /** Nearly-done heads-up, once. */
  const nearlyRef = useRef(false);
  useEffect(() => {
    if (liveStatus !== "live" || ready || nearlyRef.current) return;
    if (percent < 0.9) return;
    nearlyRef.current = true;
    maybeSpeak(DESIGN_CUES.nearlyDone());
  }, [percent, liveStatus, ready, maybeSpeak]);

  /**
   * The hand-off.
   *
   * When Aria is live she announces the lesson and the transition waits for her to finish, so the
   * screen does not snap away mid-sentence. When she is not, the caller's own Start control is the
   * transition. Either way there is a ceiling: the student is never held on this screen by a voice
   * that failed to stop talking.
   */
  const handedOverRef = useRef(false);
  useEffect(() => {
    if (!ready || paused || handedOverRef.current) return;
    if (liveStatus !== "live") return;
    handedOverRef.current = true;
    maybeSpeak(DESIGN_CUES.ready(topic), { force: true });

    const deadline = Date.now() + 12_000;
    const timer = setInterval(() => {
      const stillTalking = isSpeakingRef.current();
      if (!stillTalking || Date.now() > deadline) {
        clearInterval(timer);
        stop();
        onStart();
      }
    }, 500);
    return () => clearInterval(timer);
  }, [ready, paused, liveStatus, topic, maybeSpeak, stop, onStart]);

  return (
    /*
     * NOT VERTICALLY CENTERED ANYMORE. `place-items-center` on a `min-h-screen` grid re-centers
     * the ENTIRE column every time anything inside it changes height — the transcript box
     * (bounded now, see below) and the "Adapted: …" list this screen grows live during a build
     * both changed height constantly, and every one of those changes visibly moved the teacher
     * avatar and heading well above them. A fixed top offset instead means the page can grow
     * downward as the conversation and adaptation list fill in without moving anything that was
     * already on screen.
     */
    <div className="relative z-10 flex min-h-screen justify-center overflow-y-auto p-6 pt-[12vh]">
      <HudCorners />

      {/*
        Live region for screen readers. Blind mode leads with Aria's voice, but the two are not
        exclusive and a silent fallback costs nothing.
      */}
      <div className="sr-only" role="status" aria-live="polite">
        {ready
          ? "Your lesson is ready."
          : `${current?.label ?? progress.status}.`}
      </div>

      <div className="w-full max-w-3xl">
        {/* THE TEACHER. Deliberately the largest thing on screen — this is a class starting, not a
            job running, and the old layout led with a 4xl percentage which said the opposite. */}
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            <div className="relative">
              <TeacherAvatar speaking={tutor.speaking && !outputMuted} size={132} />
            </div>
          </div>

          <p className="mt-4 text-xs font-black uppercase tracking-[0.18em] text-[var(--hud-cyan)]/80">
            {ready ? "Your lesson is ready" : "Preparing your lesson"}
          </p>
          <h2 className="mt-2 font-display text-2xl font-light leading-tight">
            <span className="hud-text-glow italic">{topic}</span>
          </h2>
          {/*
            One status line, not two competing ones.

            The live state and the time estimate used to be concatenated into a sentence
            ("Listening… · about 50 sec left"), which read as a single ambiguous phrase and left the
            reader to work out that the two halves were unrelated. A dot separator between two
            visually distinct spans says the same thing without the sentence.
          */}
          <div className="mt-2.5 flex items-center justify-center gap-2.5 text-[11px]">
            <span className="inline-flex items-center gap-1.5 font-medium text-[var(--hud-text-dim)]">
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${
                  liveStatus === "live" && !paused
                    ? "bg-[var(--hud-cyan)] shadow-[0_0_6px_var(--hud-cyan)]"
                    : "bg-[var(--hud-text-faint)]"
                }`}
              />
              {liveLabel}
            </span>
          </div>
        </div>

        {/*
          THE CONVERSATION. The transcript is the main surface, not a side panel.

          A FIXED HEIGHT, NOT JUST A MINIMUM. This box used to be min-h-only, so its real rendered
          height changed every time a caption arrived or wrapped onto a different number of lines
          — and because the whole column above it sits in a `place-items-center` grid, any change
          to this box's height re-centers the ENTIRE page, including the teacher avatar and
          heading well above it. That is what reads as "Aria going up": nothing about the avatar
          moved on its own, the box below it changed size and recentering did the rest. A fixed
          height with internal scroll (auto-scrolled to the newest line via captionEndRef) keeps
          this box's footprint constant regardless of how much text is in it, so the page around
          it stops moving.
        */}
        {/*
          A BOUNDED RANGE, NOT A FIXED HEIGHT. The box was locked to 9.5rem whether it held four
          lines or none, so the usual case — Aria's one opening question — was a short sentence
          floating in a large empty panel, and the emptiness read as something failing to load.
          A min/max range keeps the footprint stable enough that the page does not jump (the
          original reason for a fixed height) while letting a nearly-empty transcript occupy the
          space it actually needs.
        */}
        <div className="mt-7 max-h-[13rem] min-h-[6.5rem] overflow-y-auto rounded-xl border border-[var(--hud-line)] bg-black/25 px-5 py-4">
          {errorMessage || controlError ? (
            <p className="rounded-md bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300">{errorMessage ?? controlError}</p>
          ) : captions.length === 0 ? (
            <div className="flex min-h-[4.5rem] items-center justify-center gap-2 text-sm text-[var(--hud-text-faint)]">
              {/* Three dots that actually animate, so "connecting" looks like waiting rather than
                  like a screen that has stopped. */}
              <span aria-hidden className="flex gap-1">
                {[0, 1, 2].map((dot) => (
                  <span
                    key={dot}
                    className="h-1 w-1 animate-pulse rounded-full bg-[var(--hud-text-faint)]"
                    style={{ animationDelay: `${dot * 180}ms`, animationDuration: "1.4s" }}
                  />
                ))}
              </span>
              {liveStatus === "connecting" ? "Aria is joining…" : "Aria will start talking in a moment."}
            </div>
          ) : (
            <div className="space-y-3.5">
              {captions.slice(-4).map((line, index) => (
                /*
                  The speaker label sits ABOVE the line, not inline with it. Inline, a four-character
                  "ARIA" pushed the first line of every paragraph in by a different amount than the
                  wrapped lines below it, so the left edge of the text was ragged and the label read
                  as the sentence's first word.
                */
                <div key={index}>
                  <p
                    className={`text-[10px] font-black uppercase tracking-[0.16em] ${
                      line.role === "tutor" ? "text-[var(--hud-cyan)]/70" : "text-[var(--hud-text-faint)]"
                    }`}
                  >
                    {line.role === "tutor" ? "Aria" : "You"}
                  </p>
                  <p
                    className={`mt-1 text-[15px] leading-7 ${
                      line.role === "tutor" ? "text-[var(--hud-text)]" : "text-[var(--hud-text-dim)]"
                    }`}
                  >
                    {line.text}
                  </p>
                </div>
              ))}
              <div ref={captionEndRef} />
            </div>
          )}
        </div>

        {/* TEXT INPUT — voice and text are the same session, so a typed answer lands in the same
            conversation as a spoken one. */}
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const text = draft.trim();
            if (!text || liveStatus !== "live" || paused) return;
            tutor.sendText(text);
            setDraft("");
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={paused ? "Resume to continue the conversation" : liveStatus === "live" ? "Type an answer instead…" : "Connecting…"}
            aria-label="Type a message to your tutor"
            disabled={liveStatus !== "live" || paused}
            className="min-w-0 flex-1 rounded-lg border border-[var(--hud-line)] bg-black/30 px-4 py-2.5 text-sm text-[var(--hud-text)] outline-none transition placeholder:text-[var(--hud-text-faint)] focus:border-[var(--hud-cyan)]/60 disabled:opacity-40"
          />
          <button
            type="submit"
            disabled={liveStatus !== "live" || paused || !draft.trim()}
            title="Send message"
            aria-label="Send message"
            className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-lg bg-[var(--hud-cyan)] text-black transition hover:brightness-110 disabled:opacity-35"
          >
            <Send size={17} aria-hidden />
          </button>
        </form>

        {/* SUBTLE STATUS. Stages, not a giant percentage — a thin bar carries the same information
            without dominating the screen. */}
        <div className="mt-7 rounded-xl border border-[var(--hud-line)] px-5 py-4">
          <div className="flex items-baseline justify-between gap-3">
            {/* The stage NAME leads, because that is the answer to "what is it doing". The old
                header repeated the screen title here and put the stage in small faint text on the
                right, which buried the only line that changes. */}
            <p className="text-[13px] font-semibold text-[var(--hud-text)]">
              {ready ? "Finished" : paused ? "Paused" : (current?.label ?? progress.status)}
            </p>
            <p className="shrink-0 text-[11px] font-medium tabular-nums text-[var(--hud-text-faint)]">
              {ready ? "100%" : `${Math.round(percent * 100)}%`}
            </p>
          </div>
          {/* The sub-detail only renders when it says something the stage name does not, instead of
              falling back to a duplicate of the line above it. */}
          {!ready && !paused && progress.detail && progress.detail !== current?.label ? (
            <p className="mt-1 text-[11px] leading-5 text-[var(--hud-text-faint)]">{progress.detail}</p>
          ) : paused ? (
            <p className="mt-1 text-[11px] leading-5 text-[var(--hud-text-faint)]">
              Holding after the current operation.
            </p>
          ) : null}
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/8">
            <div
              className="h-full rounded-full bg-[var(--hud-cyan)] transition-[width] duration-700 ease-out"
              style={{ width: `${Math.max(2, Math.round(percent * 100))}%` }}
            />
          </div>
          {adaptations.length > 0 && (
            /* Visible proof that answering actually changed the lesson. Without this the student
               tells Aria something, hears "I'll build that in", and has nothing to show for it. */
            <ul className="mt-3.5 space-y-1.5 border-t border-[var(--hud-line)] pt-3">
              {adaptations.map((note) => (
                <li key={note} className="flex items-start gap-2 text-[11px] leading-5 text-[var(--hud-cyan)]/85">
                  {/* A check rather than the word "Adapted:" on every row — the icon carries the
                      "this was applied" meaning once per line without repeating the label. */}
                  <Check size={12} strokeWidth={3} className="mt-[3px] shrink-0" aria-hidden />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          )}
          {/*
            A COLUMN, NOT A WRAPPING ROW. Seven variable-length labels in a flex-wrap row broke into
            a ragged two lines with no aligned left edge, so finding the current stage meant reading
            all seven. A column gives every stage the same start position and turns the sequence
            into something scannable, with the markers forming a single vertical rail.
          */}
          <ul className="mt-3.5 space-y-1">
            {LESSON_DESIGN_STAGES.map((stage, index) => {
              const stageDone = ready || index < currentIndex;
              const active = !ready && index === currentIndex;
              return (
                <li
                  key={stage.id}
                  aria-current={active ? "step" : undefined}
                  className={`flex items-center gap-2 text-[11px] leading-5 transition-colors ${
                    stageDone
                      ? "text-[var(--hud-text-dim)]"
                      : active
                        ? "font-semibold text-[var(--hud-cyan)]"
                        : "text-[var(--hud-text-faint)]/40"
                  }`}
                >
                  <span aria-hidden className="grid h-3 w-3 shrink-0 place-items-center">
                    {stageDone ? (
                      <Check size={11} strokeWidth={3} />
                    ) : active ? (
                      // The only moving marker on the list, so the eye lands on it directly.
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--hud-cyan)] shadow-[0_0_6px_var(--hud-cyan)]" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full border border-current" />
                    )}
                  </span>
                  {stage.label}
                </li>
              );
            })}
          </ul>
          {beatStatus && beatStatus.length > 0 && <BuildTimeline beats={beatStatus} createdAt={buildStartedAt} />}
        </div>

        {/* CONTROLS. Every one of these drives the real session — see the handlers above. */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {/* `active` marks a control that is currently CHANGING the session's behaviour — muted
              output, a held build. Without it, mute and unmute looked identical apart from a glyph
              swap, and a muted tutor was indistinguishable from a silent one. */}
          <DockButton
            label={outputMuted ? "Unmute teacher" : "Mute teacher"}
            onClick={() => tutor.setOutputMuted(!outputMuted)}
            disabled={liveStatus !== "live"}
            active={outputMuted}
          >
            {outputMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </DockButton>
          <DockButton
            label={paused ? "Resume lesson preparation" : "Pause lesson preparation"}
            onClick={() => void togglePause()}
            disabled={ready}
            active={paused}
          >
            {paused ? <Play size={17} /> : <Pause size={17} />}
          </DockButton>
          <DockButton
            label={liveStatus === "error" || liveStatus === "idle" ? "Reconnect tutor" : tutor.micAvailable ? "Talk to tutor" : "Enable microphone"}
            onClick={() => void talkToTutor()}
            disabled={liveStatus === "connecting"}
            active={tutor.micAvailable && !tutor.muted && liveStatus === "live"}
          >
            {tutor.micAvailable && !tutor.muted ? <Mic size={17} /> : <MicOff size={17} />}
          </DockButton>
          <DockButton label="Stop lesson preparation" onClick={handleStop}><Square size={16} /></DockButton>
          {ready && (
            <button
              onClick={() => {
                stop();
                onStart();
              }}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--hud-cyan)] px-5 text-xs font-black uppercase tracking-[0.14em] text-black transition hover:brightness-110"
            >
              <Play size={16} aria-hidden /> Start lecture
            </button>
          )}
        </div>

        {/* Two separate facts, so they are not read as one run-on sentence. The second only appears
            while pausing is still possible — once the lesson is ready it is no longer true. */}
        <p className="mt-4 text-center text-[11px] leading-5 text-[var(--hud-text-faint)]">
          Ask anything while Aria works — questions never pause the build.
          {!ready ? " Pause holds the next stage until you resume." : ""}
        </p>
      </div>
    </div>
  );
}

/** The persistent header: stage, percentage, bar, estimate, elapsed. */

function DockButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** This control is currently altering the session — muted, paused, mic open. */
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`grid h-10 w-10 place-items-center rounded-lg border transition disabled:opacity-35 ${
        active
          ? "border-[var(--hud-cyan)]/55 bg-[var(--hud-cyan)]/12 text-[var(--hud-cyan)]"
          : "border-[var(--hud-line)] text-[var(--hud-text-dim)] hover:border-[var(--hud-cyan)]/45 hover:text-[var(--hud-text)]"
      }`}
    >
      {children}
    </button>
  );
}
