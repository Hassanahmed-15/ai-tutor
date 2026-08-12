"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DrawScript } from "@/components/sketch/LiveSketch";
import {
  isDrawingRequest,
  PAUSE_LECTURE_TOOL,
  RESUME_LECTURE_TOOL,
  SHOW_BOARD_TOOL,
} from "./geminiLiveContract";

export type GeminiLiveStatus =
  | "idle"
  | "connecting"
  | "live"
  | "drawing"
  | "mic-denied"
  | "blocked"
  | "error";

export type GeminiLiveBoard = { script: string; draw?: DrawScript };

type TranscriptRole = "student" | "tutor";
type SessionEndReason = "user" | "idle" | "timeout" | "error";

/**
 * Is this utterance actually aimed at the teacher?
 *
 * WHY THIS IS NOT A MODEL CALL. The decision has to be made in the gap between the student
 * finishing a sentence and the lecture resuming — a round trip would cost more time than the
 * pause it is trying to avoid. So it is a cheap local heuristic, and it is deliberately biased
 * toward answering YES: treating a real question as incidental would ignore the student, which is
 * far worse than pausing briefly for a cough.
 *
 * It runs on the FINAL transcript only, never on interim text, because interim results routinely
 * truncate mid-word and a half-word would classify as noise.
 */
const BACKCHANNEL = new Set([
  "mm", "mmm", "mhm", "mm-hm", "uh", "uh-huh", "um", "hmm", "huh", "ah", "oh", "ok", "okay",
  "yeah", "yep", "yes", "no", "right", "sure", "cool", "nice", "wow", "hm", "eh", "haha",
]);

/** Openers that make an utterance an instruction even without a question mark. */
const IMPERATIVE = /^(?:can|could|would|will|please|explain|show|draw|tell|repeat|say|go|stop|pause|resume|wait|hold|skip|slow|speed|why|what|how|when|where|who|which|is|are|does|do|did|should|am)\b/i;
const PAUSE_COMMAND = /^(?:aria\s+|teacher\s+|please\s+)*(?:pause|stop|wait|hold(?:\s+on)?)(?:\s+(?:the\s+)?lecture)?[.!\s]*$/i;
const RESUME_COMMAND = /^(?:aria\s+|teacher\s+|please\s+)*(?:continue|resume|keep\s+going|start\s+again|go\s+on)(?:\s+(?:the\s+)?lecture)?[.!\s]*$/i;

export type StudentTurnKind = "incidental" | "pause" | "resume" | "drawing" | "question";

export function classifyStudentTurn(raw: string): StudentTurnKind {
  const text = raw.trim();
  if (!text || !isAddressedToTeacher(text)) return "incidental";
  if (PAUSE_COMMAND.test(text)) return "pause";
  if (RESUME_COMMAND.test(text)) return "resume";
  if (isDrawingRequest(text)) return "drawing";
  return "question";
}

export type TutorTurnCompletionAction = "resume-lecture" | "complete-turn";

export function getTutorTurnCompletionActions(
  pendingLectureResume: boolean,
  studentSpeaking: boolean,
  studentTurnKind: StudentTurnKind = "question",
): TutorTurnCompletionAction[] {
  return pendingLectureResume && !studentSpeaking && studentTurnKind !== "pause"
    ? ["resume-lecture", "complete-turn"]
    : ["complete-turn"];
}

export function isAddressedToTeacher(raw: string): boolean {
  const text = raw.trim().toLowerCase().replace(/[.,!]+$/g, "");
  if (!text) return false;

  // A question mark settles it.
  if (raw.includes("?")) return true;

  const words = text.split(/\s+/).filter(Boolean);

  // One or two words that are pure acknowledgement — "mm-hm", "okay", "yeah yeah".
  if (words.length <= 2 && words.every((w) => BACKCHANNEL.has(w.replace(/[^a-z-]/g, "")))) return false;

  // A single word that is not an acknowledgement is ambiguous; err toward listening.
  if (words.length <= 2) return true;

  // Interrogative or imperative opener — "what does that mean", "draw the cycle", "slow down".
  if (IMPERATIVE.test(text)) return true;

  // Addressed by name.
  if (/\b(aria|teacher)\b/.test(text)) return true;

  // Anything else of real length is treated as addressed. Three or more words directed at nobody
  // is uncommon enough that the cost of being wrong here is low.
  return words.length >= 3;
}

