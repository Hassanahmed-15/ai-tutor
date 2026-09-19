"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DrawScript } from "@/components/sketch/LiveSketch";
// RELATIVE, not "@/lib/adhd/mouth". This module is pulled into the CJS test build, where the "@/"
// alias has no runtime resolver — the existing "@/components/..." line above survives only because
// it is `import type` and erases at compile time. A value import must be relative or two unrelated
// test files fail with "Cannot find module".
import { attachMouthAnalyser, detachMouthAnalyser, type MouthToken } from "./adhd/mouth";
import { addCost, recordJsonCost } from "./costLedger";
import { geminiLiveCostFor, type GeminiLiveUsage } from "./modelPricing";
import {
  isDrawingRequest,
  PAUSE_LECTURE_TOOL,
  RESUME_LECTURE_TOOL,
  SHOW_BOARD_TOOL,
} from "./geminiLiveContract";
import {
  analyzeFrame,
  DEFAULT_GATE_CONFIG,
  InterruptionGate,
  isVoiceLike,
  type GateDecision,
} from "./interruptionGate";
import { turnCloseAction } from "./studentTurnLatch";

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
  /**
   * The student's uploaded document, read when the session connects.
   *
   * Added because the voice tutor had no document at all while the text chat did — so the same
   * question about the same paper got a grounded answer typed and a general one spoken.
   */
  getDocumentContext?: () => string;
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
  /**
   * Every barge-in decision, with the reason it was made.
   *
   * Exposed so a room where the tutor stops too readily — or not readily enough — can be diagnosed
   * from the decision trail instead of guesswork. See `lib/interruptionGate.ts`.
   */
  onInterruptionDecision?: (decision: GateDecision) => void;
  onExplicitPause?: () => void;
  onExplicitResume?: () => void;
  onTutorTurnComplete?: () => void;
  onPauseLecture?: () => void;
  onResumeLecture?: () => void;
  alwaysOn?: boolean;
  /**
   * While this returns true, Aria speaks only when asked to by `say()` or `sendText()`; a reply she
   * generates on her own to something the student said is neither played nor transcribed.
   *
   * For the planning conversation, where the question on screen must be the question she asks. The
   * live model answers every finished student turn by itself, and measured in real runs it asked
   * questions of its own ("Are you familiar with dynamic programming in this context?") while a
   * different one was on screen — an instruction not to did not stop it. The reply is already
   * spoken by the time the student's transcript reaches the page, so it cannot be silenced from
   * there; it has to be held here, as it arrives. Unset everywhere else, which is unchanged.
   */
  holdUnpromptedReplies?: () => boolean;
  adhdMode?: boolean;
  /**
   * Opens the session with the CASUAL check-in persona instead of the tutor one, and with
   * `resume_lecture` as its only tool.
   *
   * Read at connect time, like every other option here, so flipping it on a live session does
   * nothing — the caller must `stop()` and `start()` again to change persona. That is not a
   * limitation to work around: the system instruction is fixed for the life of a Live socket, so a
   * reconnect is the only honest way to change who is talking.
   */
  checkinMode?: boolean;
  /**
   * Opens the session with the LESSON-DESIGN persona: the tutor who keeps the student company while
   * their lesson is generated, with no lecture and no board to talk about.
   *
   * Read at connect time like checkinMode above, and for the same reason — a Live socket's system
   * instruction is fixed for its lifetime, so changing persona means reconnecting.
   */
  designMode?: boolean;
  /** Design mode only: the student cannot see the screen, so progress must be spoken. */
  blindMode?: boolean;
  /** Design mode only: what the lesson is being built from, so the persona can refer to it. */
  sourceKind?: "pdf" | "pptx" | "pages" | "topic";
  /** Optional first name, so the tutor can address the student naturally. */
  studentName?: string;
  boardTextOnly?: boolean;
  lectureControlTools?: boolean;
  startMuted?: boolean;
  examMode?: boolean;
  examQuestions?: string[];

  /**
   * Extra tools this session can call, and the handler that runs them.
   *
   * Added so a caller can make Gemini the ORCHESTRATOR of the app rather than just the narrator of
   * a lecture — the voice-first mode declares navigation, lecture control and status tools this
   * way. They are additive: when omitted, the session offers exactly the tools it always did, so
   * every existing player is unaffected.
   *
   * `onCustomToolCall` returns the string Gemini receives back as the tool's output. Returning a
   * sentence rather than a status code matters: it is fed straight back into the conversation, so
   * "The lecture is ready — 8 sections" lets Gemini say something useful, where "ok" leaves it
   * guessing.
   */
  customTools?: GeminiToolDeclaration[];
  onCustomToolCall?: (name: string, args: Record<string, unknown>) => Promise<string> | string;
  /** Replaces the built-in system instruction when provided. */
  systemInstruction?: string;
  /** Overrides the prebuilt voice name. */
  voiceName?: string;
};

/**
 * The subset of Gemini's function-declaration schema this app uses.
 *
 * `parametersJsonSchema` rather than `parameters`, matching the built-in tools in
 * geminiLiveContract.ts — the two forms are not interchangeable in the SDK.
 */
export type GeminiToolDeclaration = {
  name: string;
  description: string;
  parametersJsonSchema?: {
    type: "object";
    properties?: Record<string, { type: string; description?: string; enum?: readonly string[] }>;
    required?: readonly string[];
    additionalProperties?: boolean;
  };
};

