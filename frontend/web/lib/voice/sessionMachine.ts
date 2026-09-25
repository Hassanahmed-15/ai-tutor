/** Authoritative, model-agnostic lifecycle for every Arya voice surface. */
export type VoiceSessionState =
  | "IDLE"
  | "LISTENING"
  | "USER_SPEAKING"
  | "PROCESSING"
  | "TUTOR_SPEAKING"
  | "POSSIBLE_INTERRUPTION"
  | "CONFIRMED_INTERRUPTION"
  | "FALSE_INTERRUPTION"
  | "PAUSED"
  | "ERROR"
  | "RECONNECTING";

export type VoiceSurface = "normal" | "pdf" | "chatbot" | "planning" | "design" | "oral-test" | "shared";

export type VoiceConnectionState = "closed" | "connecting" | "open" | "recovering" | "failed";

export interface VoiceLatency {
  onsetMs?: number;
  commitMs?: number;
  endpointMs?: number;
  firstResponseAudioMs?: number;
}

export interface VoiceSessionSnapshot {
  sessionId: string;
  surface: VoiceSurface;
  state: VoiceSessionState;
  connection: VoiceConnectionState;
  micActive: boolean;
  muted: boolean;
  tutorAudible: boolean;
  turnId: number;
  playbackGeneration: number;
  reason: string;
  interruptionConfidence: number;
  speechConfidence: number;
  vadProbability: number | null;
  transcript: string;
  latency: VoiceLatency;
  updatedAt: number;
}

export type VoiceSessionEvent =
  | { type: "START"; at: number; eventId?: string }
  | { type: "CONNECTED"; at: number; eventId?: string }
  | { type: "MIC_ACTIVE"; at: number; active: boolean; eventId?: string }
  | { type: "MUTE"; at: number; muted: boolean; eventId?: string }
  | { type: "SPEECH_CANDIDATE"; at: number; confidence: number; vadProbability: number | null; reason: string; eventId?: string }
  | { type: "USER_TURN_OPEN"; at: number; reason: string; eventId?: string }
  | { type: "INTERRUPTION_CONFIRMED"; at: number; confidence: number; reason: string; eventId?: string }
  | { type: "INTERRUPTION_REJECTED"; at: number; reason: string; eventId?: string }
  | { type: "RESTORE_TUTOR"; at: number; reason: string; eventId?: string }
  | { type: "TRANSCRIPT"; at: number; text: string; eventId?: string }
  | { type: "USER_TURN_END"; at: number; reason: string; latencyMs?: number; eventId?: string }
  | { type: "TUTOR_AUDIO_START"; at: number; generation: number; latencyMs?: number; eventId?: string }
  | { type: "TUTOR_AUDIO_END"; at: number; generation: number; eventId?: string }
  | { type: "PAUSE"; at: number; reason: string; eventId?: string }
  | { type: "RESUME"; at: number; reason: string; eventId?: string }
  | { type: "DISCONNECTED"; at: number; reason: string; eventId?: string }
  | { type: "RECONNECTED"; at: number; eventId?: string }
  | { type: "FAIL"; at: number; reason: string; eventId?: string }
  | { type: "STOP"; at: number; reason: string; eventId?: string }
  | { type: "RESET"; at: number; eventId?: string };

export interface VoiceTransition {
  index: number;
  at: number;
  from: VoiceSessionState;
  to: VoiceSessionState;
  event: VoiceSessionEvent["type"];
  reason: string;
}

type Listener = (snapshot: VoiceSessionSnapshot, transition: VoiceTransition) => void;

const allowed: Record<VoiceSessionState, Set<VoiceSessionState>> = {
  IDLE: new Set(["IDLE", "LISTENING", "RECONNECTING", "ERROR"]),
  LISTENING: new Set(["LISTENING", "USER_SPEAKING", "TUTOR_SPEAKING", "PAUSED", "RECONNECTING", "ERROR", "IDLE"]),
  USER_SPEAKING: new Set(["USER_SPEAKING", "PROCESSING", "FALSE_INTERRUPTION", "PAUSED", "RECONNECTING", "ERROR", "IDLE"]),
  PROCESSING: new Set(["PROCESSING", "TUTOR_SPEAKING", "LISTENING", "PAUSED", "RECONNECTING", "ERROR", "IDLE"]),
  TUTOR_SPEAKING: new Set(["TUTOR_SPEAKING", "POSSIBLE_INTERRUPTION", "PAUSED", "LISTENING", "RECONNECTING", "ERROR", "IDLE"]),
  POSSIBLE_INTERRUPTION: new Set(["POSSIBLE_INTERRUPTION", "CONFIRMED_INTERRUPTION", "FALSE_INTERRUPTION", "TUTOR_SPEAKING", "PAUSED", "RECONNECTING", "ERROR", "IDLE"]),
  CONFIRMED_INTERRUPTION: new Set(["CONFIRMED_INTERRUPTION", "USER_SPEAKING", "PROCESSING", "PAUSED", "RECONNECTING", "ERROR", "IDLE"]),
  FALSE_INTERRUPTION: new Set(["FALSE_INTERRUPTION", "TUTOR_SPEAKING", "LISTENING", "PAUSED", "RECONNECTING", "ERROR", "IDLE"]),
  PAUSED: new Set(["PAUSED", "LISTENING", "TUTOR_SPEAKING", "RECONNECTING", "ERROR", "IDLE"]),
  ERROR: new Set(["ERROR", "RECONNECTING", "IDLE"]),
  RECONNECTING: new Set(["RECONNECTING", "LISTENING", "PAUSED", "ERROR", "IDLE"]),
};