export type UseGeminiLiveTutorOptions = {
  topic: string;
  getBeatContext: () => string;
  getLessonContext?: () => string;
  mood?: string;
  onBoardRequest: (board: GeminiLiveBoard) => void;
  onTranscript?: (role: TranscriptRole, text: string, final: boolean) => void;
  onSessionEnded?: (reason: SessionEndReason) => void;
  onStudentSpeechStarted?: () => void;
  onStudentSpeechStopped?: () => void;
  /** Fired when finalised student speech was NOT addressed to the teacher (a cough, an
   *  acknowledgement, someone else in the room). The caller should resume the lecture rather than
   *  stay paused for a turn that is not coming. */
  onIncidentalSpeech?: () => void;
  onExplicitPause?: () => void;
  onExplicitResume?: () => void;
  onTutorTurnComplete?: () => void;
  onPauseLecture?: () => void;
  onResumeLecture?: () => void;
  alwaysOn?: boolean;
  adhdMode?: boolean;
  boardTextOnly?: boolean;
  lectureControlTools?: boolean;
  startMuted?: boolean;
  examMode?: boolean;
  examQuestions?: string[];
};

type GeminiSession = {
  sendRealtimeInput: (input: {
    text?: string;
    audio?: { data: string; mimeType: string };
    audioStreamEnd?: boolean;
  }) => void;
  sendToolResponse: (input: {
    functionResponses:
      | { id?: string; name?: string; response?: Record<string, unknown> }
      | Array<{ id?: string; name?: string; response?: Record<string, unknown> }>;
  }) => void;
  close: () => void;
};

type GeminiFunctionCall = {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
};

type GeminiServerMessage = {
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> };
    inputTranscription?: { text?: string };
    interimInputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    generationComplete?: boolean;
    turnComplete?: boolean;
    interrupted?: boolean;
  };
  toolCall?: { functionCalls?: GeminiFunctionCall[] };
  toolCallCancellation?: { ids?: string[] };
  voiceActivity?: { voiceActivityType?: string };
};

type AudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

/**
 * Keeps the learner's latest microphone intent even before a MediaStreamTrack exists.
 *
 * Token minting, permission and the Live socket resolve independently. Previously an unmute during
 * that window found no track and returned, then `startMicrophone` blindly applied `startMuted`.
 * The UI said Listening while the physical track stayed disabled. This small state holder makes
 * the eventual track consume the latest intent instead of the connection-time default.
 */
export class MicrophoneIntent {
  private enabled: boolean;

  constructor(startMuted: boolean) {
    this.enabled = !startMuted;
  }

  set(next: boolean) {
    this.enabled = next;
  }

  get() {
    return this.enabled;
  }

  apply(track: Pick<MediaStreamTrack, "enabled">) {
    track.enabled = this.enabled;
  }
}

const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;
const IDLE_TIMEOUT_MS = 60_000;
const MAX_SESSION_MS = 5 * 60_000;
const EXAM_MAX_SESSION_MS = 12 * 60_000;
const SETTLE_MS = 500;

function getAudioContextConstructor() {
  return window.AudioContext || (window as AudioWindow).webkitAudioContext;
}

function base64ToFloat32(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const output = new Float32Array(pcm.length);
  for (let index = 0; index < pcm.length; index += 1) {
    output[index] = Math.max(-1, Math.min(1, pcm[index] / 32768));
  }
  return output;
}

function downsample(samples: Float32Array, sourceRate: number) {
  if (sourceRate === INPUT_SAMPLE_RATE) return samples;
  const ratio = sourceRate / INPUT_SAMPLE_RATE;
  const output = new Float32Array(Math.max(1, Math.round(samples.length / ratio)));
  for (let outputIndex = 0; outputIndex < output.length; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.min(samples.length, Math.floor((outputIndex + 1) * ratio));
    let sum = 0;
    for (let inputIndex = start; inputIndex < end; inputIndex += 1) sum += samples[inputIndex];
    output[outputIndex] = sum / Math.max(1, end - start);
  }
  return output;
}