type GeminiSession = {
  sendRealtimeInput: (input: {
    text?: string;
    audio?: { data: string; mimeType: string };
    audioStreamEnd?: boolean;
    /**
     * Manual turn boundaries, valid only while `automaticActivityDetection.disabled` is true.
     *
     * The empty objects are the whole payload — the signal is the presence of the field. They
     * replace `audioStreamEnd`, which belongs to the automatic mode this session no longer uses.
     */
    activityStart?: Record<string, never>;
    activityEnd?: Record<string, never>;
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
  /** Per-turn token usage — not cumulative, so every message's figure is added. */
  usageMetadata?: GeminiLiveUsage;
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

/**
 * How loud the tutor stays while the gate is waiting to hear whether it was addressed.
 *
 * Must match `DEFAULT_GATE_CONFIG.duckGain` — the gate reports the figure through `onDuck`, but a
 * reply that starts mid-episode has to build its bus at the same level before any callback runs.
 */
const DUCKED_GAIN = DEFAULT_GATE_CONFIG.duckGain;

/**
 * Analysis window, in samples at 16 kHz — 32 ms.
 *
 * The mic callback delivers 4096 frames at the device rate, which is ~85 ms at the usual 48 kHz.
 * Feeding the gate one decision per callback would quantise its 240 ms debounce to three coarse
 * steps and blur the duck latency badly, so each callback is sliced into 32 ms windows and pushed
 * with interpolated timestamps. This is also exactly the window the gate's tests are written
 * against, so tuned thresholds mean the same thing in the browser as on the bench.
 */
const ANALYSIS_FRAME = 512;
const ANALYSIS_FRAME_MS = (ANALYSIS_FRAME / INPUT_SAMPLE_RATE) * 1000;

/**
 * Silence that ends a spoken turn, in milliseconds.
 *
 * With manual activity detection the model replies on `activityEnd`, so this is the "you can answer
 * now" signal. 800 ms comfortably outlasts the pause inside a sentence (and the hesitation before a
 * hard word) while keeping the reply prompt; it is deliberately longer than the gate's own 650 ms
 * silenceMs, which answers the different question of whether an interruption episode has ended.
 */
const END_OF_UTTERANCE_MS = 800;

/**
 * Fade applied to each end of every PCM chunk, and to an interrupted stop, in seconds.
 *
 * Long enough to remove the step discontinuity that makes a click, short enough to be inaudible as
 * a fade — 1.5 ms is roughly one cycle at 650 Hz, well under the ~20 ms the ear needs to hear an
 * amplitude change as anything but a transient.
 */
const CHUNK_FADE_S = 0.0015;

/**
 * Fade applied when the tutor is cut off mid-word, in seconds.
 *
 * Longer than the chunk seam because it happens at an arbitrary point in a vowel, where amplitude
 * is at its highest — the discontinuity is correspondingly bigger. Still short enough that a
 * barge-in feels instant.
 */
const STOP_FADE_S = 0.012;
const IDLE_TIMEOUT_MS = 60_000;
const MAX_SESSION_MS = 5 * 60_000;
const EXAM_MAX_SESSION_MS = 12 * 60_000;
const SETTLE_MS = 500;

/**
 * Automatic recovery from a dropped Live socket.
 *
 * WHY THIS EXISTS. Every close was terminal: `onclose` called teardown, nothing dialled again, and
 * the student was left with a dead microphone and "Gemini Live disconnected." A lesson build runs
 * four to six minutes, and a Live session does not reliably last that long — the dev logs for a
 * single planning session show twenty separate token mints, which is this failure happening over
 * and over and being papered over by the student pressing the button again.
 *
 * ONLY FOR `alwaysOn` SESSIONS. Those are the ones whose whole purpose is to stay up across a long
 * wait (lesson design, planning, voice-first). A session that ends because the student stopped it,
 * went idle, or hit its cap SHOULD stay ended — reconnecting there would resurrect a conversation
 * nobody asked for, and bill for it.
 *
 * BACKOFF, AND A CEILING. A server refusing connections (bad key, revoked project, quota) must not
 * be hammered: each attempt waits longer, and after MAX_RECONNECTS the session stays down with the
 * real reason on screen. Recovery is for transient drops, not for a misconfiguration that will
 * never succeed however many times it is retried.
 */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];
const MAX_RECONNECTS = RECONNECT_DELAYS_MS.length;

/**
 * Close codes that mean "do not bother trying again".
 *
 * 1000/1005 are ordinary end-of-session closes. 1008 is a policy close — denied access, revoked
 * key, quota — and retrying it produces the same refusal five more times while telling the student
 * it is reconnecting. Everything else (1006 abnormal, 1011 server error, network drops) is exactly
 * what recovery is for.
 */
const FATAL_CLOSE_CODES = new Set([1000, 1005, 1008]);

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
  const [micAvailable, setMicAvailable] = useState(true);
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
  /**
   * A single node every reply chunk plays through, so the avatar's mouth follows the tutor's voice
   * as well as the scripted narration.
   *
   * Per-chunk analysers would be wrong: replies arrive as a stream of short buffers, so the mouth
   * would be re-attached and torn down several times a second. One persistent node on this context
   * gives a continuous envelope across the whole reply.
   */
  const mouthBusRef = useRef<GainNode | null>(null);
  const mouthTokenRef = useRef<MouthToken | undefined>(undefined);
  const nextPlayTimeRef = useRef(0);
  const responseInFlightRef = useRef(false);
  const turnCompleteRef = useRef(false);
  const turnCompletedRef = useRef(false);
  const boardChainPendingRef = useRef(false);
  const pendingLectureResumeRef = useRef(false);
  const studentSpeakingRef = useRef(false);
  const suppressCurrentTurnRef = useRef(false);
  /** True once say()/sendText() asked for a reply; cleared when the student addresses her again. */
  const promptedTurnRef = useRef(false);
  /**
   * Output mute: the tutor's VOICE is silenced, the session stays fully alive.
   *
   * Distinct from `muted`, which is the microphone. Muting the mic stops Gemini hearing the
   * student; it does nothing about Gemini talking, so a "Mute" button wired only to the mic leaves
   * the tutor audibly speaking over someone who just asked for quiet. Both exist because they are
   * genuinely different requests, and the UI now offers each by name.
   */
  const outputMutedRef = useRef(false);
  /** How many times this session has auto-reconnected. Reset by a successful connect. */
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True while a recovery is pending, so the UI can say "reconnecting" rather than "error". */
  const [reconnecting, setReconnecting] = useState(false);
  const [outputMuted, setOutputMuted] = useState(false);
  const contextOnlyTurnRef = useRef(false);
  const studentTranscriptRef = useRef("");
  const tutorTranscriptRef = useRef("");
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The barge-in decision, owned entirely by the client. See `lib/interruptionGate.ts`.
   *
   * Constructed lazily on the first mic frame because its callbacks close over `stopPlayback` and
   * the duck helpers, which are not defined yet at this point in the hook body.
   */
  const gateRef = useRef<InterruptionGate | null>(null);
  /** Every gate decision, kept so a wrong call in a real room can be explained afterwards. */
  const gateLogRef = useRef<GateDecision[]>([]);
  /**
   * Whether the tutor's voice is currently ducked rather than stopped.
   *
   * Tracked separately from the gate's own stage because teardown, mute and reconnect all need to
   * restore the gain without consulting the state machine.
   */
  const duckedRef = useRef(false);
  /**
   * Whether we have told the server a turn is in progress.
   *
   * With automatic VAD disabled the server does nothing until we say so, and an `activityEnd`
   * without a matching `activityStart` is a protocol error rather than a no-op.
   */
  const activityOpenRef = useRef(false);
  /**
   * Indirection so `endStudentSpeech` can close the turn.
   *
   * `closeActivity` is declared further down because it reads `sessionRef`, and the two would
   * otherwise form a declaration cycle. The ref is assigned once `closeActivity` exists.
   */
  const closeActivityRef = useRef<() => void>(() => undefined);
  /** Same indirection as `closeActivityRef`: the mic callback runs before `openActivity` exists. */
  const openActivityRef = useRef<() => void>(() => undefined);
  /**
   * Same indirection again, for the end-of-utterance close in the mic callback.
   *
   * That close must go through `endStudentSpeech` — it is the only thing that clears
   * `suppressCurrentTurnRef`, the hard mute on playback — and `endStudentSpeech` is a useCallback
   * declared further down.
   */
  const endStudentSpeechRef = useRef<() => void>(() => undefined);
  /** When voice-like audio was last heard, for deciding the utterance is over. 0 = not speaking. */
  const lastVoiceHeardAtRef = useRef(0);
  const endedRef = useRef(false);
  const connectingRef = useRef(false);
  /** Bumped on every start() and every teardown, so a stale in-flight connect can abandon itself. */
  const connectAttemptRef = useRef(0);
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
    // A pending reconnect is a timer like any other: an explicit stop must cancel it, or the
    // session the student just ended dials itself back a second later.
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    idleTimerRef.current = null;
    maxTimerRef.current = null;
    settleTimerRef.current = null;
    reconnectTimerRef.current = null;
  }, []);

  /**
   * Called via a ref because `start` is defined below this point and the close handler is created
   * above it. A ref is the smallest way to break that cycle without reordering the whole hook.
   */
  const startRef = useRef<(() => Promise<void>) | null>(null);

  /**
   * Bring a dropped session back, or give up honestly.
   *
   * Returns true when a retry was scheduled, so the caller knows whether to report an error to the
   * student or to say it is reconnecting. Only `alwaysOn` sessions recover — see the constants
   * above for why a stopped, idle or capped session must stay stopped.
   */
  const scheduleReconnect = useCallback((closeCode?: number): boolean => {
    if (!optionsRef.current.alwaysOn) return false;
    if (closeCode !== undefined && FATAL_CLOSE_CODES.has(closeCode)) return false;
    if (reconnectCountRef.current >= MAX_RECONNECTS) return false;

    const delay = RECONNECT_DELAYS_MS[reconnectCountRef.current];
    reconnectCountRef.current += 1;
    setReconnecting(true);
    setStatus("connecting");

    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      /*
       * `endedRef` is cleared by start() itself. Reaching here means the drop was not the
       * student's doing, so the session is allowed to come back — but if something tore it down
       * deliberately in the meantime, clearTimers above has already cancelled this.
       */
      void startRef.current?.();
    }, delay);
    return true;
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

  /**
   * Ride the tutor's volume down without stopping it.
   *
   * This is the whole reason the gate can afford to wait for words. Ducking is instant and cheap to
   * be wrong about — a brief dip if the neighbour coughs — where stopping is not. The ramp is short
   * enough to feel immediate but not so abrupt that it clicks.
   *
   * The target is `mouthBusRef`, the one gain node every reply chunk already routes through. It is
   * null whenever the tutor is not speaking, in which case there is nothing to duck and the gate's
   * request is simply a no-op that `restoreTutorVolume` will not have to undo.
   */
  const duckTutorVolume = useCallback((gain: number) => {
    duckedRef.current = true;
    const bus = mouthBusRef.current;
    const context = audioContextRef.current;
    if (!bus || !context) return;
    try {
      bus.gain.cancelScheduledValues(context.currentTime);
      bus.gain.setTargetAtTime(gain, context.currentTime, 0.02);
    } catch {
      // A node belonging to a closed context cannot be scheduled against.
    }
  }, []);

  const restoreTutorVolume = useCallback(() => {
    duckedRef.current = false;
    const bus = mouthBusRef.current;
    const context = audioContextRef.current;
    if (!bus || !context) return;
    try {
      bus.gain.cancelScheduledValues(context.currentTime);
      bus.gain.setTargetAtTime(1, context.currentTime, 0.04);
    } catch {
      // Same as above: a torn-down context has nothing left to restore.
    }
  }, []);

  const stopPlayback = useCallback(() => {
    const context = audioContextRef.current;
    const bus = mouthBusRef.current;
    /*
     * Fade the bus out before stopping the sources, rather than cutting them dead.
     *
     * A barge-in lands mid-vowel, where the waveform is nowhere near zero, so `source.stop()` on
     * its own leaves a full-amplitude step — the pop heard every time the tutor is interrupted.
     * Ramping the one node they all share takes every source down together, then the stop happens
     * just after the ramp has reached silence and is inaudible.
     *
     * The sources are still stopped explicitly: a fade alone would leave them playing silently,
     * holding the graph and the `onended` bookkeeping open.
     */
    const stopAt = context && bus ? context.currentTime + STOP_FADE_S : 0;
    if (context && bus) {
      try {
        bus.gain.cancelScheduledValues(context.currentTime);
        bus.gain.setValueAtTime(bus.gain.value, context.currentTime);
        bus.gain.linearRampToValueAtTime(0, stopAt);
      } catch {
        // A closed context cannot be scheduled against; fall through to the hard stop.
      }
    }
    for (const source of playingSourcesRef.current) {
      try {
        source.stop(stopAt);
      } catch {
        // A source that just ended cannot be stopped again.
      }
    }
    playingSourcesRef.current.clear();
    nextPlayTimeRef.current = audioContextRef.current?.currentTime ?? 0;
    setSpeaking(false);
    // The bus this duck applied to is about to be discarded, so the gain never needs unwinding —
    // but the flag must clear, or the next reply would build a fresh bus while we still believe the
    // tutor is ducked and never restore it.
    duckedRef.current = false;
    // Interruption and teardown both land here. Detaching is idempotent — a token that no longer
    // owns the analyser is ignored — so it is safe alongside the same call in `source.onended`.
    detachMouthAnalyser(mouthTokenRef.current);
    mouthTokenRef.current = undefined;
    mouthBusRef.current = null;
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

  /** A reply the caller did not ask for, while asking is required (see `holdUnpromptedReplies`). */
  const isHeldReply = useCallback(
    () => Boolean(optionsRef.current.holdUnpromptedReplies?.()) && !promptedTurnRef.current,
    [],
  );

  const markTutorActive = useCallback(() => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = null;
    turnCompletedRef.current = false;
    responseInFlightRef.current = true;
    turnCompleteRef.current = false;
    if (!suppressCurrentTurnRef.current && !contextOnlyTurnRef.current && !isHeldReply()) setSpeaking(true);
  }, [isHeldReply]);

  const playAudioChunk = useCallback(
    (base64: string) => {
      if (suppressCurrentTurnRef.current || contextOnlyTurnRef.current || isHeldReply()) return;
      // Dropped rather than buffered: a queue flushed on unmute would replay a turn the
      // conversation has already moved past.
      if (outputMutedRef.current) return;
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
      // Build the mouth bus once per context, then route every chunk through it.
      if (!mouthBusRef.current || mouthBusRef.current.context !== context) {
        const bus = context.createGain();
        // A duck can be asked for while the tutor is between chunks, when there is no bus to apply
        // it to. Honouring it on the bus we are about to build keeps the reply quiet as intended
        // instead of letting it come back at full volume mid-episode.
        bus.gain.value = duckedRef.current ? DUCKED_GAIN : 1;
        bus.connect(context.destination);
        mouthBusRef.current = bus;
        mouthTokenRef.current = attachMouthAnalyser(context, bus);
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      /*
       * A ~1.5 ms fade on each end of every chunk. This is the beep.
       *
       * Gemini sends the reply as a stream of short PCM buffers that are scheduled back to back.
       * A buffer starts and ends at whatever sample value the encoder happened to land on, which is
       * almost never zero — so each seam is a step discontinuity in the waveform, and a step is a
       * click. Because the chunks arrive at a steady cadence, the clicks do too, and a periodic
       * click train is heard as a tone: the "beep" is the chunk rate itself.
       *
       * Ramping each chunk up from and back down to silence forces every seam to zero, so the
       * clicks have nothing to click about. 1.5 ms is below the ear's pitch-perception threshold,
       * so it removes the transient without softening consonants or sounding like a fade.
       */
      const chunkGain = context.createGain();
      chunkGain.connect(mouthBusRef.current);
      source.connect(chunkGain);
      source.onended = () => {
        playingSourcesRef.current.delete(source);
        // Each chunk owns a gain node; leaving them attached would grow the graph for the whole
        // reply and keep every one of them summing into the bus.
        try {
          chunkGain.disconnect();
        } catch {
          // Already detached by a teardown that ran first.
        }
        if (playingSourcesRef.current.size === 0 && !responseInFlightRef.current) {
          setSpeaking(false);
          // The reply is over — close the mouth rather than leaving it parked on the last chunk.
          detachMouthAnalyser(mouthTokenRef.current);
          mouthTokenRef.current = undefined;
          mouthBusRef.current = null;
          scheduleSettle();
        }
      };
      const startAt = Math.max(context.currentTime, nextPlayTimeRef.current);
      /*
       * The fade must be short relative to the chunk, or a very short buffer would be faded to
       * nothing. Half the chunk at most, so the envelope always has room to open and close.
       */
      const fade = Math.min(CHUNK_FADE_S, buffer.duration / 2);
      chunkGain.gain.setValueAtTime(0, startAt);
      chunkGain.gain.linearRampToValueAtTime(1, startAt + fade);
      chunkGain.gain.setValueAtTime(1, startAt + buffer.duration - fade);
      chunkGain.gain.linearRampToValueAtTime(0, startAt + buffer.duration);
      source.start(startAt);
      playingSourcesRef.current.add(source);
      nextPlayTimeRef.current = startAt + buffer.duration;
      setSpeaking(true);
      /*
       * Tell the gate the tutor is audible, for as long as this chunk plays.
       *
       * Browser echo cancellation is tuned for a headset and leaks badly over laptop speakers, so
       * the mic really does hear the tutor — and the tutor's voice passes every acoustic test in the
       * gate, because it IS a voice. Without this the lecture interrupts itself.
       *
       * The cooldown is measured from the END of the buffer, not from now: chunks are scheduled
       * back to back ahead of real time, so dating it from the call would expire the cooldown while
       * audio was still coming out of the speakers.
       */
      const audibleForMs = Math.max(0, startAt - context.currentTime + buffer.duration) * 1000;
      gateRef.current?.noteTutorAudio(performance.now() + audibleForMs);
    },
    [scheduleSettle],
  );

  const beginStudentSpeech = useCallback(() => {
    if (studentSpeakingRef.current) return;
    studentSpeakingRef.current = true;
    // Real words addressed to her — not a cough or a click, which only duck — begin a new student
    // turn, so whatever she says next was not asked for by say() (see holdUnpromptedReplies).
    promptedTurnRef.current = false;
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
    // Close the turn we opened on commit, so the model stops listening and answers.
    closeActivityRef.current();
    optionsRef.current.onStudentSpeechStopped?.();
    window.setTimeout(() => {
      if (!studentSpeakingRef.current) suppressCurrentTurnRef.current = false;
    }, 120);
  }, []);
  endStudentSpeechRef.current = endStudentSpeech;

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
      // Drop the episode but keep the gate itself: the learned noise floor describes the room, which
      // outlives this session and is the expensive thing to re-learn after a reconnect.
      activityOpenRef.current = false;
      gateRef.current?.reset();
      // Any connect still awaiting its mic or token is now stale.
      connectAttemptRef.current += 1;
      flushStudentTranscript();
      flushTutorTranscript();
      setSpeaking(false);
      setMuted(false);
      setMicAvailable(true);
      setStatus(reason === "error" ? "error" : "idle");
      optionsRef.current.onSessionEnded?.(reason);
    },
    [clearTimers, flushStudentTranscript, flushTutorTranscript, stopPlayback],
  );

  const stop = useCallback(() => {
    // An explicit stop must also abandon the recovery budget, so a later legitimate start()
    // begins with a full one rather than inheriting this session's failures.
    reconnectCountRef.current = 0;
    setReconnecting(false);
    teardown("user");
  }, [teardown]);

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
      // Anything not built in goes to the caller's handler, which is how the voice-first mode
      // implements navigation and lecture control without this file knowing about either.
      const custom = optionsRef.current.onCustomToolCall;
      if (custom) {
        try {
          const output = await custom(name, (call.args ?? {}) as Record<string, unknown>);
          return { id, name, response: { output } };
        } catch (err) {
          // The error text is handed back verbatim so Gemini can tell the student what went wrong
          // rather than silently doing nothing.
          return { id, name, response: { error: err instanceof Error ? err.message : "That action failed." } };
        }
      }
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
      recordJsonCost("questions", data);
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
      if (message.usageMetadata) addCost("liveTutor", geminiLiveCostFor(message.usageMetadata));
      /*
       * The server's VAD no longer interrupts anything.
       *
       * With `automaticActivityDetection.disabled: true` these messages should not arrive at all,
       * but they are still handled defensively because a server that resumed its own detection
       * would otherwise silently restore the exact bug this change removes. They are now treated as
       * evidence that someone is making noise — enough to keep the session from idling out, not
       * enough to stop the tutor. Only the gate stops the tutor.
       */
      const activity = message.voiceActivity?.voiceActivityType;
      if (activity === "ACTIVITY_START" || activity === "ACTIVITY_END") {
        resetIdleTimer();
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

      /*
       * An interim transcript no longer cuts the audio.
       *
       * It used to call `beginStudentSpeech()` directly, which meant ANY speech the server managed
       * to transcribe stopped the lecture — including the neighbour's conversation, which
       * transcribes just as cleanly as the student's. Words are still the only way to tell those
       * apart, so they are now routed to the gate's third stage, which is allowed to weigh them,
       * rather than acting as a trigger in their own right.
       */
      const interimInput = content?.interimInputTranscription?.text;
      if (interimInput) {
        optionsRef.current.onTranscript?.("student", interimInput, false);
        resetIdleTimer();
      }
      const inputText = content?.inputTranscription?.text;
      if (inputText) {
        studentTranscriptRef.current = appendTranscript(studentTranscriptRef.current, inputText);
        optionsRef.current.onTranscript?.("student", inputText, false);
        /*
         * Stage 3. This is the only place that can distinguish "someone is speaking" from "the
         * student is speaking TO US", and it is why the gate ducks instead of stopping: a transcript
         * arriving here resolves an episode that is currently only a dip in volume.
         *
         * `isAddressedToTeacher` already existed and was already correct — it was simply running
         * after the audio had been cut, where its answer could no longer prevent anything.
         */
        gateRef.current?.provideTranscript(
          studentTranscriptRef.current,
          isAddressedToTeacher(studentTranscriptRef.current),
          performance.now(),
        );
      }
      const outputText = content?.outputTranscription?.text;
      if (outputText) {
        // A held reply is not collected either, so its final transcript is empty and never shown.
        if (!isHeldReply()) tutorTranscriptRef.current = appendTranscript(tutorTranscriptRef.current, outputText);
        if (!contextOnlyTurnRef.current && !suppressCurrentTurnRef.current && !isHeldReply()) {
          optionsRef.current.onTranscript?.("tutor", outputText, false);
        }
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
    [handleToolCalls, markTutorActive, playAudioChunk, resetIdleTimer, scheduleSettle, stopPlayback, teardown],
  );

  /**
   * Open a turn on the server.
   *
   * With automatic VAD disabled the server is deaf to turn boundaries until we mark them, so this
   * is what actually hands the student's words to the model. It is called only once the gate has
   * committed — which is the entire point of the change: the server now hears a turn start when a
   * PERSON addressed the tutor, rather than whenever the room got loud.
   */
  const openActivity = useCallback(() => {
    if (activityOpenRef.current) return;
    const session = sessionRef.current;
    if (!session) return;
    activityOpenRef.current = true;
    try {
      session.sendRealtimeInput({ activityStart: {} });
    } catch {
      // A socket that closed between the gate's decision and this call.
    }
  }, []);

  const closeActivity = useCallback(() => {
    if (!activityOpenRef.current) return;
    const session = sessionRef.current;
    activityOpenRef.current = false;
    if (!session) return;
    try {
      session.sendRealtimeInput({ activityEnd: {} });
    } catch {
      // As above — nothing to close if the transport is gone.
    }
  }, []);

  // Assigned in an effect rather than during render: writing a ref while rendering is a React
  // correctness rule, and nothing reads this until a mic frame or a turn ends.
  useEffect(() => {
    closeActivityRef.current = closeActivity;
    openActivityRef.current = openActivity;
  }, [closeActivity, openActivity]);

  /**
   * Build the gate on first use and bind it to this hook's audio.
   *
   * Lazy because the callbacks close over `stopPlayback` and the duck helpers. Memoised on the ref
   * rather than rebuilt per session so the learned noise floor survives a reconnect — the room does
   * not change just because the socket dropped.
   */
  const ensureGate = useCallback(() => {
    if (gateRef.current) return gateRef.current;
    const gate = new InterruptionGate(
      {},
      {
        /*
         * Stage 2: sustained voice. Duck the tutor AND open the turn.
         *
         * OPENING THE TURN HERE IS NOT OPTIONAL — it is what makes voice work at all.
         *
         * With `automaticActivityDetection.disabled: true` the server transcribes nothing outside
         * an activity bracket. Opening the bracket only at stage 3 (an addressed transcript) was
         * therefore a deadlock: no bracket meant no transcript, no transcript meant stage 3 never
         * ran, so the bracket never opened. Voice was dead in every scenario — planning, lecture
         * and document Q&A alike — because all three share this hook.
         *
         * Stage 2 is the right place. It already means "a human voice has been speaking for 240 ms",
         * which is exactly when the server should start listening. Opening the bracket costs
         * nothing if the words turn out not to be for us: the audio is transcribed, stage 3 reads
         * it, and `onRestore` closes the turn again without ever stopping the tutor. The gate keeps
         * its whole job — deciding whether to INTERRUPT — while the server regains its ability to
         * hear.
         */
        onDuck: (gain) => {
          duckTutorVolume(gain);
          openActivity();
        },
        /*
         * Stage 3 said the words were not for us, or the speech simply stopped. Close the turn as
         * well as restoring the volume, or the bracket opened above would stay open forever and
         * the next real utterance would be appended to this one.
         */
        onRestore: () => {
          restoreTutorVolume();
          closeActivityRef.current();
        },
        // Stage 3 said the student is addressing the tutor. Only now does anything STOP; the turn
        // is already open from stage 2, which is what let the words arrive to be judged.
        onStop: () => {
          restoreTutorVolume();
          beginStudentSpeech();
        },
        onDecision: (decision) => {
          /*
           * Keep the decision trail bounded but long enough to explain a mistake.
           *
           * At ~31 windows a second this is roughly the last minute, which is what someone reporting
           * "it stopped for no reason" can actually still remember the cause of.
           */
          const log = gateLogRef.current;
          log.push(decision);
          if (log.length > 2000) log.splice(0, log.length - 2000);
          optionsRef.current.onInterruptionDecision?.(decision);
        },
      },
    );
    gateRef.current = gate;
    return gate;
  }, [beginStudentSpeech, duckTutorVolume, openActivity, restoreTutorVolume]);

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

      const gate = ensureGate();

      processor.onaudioprocess = (event) => {
        if (sessionRef.current !== session || !track.enabled) return;
        const channel = event.inputBuffer.getChannelData(0);
        const pcm = downsample(channel, context.sampleRate);

        /*
         * The audio goes up unconditionally, every frame, whatever the gate decides.
         *
         * With automatic VAD disabled the server transcribes only between `activityStart` and
         * `activityEnd`, and those brackets are what the gate controls. Withholding the audio
         * itself as well would mean the first syllables of a real question — the ones spoken during
         * the 240 ms debounce — never reached the model at all, and the tutor would answer a
         * question with its opening words missing.
         */
        session.sendRealtimeInput({
          audio: {
            data: float32ToPcm16Base64(pcm),
            mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
          },
        });

        /*
         * Slice the callback into 32 ms analysis windows.
         *
         * `performance.now()` is the time the callback ran, which corresponds to the END of this
         * buffer, so each window is back-dated to when its audio was actually captured. Feeding all
         * of them the same timestamp would make a debounce measured in milliseconds meaningless.
         */
        /*
         * WHEN THE TUTOR IS SILENT, THE GATE IS NOT NEEDED — SO IT IS NOT USED.
         *
         * The gate exists for exactly one problem: the tutor talking over itself, or being cut off
         * by a fan, WHILE IT IS SPEAKING. When nothing is playing there is nothing to protect, and
         * every judgement it makes can only subtract — a quiet question, a soft-spoken student or
         * an unusual microphone that fails its thresholds simply goes unheard, because with manual
         * VAD an unopened turn is a turn the server never transcribes.
         *
         * That is most of the planning conversation, where Aria asks a question and then waits.
         * Holding the bracket open while the tutor is silent means the student is always heard;
         * the gate resumes owning the decision the moment audio is actually playing, which is the
         * only time barge-in is a question at all.
         */
        const tutorAudible = playingSourcesRef.current.size > 0;
        if (!tutorAudible) {
          openActivityRef.current();
        }

        /*
         * CLOSE THE TURN WHEN THE STUDENT STOPS TALKING.
         *
         * With manual VAD the model answers on `activityEnd`, so an open bracket is also an
         * unanswered question — holding it open forever means Aria listens and never replies.
         *
         * The close is driven from the same frame analysis the gate uses, rather than from the
         * gate's own episode state, because the bracket can be opened above without the gate ever
         * reaching stage 2 (quiet speech during tutor silence, which is the case this whole change
         * exists to rescue). Voice-like audio refreshes the clock; `END_OF_UTTERANCE_MS` of no
         * voice-like audio ends the turn — long enough to survive the pause inside a sentence,
         * short enough that a finished question is answered promptly.
         */
        const frameFeatures = analyzeFrame(pcm.subarray(0, Math.min(pcm.length, ANALYSIS_FRAME)), INPUT_SAMPLE_RATE);
        const nowMs = performance.now();
        if (isVoiceLike(frameFeatures, DEFAULT_GATE_CONFIG) && frameFeatures.rms >= DEFAULT_GATE_CONFIG.minRms) {
          lastVoiceHeardAtRef.current = nowMs;
        } else {
          /*
           * The decision lives in `turnCloseAction` (lib/studentTurnLatch.ts) so it can be tested:
           * a committed turn MUST leave through `endStudentSpeech`, the only thing that clears the
           * playback mute. Closing the bracket directly ended the turn with the mute still latched,
           * and every chunk of the model's answer was discarded — Aria heard the student, replied,
           * and nothing came out of the speakers for the rest of the session.
           */
          const action = turnCloseAction({
            activityOpen: activityOpenRef.current,
            studentSpeaking: studentSpeakingRef.current,
            lastVoiceHeardAt: lastVoiceHeardAtRef.current,
            now: nowMs,
            endOfUtteranceMs: END_OF_UTTERANCE_MS,
          });
          if (action !== "none") {
            lastVoiceHeardAtRef.current = 0;
            if (action === "end-student-speech") endStudentSpeechRef.current();
            else closeActivityRef.current();
          }
        }

        const bufferEndedAt = performance.now();
        const windows = Math.max(1, Math.floor(pcm.length / ANALYSIS_FRAME));
        for (let index = 0; index < windows; index += 1) {
          const start = index * ANALYSIS_FRAME;
          const window = pcm.subarray(start, start + ANALYSIS_FRAME);
          if (window.length < ANALYSIS_FRAME) break;
          const at = bufferEndedAt - (windows - 1 - index) * ANALYSIS_FRAME_MS;
          gate.push(analyzeFrame(window, INPUT_SAMPLE_RATE), at);
        }
      };

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);
    },
    [ensureGate],
  );

  const start = useCallback(async () => {
    if (sessionRef.current || connectingRef.current) return;
    connectingRef.current = true;
    endedRef.current = false;
    /*
     * Which connect attempt this is.
     *
     * `start()` awaits a microphone and a token before it dials, and a `stop()` during those awaits
     * used to be invisible to it: teardown cleared the refs, the in-flight attempt carried on, and
     * a socket opened that nothing owned. The ADHD check-in does exactly that pair — stop, then
     * start one tick later to change persona — so on a slow network it reconnected into a session
     * the app had already abandoned. Gemini looked disconnected and resume never took.
     *
     * Locally the awaits resolve in a few milliseconds and the window never opens, which is why
     * this only ever appeared once deployed.
     */
    const attempt = ++connectAttemptRef.current;
    const superseded = () => attempt !== connectAttemptRef.current || endedRef.current;
    setErrorMessage(null);
    setStatus("connecting");

    const tokenPromise = fetch("/api/gemini-live-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: optionsRef.current.topic,
        beatContext: optionsRef.current.getBeatContext(),
        lessonContext: optionsRef.current.getLessonContext?.() ?? "",
        documentContext: optionsRef.current.getDocumentContext?.() ?? "",
        mood: optionsRef.current.mood ?? "",
        adhdMode: optionsRef.current.adhdMode === true,
        checkinMode: optionsRef.current.checkinMode === true,
        designMode: optionsRef.current.designMode === true,
        blindMode: optionsRef.current.blindMode === true,
        sourceKind: optionsRef.current.sourceKind ?? "topic",
        studentName: optionsRef.current.studentName ?? "",
        examMode: optionsRef.current.examMode === true,
        examQuestions: optionsRef.current.examMode ? optionsRef.current.examQuestions ?? [] : undefined,
      }),
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token) throw new Error(data.error ?? "Could not start Gemini Live.");
      return data as { token: string; model: string; instructions: string };
    });

    // Microphone permission is OPTIONAL for connection. Token minting and the Live handshake must
    // not wait behind a permission dialog: a denied or unavailable mic still gets a fully live text
    // conversation, and the student can retry voice later without replacing the session.
    const micPromise: Promise<MediaStream | null> = navigator.mediaDevices?.getUserMedia
      ? navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        }).catch(() => null)
      : Promise.resolve(null);

    let sessionData: { token: string; model: string; instructions: string };
    try {
      sessionData = await tokenPromise;
    } catch (error) {
      void micPromise.then((stream) => stream?.getTracks().forEach((track) => track.stop()));
      setErrorMessage(error instanceof Error ? error.message : "Could not start Gemini Live.");
      setStatus("error");
      connectingRef.current = false;
      return;
    }
    try {
      // The VAD sensitivity and activity-handling enums are gone with the server-side detection they
      // configured; the client decides now. See `realtimeInputConfig` below.
      const { GoogleGenAI, Modality, ThinkingLevel } = await import("@google/genai");
      const client = new GoogleGenAI({
        apiKey: sessionData.token,
        httpOptions: { apiVersion: "v1alpha" },
      });
      const builtInDeclarations = optionsRef.current.examMode
        ? []
        // A check-in gets exactly one tool: the way back. No show_board, because the session has no
        // lesson content to draw and offering the board invites her to start teaching; no
        // pause_lecture, because the lecture is already paused and that is the whole premise.
        : optionsRef.current.checkinMode
          ? [RESUME_LECTURE_TOOL]
          : optionsRef.current.lectureControlTools
            ? [SHOW_BOARD_TOOL, PAUSE_LECTURE_TOOL, RESUME_LECTURE_TOOL]
            : [SHOW_BOARD_TOOL];
      // Custom tools are deliberately withheld from a check-in. A caller that makes Gemini the
      // orchestrator of the app (the voice-first mode) hands over navigation and lecture-control
      // tools; handing those to the check-in persona would give her ways out of the conversation
      // that bypass the learner agreeing to come back, which is the one thing it exists to require.
      const functionDeclarations = optionsRef.current.checkinMode
        ? builtInDeclarations
        : [...builtInDeclarations, ...(optionsRef.current.customTools ?? [])];

      // A teardown during the mic/token awaits means this attempt is stale: dialling now would open
      // a socket nothing is holding.
      if (superseded()) {
        void micPromise.then((stream) => stream?.getTracks().forEach((track) => track.stop()));
        connectingRef.current = false;
        return;
      }

      const session = (await client.live.connect({
        model: sessionData.model,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: optionsRef.current.voiceName ?? "Kore" } },
          },
          systemInstruction: {
            parts: [{ text: optionsRef.current.systemInstruction ?? sessionData.instructions }],
          },
          /*
           * MANUAL ACTIVITY DETECTION. The client owns the turn boundaries.
           *
           * The server's VAD is a speech detector, and a good one — which is precisely the problem.
           * Every noise complaint here was speech: the neighbour's conversation, the TV, someone
           * asking a third party a question. No sensitivity setting rejects those, because they are
           * genuinely voices; only the WORDS distinguish them, and the server does not gate on
           * words. Its most eager setting (`START_SENSITIVITY_HIGH` with
           * `START_OF_ACTIVITY_INTERRUPTS`) additionally fired on fans and keyboards.
           *
           * So detection moves to the client, where `lib/interruptionGate.ts` can combine spectral
           * shape, duration and transcript before committing. `activityStart`/`activityEnd` are
           * sent from the gate's decisions instead. `audioStreamEnd` is not used in this mode.
           */
          realtimeInputConfig: {
            automaticActivityDetection: { disabled: true },
          },
          tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined,
        },
        callbacks: {
          // Do not publish "live" here. The callback can run before connect() resolves, and an
          // effect responding to it can send the proactive opening while sessionRef is still null.
          onopen: () => undefined,
          onmessage: (message: GeminiServerMessage) => handleServerMessage(message),
          onerror: (event: { message?: string }) => {
            if (endedRef.current) return;
            // Same recovery path as a close: a transport error on a long-running session is the
            // thing most worth surviving, since the student is mid-conversation when it lands.
            const recovering = scheduleReconnect();
            setErrorMessage(recovering ? null : event.message ?? "Gemini Live connection error.");
            teardown("error");
          },
          /**
           * REPORT THE SERVER'S REASON, not just the fact of a close.
           *
           * This said "Gemini Live disconnected." for every close, which is the one thing the user
           * can already see. The actual cause arrives right here in `reason` — a policy close
           * (code 1008) carries text like "Your project has been denied access", which is
           * diagnosable in one read; "disconnected" sends you looking through the client for a bug
           * that is not there. Codes 1000/1005 are ordinary end-of-session closes and have nothing
           * worth reporting.
           */
          onclose: (event?: { code?: number; reason?: string }) => {
            if (endedRef.current) return;
            const reason = event?.reason?.trim();
            const clean = event?.code === 1000 || event?.code === 1005;

            /*
             * Try to come back before reporting a failure.
             *
             * A dropped socket used to end the session outright, which is why a lesson build —
             * four to six minutes, longer than a Live session reliably lasts — kept leaving the
             * student with a dead microphone. The teardown still happens either way; what is new
             * is that an `alwaysOn` session dials again afterwards instead of staying dead.
             *
             * The message is chosen by whether recovery is actually coming: promising a
             * reconnection that will not happen is worse than the blunt error it replaced.
             */
            const recovering = scheduleReconnect(event?.code);
            setErrorMessage(
              recovering
                ? null
                : reason && !clean
                  ? `Gemini Live disconnected: ${reason}`
                  : "Gemini Live disconnected.",
            );
            teardown("error");
          },
        },
      })) as GeminiSession;

      /*
       * And again after the handshake. `client.live.connect` resolves over the network too, so a
       * teardown can land between the check above and this line — attaching here would resurrect a
       * session the app has already torn down, and the next stop() would not know about it.
       */
      if (superseded()) {
        try {
          session.close();
        } catch {
          // Already closing.
        }
        void micPromise.then((stream) => stream?.getTracks().forEach((track) => track.stop()));
        connectingRef.current = false;
        return;
      }

      sessionRef.current = session;
      connectingRef.current = false;
      setStatus("live");
      // Attach voice when permission resolves, independently of the already-live text session.
      void micPromise.then(async (stream) => {
        if (!stream) {
          if (sessionRef.current === session && !endedRef.current) {
            micIntentRef.current?.set(false);
            setMuted(true);
            setMicAvailable(false);
          }
          return;
        }
        if (sessionRef.current !== session || endedRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        micStreamRef.current = stream;
        try {
          await startMicrophone(stream, session);
          setMicAvailable(true);
        } catch {
          stream.getTracks().forEach((track) => track.stop());
          micStreamRef.current = null;
          micIntentRef.current?.set(false);
          setMuted(true);
          setMicAvailable(false);
        }
      });
      /*
       * A working connection clears the recovery budget.
       *
       * Without this the counter only ever climbs, so a session that dropped four times over an
       * hour — recovering fully each time — would refuse the fifth. The budget is meant to stop a
       * hopeless retry loop against a refusing server, not to ration a long healthy session.
       */
      reconnectCountRef.current = 0;
      setReconnecting(false);

      if (!optionsRef.current.alwaysOn) {
        resetIdleTimer();
        const cap = optionsRef.current.examMode ? EXAM_MAX_SESSION_MS : MAX_SESSION_MS;
        maxTimerRef.current = setTimeout(() => teardown("timeout"), cap);
      }
      /*
       * A check-in must OPEN the conversation, never wait to be spoken to.
       *
       * The learner arrived here by disengaging; a silent overlay waiting for them to talk first is
       * the same dead air they were already skipping through, and they will simply sit in it. Aria
       * speaks the moment the socket is up, exactly as she does for an oral exam.
       */
      if (optionsRef.current.checkinMode) {
        markTutorActive();
        session.sendRealtimeInput({
          text: "The lecture is paused and you are with the student now. Greet them warmly and ask how they're doing — one or two sentences, nothing about the lesson.",
        });
      }
      if (optionsRef.current.examMode) {
        markTutorActive();
        session.sendRealtimeInput({
          text: "Start the oral exam now. Briefly greet the student, then ask question 1 exactly once.",
        });
      }
    } catch (error) {
      void micPromise.then((stream) => stream?.getTracks().forEach((track) => track.stop()));
      setErrorMessage(error instanceof Error ? error.message : "Gemini Live connection failed.");
      teardown("error");
    }
  }, [handleServerMessage, markTutorActive, resetIdleTimer, scheduleReconnect, startMicrophone, teardown]);

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
      /*
       * `audioStreamEnd` is not sent here any more: it is the automatic-VAD way to flush cached
       * audio, and this session runs with automatic detection disabled. `endStudentSpeech` already
       * closes the turn with `activityEnd`, which is the manual-mode equivalent.
       */
      gateRef.current?.reset();
      endStudentSpeech();
    } else if (audioContextRef.current?.state === "suspended") {
      void audioContextRef.current.resume().catch(() => setStatus("blocked"));
    }
  }, [endStudentSpeech]);

  /** Retry microphone capture for an already-live text session. */
  const requestMicrophone = useCallback(async (): Promise<boolean> => {
    const session = sessionRef.current;
    if (!session || !navigator.mediaDevices?.getUserMedia) {
      setMicAvailable(false);
      return false;
    }
    const existing = micStreamRef.current?.getAudioTracks()[0];
    if (existing) {
      setMicEnabled(true);
      setMicAvailable(true);
      return true;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (sessionRef.current !== session || endedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      micIntentRef.current?.set(true);
      micStreamRef.current = stream;
      await startMicrophone(stream, session);
      setMicAvailable(true);
      return true;
    } catch {
      micIntentRef.current?.set(false);
      setMuted(true);
      setMicAvailable(false);
      return false;
    }
  }, [setMicEnabled, startMicrophone]);

  /**
   * Silence (or restore) the tutor's voice without touching the session or the microphone.
   *
   * Muting also stops whatever is playing right now — a mute that waits for the current sentence to
   * finish is not a mute.
   */
  const setOutputMutedPublic = useCallback((next: boolean) => {
    outputMutedRef.current = next;
    setOutputMuted(next);
    if (next) {
      suppressCurrentTurnRef.current = true;
      stopPlayback();
    }
  }, [stopPlayback]);

  const toggleMute = useCallback(() => {
    const track = micStreamRef.current?.getAudioTracks()[0];
    // While connecting, toggle the queued intent rather than doing nothing because the physical
    // track has not arrived yet. This keeps the mute button honest in every connection phase.
    const currentlyEnabled = track?.enabled ?? micIntentRef.current?.get() ?? false;
    setMicEnabled(!currentlyEnabled);
  }, [setMicEnabled]);

  /*
   * Published for the close handler, which is constructed before `start` exists.
   *
   * In an effect rather than during render: writing a ref while rendering is what React forbids,
   * and nothing here needs it sooner. Every reconnect goes through a timer of at least a second,
   * so the ref is always populated long before it is read.
   */
  useEffect(() => {
    startRef.current = start;
  }, [start]);

  const say = useCallback(
    (prompt: string) => {
      if (!sessionRef.current || !prompt.trim()) return;
      promptedTurnRef.current = true;
      suppressCurrentTurnRef.current = false;
      contextOnlyTurnRef.current = false;
      markTutorActive();
      sessionRef.current.sendRealtimeInput({ text: prompt.trim() });
    },
    [markTutorActive],
  );

  /**
   * Send a typed message as a genuine student turn.
   *
   * Not `addContext`, which explicitly instructs Gemini NOT to reply — that is for background facts,
   * so routing typed chat through it produced silence and looked like the box was broken. This is
   * the same conversation as the voice: one session, one history, so a question typed while Aria is
   * speaking lands in context exactly as if it had been spoken.
   */
  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!sessionRef.current || !trimmed) return;
      // A typed turn interrupts, like speaking would: whatever is playing is abandoned.
      stopPlayback();
      /*
       * Abandon any spoken turn still in progress before sending text.
       *
       * If the student starts talking and then types instead, the gate may be holding an activity
       * bracket open. Sending the typed turn inside that bracket leaves a spoken turn that is never
       * closed, and the server rejects the mismatch — a live probe returns `1007 Precondition check
       * failed` and drops the socket.
       */
      gateRef.current?.reset();
      closeActivityRef.current();
      promptedTurnRef.current = true;
      suppressCurrentTurnRef.current = false;
      contextOnlyTurnRef.current = false;
      markTutorActive();
      optionsRef.current.onTranscript?.("student", trimmed, true);
      sessionRef.current.sendRealtimeInput({ text: trimmed });
    },
    [markTutorActive, stopPlayback],
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
    micAvailable,
    errorMessage,
    start,
    stop,
    toggleMute,
    setMicEnabled,
    requestMicrophone,
    outputMuted,
    setOutputMuted: setOutputMutedPublic,
    /** True while a dropped session is waiting to dial again — distinct from a hard error. */
    reconnecting,
    sendText,
    say,
    addContext,
    silence,
    isSpeaking,
  };
}
