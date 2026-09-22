/**
 * THE STACK, ASSEMBLED: detector → endpointer → arbiter, with one clock and one log.
 *
 * This is what both the live app and the scenario harness drive, so what the tests measure is what
 * the microphone gets. It knows nothing about the DOM: frames come in, callbacks go out.
 */
import { concatFrames } from "./acoustics";
import { looksUnfinished } from "./addressing";
import { TurnArbiter, type ArbiterCallbacks, type ArbiterConfig, type ArbiterProfile, type TurnState, type TutorStatus } from "./arbiter";
import { Endpointer, type EndpointerConfig, type EndpointEvent, type EndpointState } from "./endpointer";
import { EventLog } from "./events";
import type { SpeakerVerifier } from "./speakerProfile";
import { SpeechDetector, type DetectorConfig, type DetectorVerdict } from "./speechDetector";

export interface PipelineOptions {
  profile: ArbiterProfile;
  verifier?: SpeakerVerifier;
  wakeNames?: string[];
  detector?: Partial<DetectorConfig>;
  endpointer?: Partial<EndpointerConfig>;
  arbiter?: Partial<ArbiterConfig>;
  callbacks?: ArbiterCallbacks;
  log?: EventLog;
}

export class TurnPipeline {
  readonly log: EventLog;
  readonly detector: SpeechDetector;
  readonly endpointer: Endpointer;
  readonly arbiter: TurnArbiter;
  private previousFrame: Float32Array | null = null;
  private tutor: TutorStatus = { speaking: false, expectingAnswer: false };
  private tutorLastAudibleAt = -Infinity;
  private lastSpeech = false;
  private lastVerdict: DetectorVerdict | null = null;

  constructor(options: PipelineOptions) {
    this.log = options.log ?? new EventLog();
    this.detector = new SpeechDetector(options.detector);
    const callbacks = options.callbacks ?? {};
    this.arbiter = new TurnArbiter({
      profile: options.profile,
      config: options.arbiter,
      verifier: options.verifier,
      wakeNames: options.wakeNames,
      callbacks: {
        ...callbacks,
        onDuck: (gain, reason) => { this.log.log("tutor", "duck", this.now, reason, "warn", { gain }); callbacks.onDuck?.(gain, reason); },
        onRestore: (reason) => { this.log.log("tutor", "restore", this.now, reason, "ok"); callbacks.onRestore?.(reason); },
        onPauseTutor: (reason) => { this.log.log("tutor", "pause", this.now, reason, "bad"); callbacks.onPauseTutor?.(reason); },
        onResumeTutor: (reason) => { this.log.log("tutor", "resume", this.now, reason, "ok"); callbacks.onResumeTutor?.(reason); },
        onOpenTurn: (preroll, reason) => { this.log.log("turn", "open", this.now, `${reason} (+${preroll.length} pre-roll frames)`, "ok"); callbacks.onOpenTurn?.(preroll, reason); },
        onEndTurn: (info) => { this.log.log("turn", "end", this.now, `${info.reason} — "${info.transcript.slice(0, 60)}" (${info.durationMs} ms)`, "ok"); callbacks.onEndTurn?.(info); },
        onDiscard: (reason) => { this.log.log("turn", "discard", this.now, reason, "warn"); callbacks.onDiscard?.(reason); },
        onState: (from, to, reason, at) => { this.log.log("turn", "state", at, `${from} → ${to}: ${reason}`, to === "committed" ? "bad" : to === "listening" ? "ok" : "info", { from, to }); callbacks.onState?.(from, to, reason, at); },
        onWatchdog: (kind, detail, at) => { this.log.log("watchdog", kind, at, detail, "bad"); callbacks.onWatchdog?.(kind, detail, at); },
      },
    });
    this.endpointer = new Endpointer((event) => this.onEndpoint(event), options.endpointer);
  }

  private now = 0;

  get state(): TurnState {
    return this.arbiter.getState();
  }

  get endpointState(): EndpointState {
    return this.endpointer.getState();
  }

  get detectorVerdict(): DetectorVerdict | null {
    return this.lastVerdict;
  }

  setTutor(status: TutorStatus, now: number): void {
    if (this.tutor.speaking && !status.speaking) this.tutorLastAudibleAt = now;
    if (this.tutor.speaking !== status.speaking) this.log.log("tutor", status.speaking ? "audible" : "silent", now, status.speakingAs ?? "");
    this.tutor = status;
    this.arbiter.setTutor(status);
  }

  setTopicWords(words: Iterable<string>): void {
    this.arbiter.setTopicWords(words);
  }

  /** One 20 ms frame of 16 kHz mono, and Silero's probability for it when available. */
  push(pcm: Float32Array, now: number, vadProbability: number | null = null): DetectorVerdict {
    this.now = now;
    const window = this.previousFrame ? concatFrames(this.previousFrame, pcm) : pcm;
    this.previousFrame = pcm;
    const verdict = this.detector.judge({
      window,
      vadProbability,
      tutorSpeaking: this.tutor.speaking,
      msSinceTutorAudible: now - this.tutorLastAudibleAt,
    });
    this.lastVerdict = verdict;
    if (verdict.speech !== this.lastSpeech) {
      this.log.log("vad", verdict.speech ? "speech" : "quiet", now, verdict.reason, verdict.speech ? "ok" : "info", { p: +verdict.probability.toFixed(2), source: verdict.source });
      this.lastSpeech = verdict.speech;
    }
    this.endpointer.push(pcm, verdict.speech, now);
    this.arbiter.onFrame(pcm, verdict, now);
    this.arbiter.tick(now);
    return verdict;
  }

  provideTranscript(text: string, final: boolean, now: number): void {
    this.now = now;
    this.log.log("words", final ? "final" : "interim", now, text);
    // An unfinished clause promises more words; let the endpointer tolerate a longer pause.
    this.endpointer.setContinuationHint(!final || looksUnfinished(text));
    this.arbiter.provideTranscript(text, final, now);
    const verdict = this.arbiter.getLastVerdict();
    if (verdict) this.log.log("words", verdict.addressed ? "for-tutor" : "not-for-tutor", now, `${verdict.reason} (${verdict.score.toFixed(2)})`, verdict.addressed ? "ok" : "warn");
  }

  responseStarted(now: number): void {
    this.now = now;
    this.arbiter.responseStarted(now);
  }

  /** Call when frames are NOT arriving too, so the stall watchdog can fire. */
  tick(now: number): void {
    this.now = now;
    this.arbiter.tick(now);
  }

  private onEndpoint(event: EndpointEvent): void {
    const detail =
      event.type === "start" ? `utterance confirmed (started ${event.startedAt} ms, ${event.preroll.length} frames handed over)`
      : event.type === "end" ? `${event.reason} after ${event.durationMs} ms`
      : event.type === "pause" ? `pause after ${event.spokenMs} ms of speech`
      : event.type === "resume" ? `resumed after ${event.pausedMs} ms`
      : event.type === "abort" ? event.reason
      : "";
    this.log.log("endpoint", event.type, event.at, detail, event.type === "start" ? "ok" : event.type === "abort" ? "warn" : "info");
    this.arbiter.onEndpoint(event, event.at);
  }

  reset(now = 0): void {
    this.previousFrame = null;
    this.lastSpeech = false;
    this.detector.reset();
    this.endpointer.reset();
    this.arbiter.reset(now);
  }
}
