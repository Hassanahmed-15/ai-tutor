/** Compatibility facade for the app: every voice surface delegates to the same turn pipeline. */
import { TurnPipeline } from "./runtime/pipeline";
import { EventLog, type LabEvent } from "./runtime/events";
import type { SpeakerVerifier } from "./runtime/speakerProfile";

/**
 * How much evidence a turn needs before it reaches the model.
 *
 *   lecture       the tutor is narrating; interrupting is expensive, so a turn needs positive
 *                 evidence (her name, a command, a question about the board).
 *   conversation  the tutor is idle but the surface has other purposes; a question or an answer
 *                 to a pending question counts.
 *   dedicated     the student opened a voice session on purpose and is looking at a microphone
 *                 that says it is listening. There is nothing to interrupt and no other reason
 *                 for them to be talking at it, so anything they say is for the tutor — "hello"
 *                 included. The acoustic and speaker layers still reject noise and other people;
 *                 only the WORDS test is relaxed, because in this surface it has nothing to
 *                 discriminate between.
 */
export type GateProfile = "lecture" | "conversation" | "dedicated";
export type GateStage = "idle" | "candidate" | "listening" | "committed" | "refractory";
export interface GateDecision { stage: GateStage; reason: string; detail: string; at: number; }
export interface SharedGateDiagnostics {
  stage: GateStage;
  endpointState: string;
  vadProbability: number | null;
  speechConfidence: number;
  vadSource: "silero" | "heuristic" | "none";
  reason: string;
  events: LabEvent[];
}
export interface SharedVoiceGateCallbacks {
  onListen?: (preroll: Float32Array[]) => void;
  onFrame?: (pcm: Float32Array) => void;
  onDuck?: (gain: number) => void;
  onRestore?: () => void;
  onBargeIn?: (reason: string) => void;
  onTurnEnd?: () => void;
  onDiscard?: (reason: string) => void;
  onDecision?: (decision: GateDecision) => void;
  onEvent?: (event: LabEvent) => void;
}
export interface SharedVoiceGateOptions {
  profile?: GateProfile;
  verifier?: SpeakerVerifier;
  callbacks?: SharedVoiceGateCallbacks;
  wakeNames?: string[];
  semanticPrefilter?: boolean;
}

function stageOf(state: string): GateStage {
  return state === "attending" ? "candidate" : state as GateStage;
}

export class SharedVoiceGate {
  readonly log = new EventLog();
  private readonly pipeline: TurnPipeline;
  private tutorSpeaking = false;
  private expectingAnswer = false;
  private speakingAs: "lecture" | "reply";
  private lastReason = "idle";
  private readonly onDecision?: (decision: GateDecision) => void;

  constructor(options: SharedVoiceGateOptions = {}) {
    const callbacks = options.callbacks ?? {};
    this.onDecision = callbacks.onDecision;
    this.speakingAs = (options.profile ?? "lecture") === "lecture" ? "lecture" : "reply";
    this.log.subscribe((event) => callbacks.onEvent?.(event));
    this.pipeline = new TurnPipeline({
      profile: options.profile ?? "lecture",
      verifier: options.verifier,
      wakeNames: options.wakeNames,
      log: this.log,
      arbiter: { requireAddressingBeforeOpen: options.semanticPrefilter === true },
      callbacks: {
        onDuck: (gain, reason) => { this.decide("candidate", "duck", reason); callbacks.onDuck?.(gain); },
        onRestore: (reason) => { this.decide("refractory", "restore", reason); callbacks.onRestore?.(); },
        onPauseTutor: (reason) => { this.decide("committed", "barge-in", reason); callbacks.onBargeIn?.(reason); },
        onOpenTurn: (preroll, reason) => { this.decide("listening", "listen", reason); callbacks.onListen?.(preroll); },
        onAudio: (pcm) => callbacks.onFrame?.(pcm),
        onEndTurn: ({ reason }) => { this.decide("refractory", "turn-end", reason); callbacks.onTurnEnd?.(); },
        onDiscard: (reason) => { this.decide("refractory", "discard", reason); callbacks.onDiscard?.(reason); },
      },
    });
  }

  setTutorSpeaking(speaking: boolean, now: number): void {
    this.tutorSpeaking = speaking;
    this.pipeline.setTutor({ speaking, expectingAnswer: this.expectingAnswer, speakingAs: this.speakingAs }, now);
  }
  setExpectingAnswer(expecting: boolean): void { this.expectingAnswer = expecting; }
  setTopicWords(words: Iterable<string>): void { this.pipeline.setTopicWords(words); }
  push(pcm: Float32Array, now: number, vadProbability: number | null = null): void {
    this.pipeline.setTutor({ speaking: this.tutorSpeaking, expectingAnswer: this.expectingAnswer, speakingAs: this.speakingAs }, now);
    const verdict = this.pipeline.push(pcm, now, vadProbability);
    if (verdict.speech) this.lastReason = verdict.reason;
  }
  provideTranscript(text: string, final: boolean, now: number): void { this.pipeline.provideTranscript(text, final, now); }
  responseStarted(now: number): void { this.pipeline.responseStarted(now); }
  tick(now: number): void { this.pipeline.tick(now); }
  reset(now = 0): void { this.pipeline.reset(now); }
  getStage(): GateStage { return stageOf(this.pipeline.state); }
  getDiagnostics(): SharedGateDiagnostics {
    const verdict = this.pipeline.detectorVerdict;
    return {
      stage: this.getStage(), endpointState: this.pipeline.endpointState,
      vadProbability: verdict?.probability ?? null, speechConfidence: verdict?.confidence ?? 0,
      vadSource: verdict?.source ?? "none", reason: verdict?.reason ?? this.lastReason,
      events: this.log.toJSON().slice(-200),
    };
  }
  private decide(stage: GateStage, reason: string, detail: string): void {
    this.lastReason = detail;
    const decision = { stage, reason, detail, at: performance.now() };
    this.log.log("turn", reason, decision.at, detail, reason === "barge-in" ? "bad" : "info");
    this.onDecision?.(decision);
  }
}