function makeId(): string {
  return `voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class VoiceSessionMachine {
  private snapshot: VoiceSessionSnapshot;
  private readonly listeners = new Set<Listener>();
  private readonly seenEventIds = new Set<string>();
  private readonly transitions: VoiceTransition[] = [];
  private resumeAfterReconnect: VoiceSessionState = "LISTENING";

  constructor(surface: VoiceSurface = "shared", sessionId = makeId()) {
    this.snapshot = {
      sessionId, surface, state: "IDLE", connection: "closed", micActive: false, muted: false,
      tutorAudible: false, turnId: 0, playbackGeneration: 0, reason: "created",
      interruptionConfidence: 0, speechConfidence: 0, vadProbability: null, transcript: "", latency: {}, updatedAt: 0,
    };
  }

  get value(): VoiceSessionSnapshot { return { ...this.snapshot, latency: { ...this.snapshot.latency } }; }
  get history(): VoiceTransition[] { return [...this.transitions]; }
  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  dispatch(event: VoiceSessionEvent): VoiceSessionSnapshot {
    if (event.eventId && this.seenEventIds.has(event.eventId)) return this.value;
    if (event.eventId) {
      this.seenEventIds.add(event.eventId);
      if (this.seenEventIds.size > 512) this.seenEventIds.delete(this.seenEventIds.values().next().value as string);
    }
    const from = this.snapshot.state;
    let to = from;
    let reason = "reason" in event ? event.reason : event.type.toLowerCase();
    const patch: Partial<VoiceSessionSnapshot> = {};
    switch (event.type) {
      case "START":
        if (from === "ERROR") to = "RECONNECTING";
        patch.connection = "connecting";
        break;
      case "CONNECTED": to = "LISTENING"; patch.connection = "open"; break;
      case "MIC_ACTIVE": patch.micActive = event.active; break;
      case "MUTE": patch.muted = event.muted; break;
      case "SPEECH_CANDIDATE":
        patch.speechConfidence = event.confidence; patch.vadProbability = event.vadProbability;
        if (from === "TUTOR_SPEAKING") to = "POSSIBLE_INTERRUPTION";
        break;
      case "USER_TURN_OPEN": to = "USER_SPEAKING"; patch.turnId = this.snapshot.turnId + 1; break;
      case "INTERRUPTION_CONFIRMED": to = "CONFIRMED_INTERRUPTION"; patch.interruptionConfidence = event.confidence; patch.tutorAudible = false; break;
      case "INTERRUPTION_REJECTED":
        if (from === "POSSIBLE_INTERRUPTION" || from === "USER_SPEAKING" || from === "CONFIRMED_INTERRUPTION") to = "FALSE_INTERRUPTION";
        patch.interruptionConfidence = 0; break;
      case "RESTORE_TUTOR":
        if (from === "FALSE_INTERRUPTION") to = this.snapshot.tutorAudible ? "TUTOR_SPEAKING" : "LISTENING";
        break;
      case "TRANSCRIPT": patch.transcript = event.text; break;
      case "USER_TURN_END": to = "PROCESSING"; patch.latency = { ...this.snapshot.latency, endpointMs: event.latencyMs }; break;
      case "TUTOR_AUDIO_START":
        to = "TUTOR_SPEAKING"; patch.tutorAudible = true; patch.playbackGeneration = event.generation;
        patch.latency = { ...this.snapshot.latency, firstResponseAudioMs: event.latencyMs };
        break;
      case "TUTOR_AUDIO_END":
        if (event.generation !== this.snapshot.playbackGeneration || !["TUTOR_SPEAKING", "POSSIBLE_INTERRUPTION", "FALSE_INTERRUPTION"].includes(from)) return this.value;
        to = "LISTENING"; patch.tutorAudible = false; break;
      case "PAUSE": to = "PAUSED"; patch.tutorAudible = false; break;
      case "RESUME": to = this.snapshot.tutorAudible ? "TUTOR_SPEAKING" : "LISTENING"; break;
      case "DISCONNECTED":
        this.resumeAfterReconnect = from === "PAUSED" ? "PAUSED" : "LISTENING";
        to = "RECONNECTING"; patch.connection = "recovering"; patch.tutorAudible = false; break;
      case "RECONNECTED": to = this.resumeAfterReconnect; patch.connection = "open"; break;
      case "FAIL": to = "ERROR"; patch.connection = "failed"; patch.tutorAudible = false; break;
      case "STOP": to = "IDLE"; patch.connection = "closed"; patch.micActive = false; patch.muted = false; patch.tutorAudible = false; break;
      case "RESET": to = "IDLE"; patch.connection = "closed"; patch.micActive = false; patch.muted = false; patch.tutorAudible = false; patch.transcript = ""; break;
    }
    if (!allowed[from].has(to)) {
      const attempted = to;
      to = "ERROR";
      reason = `illegal transition ${from} → ${attempted} from ${event.type}`;
      patch.connection = "failed";
    }
    this.snapshot = { ...this.snapshot, ...patch, state: to, reason, updatedAt: event.at };
    const transition = { index: this.transitions.length, at: event.at, from, to, event: event.type, reason };
    this.transitions.push(transition);
    if (this.transitions.length > 500) this.transitions.shift();
    for (const listener of this.listeners) listener(this.value, transition);
    return this.value;
  }
}