function float32ToPcm16Base64(samples: Float32Array) {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

function appendTranscript(current: string, fragment: string) {
  const next = fragment.trimStart();
  if (!next) return current;
  if (!current) return next;
  if (next.startsWith(current)) return next;
  if (current.endsWith(next)) return current;
  const separator = /\s$/.test(current) || /^[,.;:!?]/.test(next) ? "" : " ";
  return `${current}${separator}${next}`;
}

export function useGeminiLiveTutor(options: UseGeminiLiveTutorOptions) {
  const [status, setStatus] = useState<GeminiLiveStatus>("idle");
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const optionsRef = useRef(options);
  const sessionRef = useRef<GeminiSession | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const micIntentRef = useRef<MicrophoneIntent | null>(null);
  if (micIntentRef.current === null) micIntentRef.current = new MicrophoneIntent(options.startMuted === true);
  const playingSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextPlayTimeRef = useRef(0);
  const responseInFlightRef = useRef(false);
  const turnCompleteRef = useRef(false);
  const turnCompletedRef = useRef(false);
  const boardChainPendingRef = useRef(false);
  const pendingLectureResumeRef = useRef(false);
  const studentSpeakingRef = useRef(false);
  const suppressCurrentTurnRef = useRef(false);
  const contextOnlyTurnRef = useRef(false);
  const studentTranscriptRef = useRef("");
  const tutorTranscriptRef = useRef("");
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localSpeechFramesRef = useRef(0);
  const lastLoudFrameAtRef = useRef(0);
  const noiseFloorRef = useRef(0.008);
  const endedRef = useRef(false);
  const connectingRef = useRef(false);
  const toolAbortControllersRef = useRef(new Map<string, AbortController>());
  const boardHandledThisTurnRef = useRef(false);
  const fallbackDrawingRef = useRef<(concept: string) => Promise<void>>(async () => undefined);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    idleTimerRef.current = null;
    maxTimerRef.current = null;
    settleTimerRef.current = null;
  }, []);

  const flushStudentTranscript = useCallback(() => {
    const text = studentTranscriptRef.current.trim();
    let turnKind: StudentTurnKind = "incidental";
    if (text) {
      optionsRef.current.onTranscript?.("student", text, true);
      turnKind = classifyStudentTurn(text);
      if (turnKind === "incidental") {
        // Not a question or an instruction — a cough, a "mm-hm", or someone else in the room. The
        // audio already stopped (see beginStudentSpeech), but the lecture should pick up rather
        // than sit paused waiting for a turn that is not coming.
        optionsRef.current.onIncidentalSpeech?.();
      } else if (turnKind === "pause") {
        optionsRef.current.onExplicitPause?.();
      } else if (turnKind === "resume") {
        optionsRef.current.onExplicitResume?.();
      }
    }
    studentTranscriptRef.current = "";
    return { text, turnKind };
  }, []);

  const flushTutorTranscript = useCallback(() => {
    const text = tutorTranscriptRef.current.trim();
    if (text) optionsRef.current.onTranscript?.("tutor", text, true);
    tutorTranscriptRef.current = "";
  }, []);

  const stopPlayback = useCallback(() => {
    for (const source of playingSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // A source that just ended cannot be stopped again.
      }
    }
    playingSourcesRef.current.clear();
    nextPlayTimeRef.current = audioContextRef.current?.currentTime ?? 0;
    setSpeaking(false);
  }, []);

  const finishTutorTurn = useCallback(() => {
    if (turnCompletedRef.current) return;
    turnCompletedRef.current = true;
    responseInFlightRef.current = false;
    turnCompleteRef.current = false;
    setSpeaking(false);
    const studentTurn = flushStudentTranscript();
    flushTutorTranscript();

    const completeTurn = () => {
      const completionActions = getTutorTurnCompletionActions(
        pendingLectureResumeRef.current,
        studentSpeakingRef.current,
        studentTurn.turnKind,
      );
      for (const action of completionActions) {
        if (action === "resume-lecture") {
          pendingLectureResumeRef.current = false;
          optionsRef.current.onResumeLecture?.();
        } else {
          // requestResume can deliberately defer while React still mirrors the just-finished tutor
          // audio as speaking. Always release that deferred request after the resume tool handoff.
          optionsRef.current.onTutorTurnComplete?.();
        }
      }
      if (studentTurn.turnKind === "pause") pendingLectureResumeRef.current = false;
    };

    if (studentTurn.turnKind === "drawing" && !boardHandledThisTurnRef.current) {
      // Tool use is probabilistic even under a strict system instruction. Never let a model omit a
      // board the student explicitly requested: hold completion/resume and run the same async board
      // pipeline locally. This also prevents an early resume_lecture call from racing the drawing.
      boardChainPendingRef.current = true;
      void fallbackDrawingRef.current(studentTurn.text).finally(() => {
        boardChainPendingRef.current = false;
        completeTurn();
      });
      return;
    }

    completeTurn();
  }, [flushStudentTranscript, flushTutorTranscript]);

  const scheduleSettle = useCallback(() => {
    if (
      boardChainPendingRef.current ||
      responseInFlightRef.current ||
      playingSourcesRef.current.size > 0 ||
      !turnCompleteRef.current ||
      studentSpeakingRef.current
    ) {
      return;
    }
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      finishTutorTurn();
    }, SETTLE_MS);
  }, [finishTutorTurn]);

  const markTutorActive = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = null;
    turnCompletedRef.current = false;
    responseInFlightRef.current = true;
    turnCompleteRef.current = false;
    if (!suppressCurrentTurnRef.current && !contextOnlyTurnRef.current) setSpeaking(true);
  }, []);

  const playAudioChunk = useCallback(
    (base64: string) => {
      if (suppressCurrentTurnRef.current || contextOnlyTurnRef.current) return;
      const AudioContextCtor = getAudioContextConstructor();
      if (!AudioContextCtor) throw new Error("This browser does not support Web Audio.");
      const context = audioContextRef.current ?? new AudioContextCtor();
      audioContextRef.current = context;
      if (context.state === "suspended") {
        void context.resume().catch(() => setStatus("blocked"));
      }

      const samples = base64ToFloat32(base64);
      const buffer = context.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        playingSourcesRef.current.delete(source);
        if (playingSourcesRef.current.size === 0 && !responseInFlightRef.current) {
          setSpeaking(false);
          scheduleSettle();
        }
      };
      const startAt = Math.max(context.currentTime, nextPlayTimeRef.current);
      source.start(startAt);
      playingSourcesRef.current.add(source);
      nextPlayTimeRef.current = startAt + buffer.duration;
      setSpeaking(true);
    },
    [scheduleSettle],
  );

  const beginStudentSpeech = useCallback(() => {
    if (studentSpeakingRef.current) return;
    studentSpeakingRef.current = true;
    pendingLectureResumeRef.current = false;
    suppressCurrentTurnRef.current = true;
    contextOnlyTurnRef.current = false;
    responseInFlightRef.current = false;
    turnCompletedRef.current = true;
    boardHandledThisTurnRef.current = false;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = null;

    /**
     * Cutting the audio happens IMMEDIATELY and unconditionally — before any judgement about what
     * the student is saying. Two people talking at once is the worst possible outcome, and no
     * classification is worth the latency of waiting for a transcript to decide.
     *
     * What is deferred is the lecture PAUSE, not the silence. See `onStudentSpeechStarted` below:
     * a cough, a "mm-hm", or someone talking in the room stops the audio for a moment but should
     * not tear down the lecture position. Only speech that looks like it is addressed to the
     * teacher does that.
     */
    stopPlayback();
    optionsRef.current.onStudentSpeechStarted?.();
  }, [stopPlayback]);

  const endStudentSpeech = useCallback(() => {
    if (!studentSpeakingRef.current) return;
    studentSpeakingRef.current = false;
    localSpeechFramesRef.current = 0;
    optionsRef.current.onStudentSpeechStopped?.();
    window.setTimeout(() => {
      if (!studentSpeakingRef.current) suppressCurrentTurnRef.current = false;
    }, 120);
  }, []);

  const teardown = useCallback(
    (reason: SessionEndReason) => {
      if (endedRef.current) return;
      endedRef.current = true;
      clearTimers();
      toolAbortControllersRef.current.forEach((controller) => controller.abort());
      toolAbortControllersRef.current.clear();
      micProcessorRef.current?.disconnect();
      micSourceRef.current?.disconnect();
      silentGainRef.current?.disconnect();
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      stopPlayback();
      try {
        sessionRef.current?.close();
      } catch {
        // The socket may already be closed.
      }
      void audioContextRef.current?.close().catch(() => undefined);
      sessionRef.current = null;
      audioContextRef.current = null;
      micStreamRef.current = null;
      micSourceRef.current = null;
      micProcessorRef.current = null;
      silentGainRef.current = null;
      micIntentRef.current = new MicrophoneIntent(optionsRef.current.startMuted === true);
      responseInFlightRef.current = false;
      turnCompleteRef.current = false;
      boardChainPendingRef.current = false;
      pendingLectureResumeRef.current = false;
      studentSpeakingRef.current = false;
      suppressCurrentTurnRef.current = false;
      contextOnlyTurnRef.current = false;
      connectingRef.current = false;
      flushStudentTranscript();
      flushTutorTranscript();
      setSpeaking(false);
      setMuted(false);
      setStatus(reason === "error" ? "error" : "idle");
      optionsRef.current.onSessionEnded?.(reason);
    },
    [clearTimers, flushStudentTranscript, flushTutorTranscript, stopPlayback],
  );

  const stop = useCallback(() => teardown("user"), [teardown]);

  const resetIdleTimer = useCallback(() => {
    if (optionsRef.current.alwaysOn) return;
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      if (!endedRef.current) teardown("idle");
    }, IDLE_TIMEOUT_MS);
  }, [teardown]);

  const executeToolCall = useCallback(async (call: GeminiFunctionCall) => {
    const name = call.name ?? "";
    const id = call.id ?? `${name}-${Date.now()}`;
    if (name === "pause_lecture") {
      optionsRef.current.onPauseLecture?.();
      return { id, name, response: { output: "The lecture is paused. Wait for the student." } };
    }
    if (name === "resume_lecture") {
      pendingLectureResumeRef.current = true;
      return {
        id,
        name,
        response: { output: "Resume is scheduled after your current audio drains. Do not speak after this response." },
      };
    }
    if (name !== "show_board") {
      return { id, name, response: { error: `Unknown tool: ${name}` } };
    }

    boardHandledThisTurnRef.current = true;
    optionsRef.current.onPauseLecture?.();
    const concept = typeof call.args?.concept === "string" ? call.args.concept.trim() : "";
    const visualMode = typeof call.args?.visual_mode === "string" ? call.args.visual_mode : "annotated_board";
    const reuseContext = call.args?.reuse_context === true;
    const controller = new AbortController();
    toolAbortControllersRef.current.set(id, controller);
    setStatus("drawing");

    try {
      if (!concept) throw new Error("A concept is required to create a slide.");
      const response = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          topic: optionsRef.current.topic,
          beatContext: optionsRef.current.getBeatContext(),
          question: concept,
          textOnly: optionsRef.current.boardTextOnly === true,
          visualMode,
          reuseContext,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.script) throw new Error(data.error ?? "Could not create the slide.");

      /**
       * Show the board even if the tool call was cancelled mid-flight.
       *
       * A drawing takes ~20s to generate. Gemini cancels its own outstanding tool calls whenever
       * the student speaks (see toolCallCancellation below), so anything the student said during
       * that wait — including "is it done yet?" — used to discard a finished board. The symptom
       * was the sidebar sitting on "DRAWING…" while the board never changed, with a successful
       * 200 from /api/explain in the server log and no error anywhere.
       *
       * Cancellation should stop Aria NARRATING a slide that is no longer relevant; it should not
       * throw away a picture the student explicitly asked for and already paid for. So the board
       * is always handed over, and only the spoken follow-up is suppressed below.
       */
      optionsRef.current.onBoardRequest({ script: data.script, draw: data.draw });

      if (controller.signal.aborted) {
        // Deliver silently: the student has the floor, so Aria must not start talking about it.
        return { id, name, response: { output: "The slide is on the board. Do not describe it unless asked." } };
      }
      return {
        id,
        name,
        response: {
          output: `A fresh teaching slide for "${concept}" is now visible. Briefly explain its important parts.`,
        },
      };
    } catch (error) {
      return {
        id,
        name,
        response: {
          error: controller.signal.aborted
            ? "The slide request was canceled by an interruption."
            : error instanceof Error
              ? error.message
              : "Could not create the slide.",
        },
      };
    } finally {
      toolAbortControllersRef.current.delete(id);
      if (!endedRef.current) setStatus("live");
    }
  }, []);

  useEffect(() => {
    fallbackDrawingRef.current = async (concept: string) => {
      await executeToolCall({
        id: `local-drawing-${Date.now()}`,
        name: "show_board",
        args: { concept, visual_mode: "annotated_board", reuse_context: true },
      });
    };
  }, [executeToolCall]);

  const handleToolCalls = useCallback(
    async (calls: GeminiFunctionCall[]) => {
      if (calls.length === 0 || !sessionRef.current) return;
      markTutorActive();
      boardChainPendingRef.current = true;
      const responses = await Promise.all(calls.map(executeToolCall));
      if (endedRef.current || !sessionRef.current) return;
      boardChainPendingRef.current = false;
      responseInFlightRef.current = true;
      turnCompleteRef.current = false;
      sessionRef.current.sendToolResponse({ functionResponses: responses });
    },
    [executeToolCall, markTutorActive],
  );

  const handleServerMessage = useCallback(
    (message: GeminiServerMessage) => {
      const activity = message.voiceActivity?.voiceActivityType;
      if (activity === "ACTIVITY_START") {
        resetIdleTimer();
        beginStudentSpeech();
      } else if (activity === "ACTIVITY_END") {
        resetIdleTimer();
        endStudentSpeech();
      }

      if (message.toolCallCancellation?.ids) {
        for (const id of message.toolCallCancellation.ids) {
          toolAbortControllersRef.current.get(id)?.abort();
          toolAbortControllersRef.current.delete(id);
        }
      }

      const content = message.serverContent;
      if (content?.interrupted) {
        suppressCurrentTurnRef.current = true;
        responseInFlightRef.current = false;
        turnCompletedRef.current = true;
        boardChainPendingRef.current = false;
        stopPlayback();
      }

      const interimInput = content?.interimInputTranscription?.text;
      if (interimInput) {
        beginStudentSpeech();
        optionsRef.current.onTranscript?.("student", interimInput, false);
      }
      const inputText = content?.inputTranscription?.text;
      if (inputText) {
        studentTranscriptRef.current = appendTranscript(studentTranscriptRef.current, inputText);
        optionsRef.current.onTranscript?.("student", inputText, false);
      }
      const outputText = content?.outputTranscription?.text;
      if (outputText) {
        tutorTranscriptRef.current = appendTranscript(tutorTranscriptRef.current, outputText);
        if (!contextOnlyTurnRef.current) optionsRef.current.onTranscript?.("tutor", outputText, false);
      }

      for (const part of content?.modelTurn?.parts ?? []) {
        if (!part.inlineData?.data) continue;
        markTutorActive();
        try {
          playAudioChunk(part.inlineData.data);
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : "Could not play Gemini audio.");
          teardown("error");
          return;
        }
      }

      const calls = message.toolCall?.functionCalls ?? [];
      if (calls.length > 0) {
        contextOnlyTurnRef.current = false;
        suppressCurrentTurnRef.current = false;
        void handleToolCalls(calls);
      }

      if (content?.generationComplete) {
        responseInFlightRef.current = false;
        if (playingSourcesRef.current.size === 0) setSpeaking(false);
        scheduleSettle();
      }
      if (content?.turnComplete) {
        responseInFlightRef.current = false;
        turnCompleteRef.current = true;
        if (contextOnlyTurnRef.current) {
          contextOnlyTurnRef.current = false;
          tutorTranscriptRef.current = "";
          turnCompletedRef.current = true;
          turnCompleteRef.current = false;
          setSpeaking(false);
        } else {
          scheduleSettle();
        }
      }
    },
    [beginStudentSpeech, endStudentSpeech, handleToolCalls, markTutorActive, playAudioChunk, resetIdleTimer, scheduleSettle, stopPlayback, teardown],
  );

  const startMicrophone = useCallback(
    async (stream: MediaStream, session: GeminiSession) => {
      const AudioContextCtor = getAudioContextConstructor();
      if (!AudioContextCtor) throw new Error("This browser does not support Web Audio.");
      const context = audioContextRef.current ?? new AudioContextCtor();
      audioContextRef.current = context;
      if (context.state === "suspended") await context.resume();

      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error("The selected microphone did not provide an audio track.");
      micIntentRef.current?.apply(track);
      setMuted(!track.enabled);
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      micSourceRef.current = source;
      micProcessorRef.current = processor;
      silentGainRef.current = silentGain;

      processor.onaudioprocess = (event) => {
        if (sessionRef.current !== session || !track.enabled) return;
        const channel = event.inputBuffer.getChannelData(0);
        const pcm = downsample(channel, context.sampleRate);
        session.sendRealtimeInput({
          audio: {
            data: float32ToPcm16Base64(pcm),
            mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
          },
        });

        let energy = 0;
        for (let index = 0; index < channel.length; index += 1) energy += channel[index] * channel[index];
        const rms = Math.sqrt(energy / channel.length);
        const threshold = Math.max(0.025, noiseFloorRef.current * 3.8);
        const now = performance.now();
        if (rms > threshold) {
          localSpeechFramesRef.current += 1;
          lastLoudFrameAtRef.current = now;
          if (localSpeechFramesRef.current >= 2) beginStudentSpeech();
        } else {
          if (!studentSpeakingRef.current) {
            noiseFloorRef.current = noiseFloorRef.current * 0.96 + Math.min(rms, 0.03) * 0.04;
            localSpeechFramesRef.current = 0;
          } else if (now - lastLoudFrameAtRef.current > 700) {
            endStudentSpeech();
          }
        }
      };

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);
    },
    [beginStudentSpeech, endStudentSpeech],
  );

  const start = useCallback(async () => {
    if (sessionRef.current || connectingRef.current) return;
    connectingRef.current = true;
    endedRef.current = false;
    setErrorMessage(null);
    setStatus("connecting");

    const tokenPromise = fetch("/api/gemini-live-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: optionsRef.current.topic,
        beatContext: optionsRef.current.getBeatContext(),
        lessonContext: optionsRef.current.getLessonContext?.() ?? "",
        mood: optionsRef.current.mood ?? "",
        adhdMode: optionsRef.current.adhdMode === true,
        examMode: optionsRef.current.examMode === true,
        examQuestions: optionsRef.current.examMode ? optionsRef.current.examQuestions ?? [] : undefined,
      }),
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token) throw new Error(data.error ?? "Could not start Gemini Live.");
      return data as { token: string; model: string; instructions: string };
    });

    if (!navigator.mediaDevices?.getUserMedia) {
      tokenPromise.catch(() => undefined);
      setErrorMessage("This browser does not support microphone capture.");
      setStatus("error");
      connectingRef.current = false;
      return;
    }
    const micPromise = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    let stream: MediaStream;
    let sessionData: { token: string; model: string; instructions: string };
    try {
      stream = await micPromise;
    } catch {
      tokenPromise.catch(() => undefined);
      setStatus("mic-denied");
      connectingRef.current = false;
      return;
    }
    try {
      sessionData = await tokenPromise;
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      setErrorMessage(error instanceof Error ? error.message : "Could not start Gemini Live.");
      setStatus("error");
      connectingRef.current = false;
      return;
    }

    micStreamRef.current = stream;
    try {
      const {
        GoogleGenAI,
        Modality,
        ThinkingLevel,
        StartSensitivity,
        EndSensitivity,
        ActivityHandling,
      } = await import("@google/genai");
      const client = new GoogleGenAI({
        apiKey: sessionData.token,
        httpOptions: { apiVersion: "v1alpha" },
      });
      const functionDeclarations = optionsRef.current.examMode
        ? []
        : optionsRef.current.lectureControlTools
          ? [SHOW_BOARD_TOOL, PAUSE_LECTURE_TOOL, RESUME_LECTURE_TOOL]
          : [SHOW_BOARD_TOOL];

      const session = (await client.live.connect({
        model: sessionData.model,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
          systemInstruction: { parts: [{ text: sessionData.instructions }] },
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
              endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
              prefixPaddingMs: 120,
              silenceDurationMs: 550,
            },
            activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
          },
          tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined,
        },
        callbacks: {
          onopen: () => setStatus("live"),
          onmessage: (message: GeminiServerMessage) => handleServerMessage(message),
          onerror: (event: { message?: string }) => {
            if (endedRef.current) return;
            setErrorMessage(event.message ?? "Gemini Live connection error.");
            teardown("error");
          },
          onclose: () => {
            if (!endedRef.current) {
              setErrorMessage("Gemini Live disconnected.");
              teardown("error");
            }
          },
        },
      })) as GeminiSession;

      sessionRef.current = session;
      await startMicrophone(stream, session);
      connectingRef.current = false;
      setStatus("live");
      if (!optionsRef.current.alwaysOn) {
        resetIdleTimer();
        const cap = optionsRef.current.examMode ? EXAM_MAX_SESSION_MS : MAX_SESSION_MS;
        maxTimerRef.current = setTimeout(() => teardown("timeout"), cap);
      }
      if (optionsRef.current.examMode) {
        markTutorActive();
        session.sendRealtimeInput({
          text: "Start the oral exam now. Briefly greet the student, then ask question 1 exactly once.",
        });
      }
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      setErrorMessage(error instanceof Error ? error.message : "Gemini Live connection failed.");
      teardown("error");
    }
  }, [handleServerMessage, markTutorActive, resetIdleTimer, startMicrophone, teardown]);

  const setMicEnabled = useCallback((enabled: boolean) => {
    // Record intent first. During connection there is intentionally no track yet; returning before
    // this assignment is the race that intermittently left Gemini deaf after the learner clicked.
    micIntentRef.current?.set(enabled);
    setMuted(!enabled);
    const track = micStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    if (track.enabled === enabled) {
      if (enabled && audioContextRef.current?.state === "suspended") {
        void audioContextRef.current.resume().catch(() => setStatus("blocked"));
      }
      return;
    }
    track.enabled = enabled;
    if (!enabled) {
      sessionRef.current?.sendRealtimeInput({ audioStreamEnd: true });
      endStudentSpeech();
    } else if (audioContextRef.current?.state === "suspended") {
      void audioContextRef.current.resume().catch(() => setStatus("blocked"));
    }
  }, [endStudentSpeech]);

  const toggleMute = useCallback(() => {
    const track = micStreamRef.current?.getAudioTracks()[0];
    // While connecting, toggle the queued intent rather than doing nothing because the physical
    // track has not arrived yet. This keeps the mute button honest in every connection phase.
    const currentlyEnabled = track?.enabled ?? micIntentRef.current?.get() ?? false;
    setMicEnabled(!currentlyEnabled);
  }, [setMicEnabled]);

  const say = useCallback(
    (prompt: string) => {
      if (!sessionRef.current || !prompt.trim()) return;
      suppressCurrentTurnRef.current = false;
      contextOnlyTurnRef.current = false;
      markTutorActive();
      sessionRef.current.sendRealtimeInput({ text: prompt.trim() });
    },
    [markTutorActive],
  );

  const addContext = useCallback((text: string) => {
    if (!sessionRef.current || !text.trim()) return;
    contextOnlyTurnRef.current = true;
    suppressCurrentTurnRef.current = true;
    sessionRef.current.sendRealtimeInput({
      text: `[SILENT CONTEXT UPDATE — store this for the student's next question and do not reply]: ${text.trim()}`,
    });
  }, []);

  const silence = useCallback(() => {
    suppressCurrentTurnRef.current = true;
    responseInFlightRef.current = false;
    turnCompletedRef.current = true;
    stopPlayback();
  }, [stopPlayback]);

  const isSpeaking = useCallback(
    () =>
      !suppressCurrentTurnRef.current &&
      (responseInFlightRef.current || boardChainPendingRef.current || playingSourcesRef.current.size > 0),
    [],
  );

  useEffect(() => {
    return () => {
      if (!endedRef.current && (sessionRef.current || micStreamRef.current)) teardown("error");
    };
  }, [teardown]);

  return {
    status,
    speaking,
    muted,
    errorMessage,
    start,
    stop,
    toggleMute,
    setMicEnabled,
    say,
    addContext,
    silence,
    isSpeaking,
  };
}
