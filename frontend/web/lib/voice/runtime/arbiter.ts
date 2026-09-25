/**
 * WHO HAS THE FLOOR — the turn arbiter, the policy at the centre of the new architecture.
 *
 * It takes three streams of evidence — the endpointer's edges, the speaker layer's "is this the
 * student", the words layer's "is this for the tutor" — plus the tutor's own state, and answers
 * the only questions that matter to the person in the room:
 *
 *   When the student starts speaking, pause the tutor at once.          → duck within armMs, pause on evidence
 *   Do not interrupt the student while they are speaking.               → nothing resumes until the endpointer ends
 *   When they finish, detect it reliably and respond.                   → end-of-turn from the endpointer, not a timer
 *   If they were not talking to the tutor, carry on as if nothing happened. → discard + restore
 *   Never get stuck.                                                      → watchdogs on every waiting state
 *
 * THE ASYMMETRY. Ducking is cheap and reversible, so it happens early (armMs of sustained speech).
 * Pausing the tutor is expensive — the lesson stops — so it needs POSITIVE evidence: the words are
 * for her (name, command, question about the board, second-person speech), or the voice is the
 * verified student's and has kept going. A neighbour's sentence, a fan, the TV, the tutor's own
 * echo: none of these carries positive evidence, so none of them stops her. While the tutor is
 * SILENT there is nothing to interrupt, and a confirmed utterance opens a turn immediately; the
 * words still decide whether the model gets to answer it.
 *
 * States:  idle → attending (onset seen, evaluating) → listening (turn open, audio flowing)
 *          → committed (tutor paused for the student) → processing (turn ended, reply awaited)
 *          → refractory (settled; hysteresis) → idle
 *
 * Every transition carries a reason. Pure and clock-injected.
 */
import { classifyAddressing, type AddressingVerdict } from "./addressing";
import type { VoiceFrameFeatures } from "./acoustics";
import type { EndpointEvent } from "./endpointer";
import { NoSpeakerVerifier, type SpeakerVerdict, type SpeakerVerifier } from "./speakerProfile";
import type { DetectorVerdict } from "./speechDetector";

export type ArbiterProfile = "lecture" | "conversation";
export type TurnState = "idle" | "attending" | "listening" | "committed" | "processing" | "refractory";

export interface ArbiterConfig {
  /** Hold all microphone audio locally until browser-side words establish that it is for Arya. */
  requireAddressingBeforeOpen: boolean;
  /** Sustained speech before the tutor is ducked. Cheap, so short. */
  armMs: number;
  duckGain: number;
  /** Verified student voice sustained this long while the tutor LECTURES stops her without words. */
  verifiedBargeMsLecture: number;
  /** …and while she is merely REPLYING (conversation), which is cheaper to interrupt. */
  verifiedBargeMsReply: number;
  /** An unverified voice that keeps talking over a REPLY for this long is given the benefit of the doubt. */
  unverifiedBargeMsReply: number;
  /** After a turn ends, how long the reply may take to start before the tutor is resumed anyway. */
  responseTimeoutMs: number;
  /** After a settled episode, new onsets are ignored this long — hysteresis. */
  refractoryMs: number;
  /** Voiced windows before an episode's speaker verdict is trusted. */
  minSpeakerWindows: number;
  /** While attending or listening, this long without any frame means the microphone has stalled. */
  micStallMs: number;
}

export const DEFAULT_ARBITER_CONFIG: ArbiterConfig = {
  requireAddressingBeforeOpen: false,
  armMs: 240,
  duckGain: 0.25,
  verifiedBargeMsLecture: 1000,
  verifiedBargeMsReply: 1000,
  unverifiedBargeMsReply: 1500,
  responseTimeoutMs: 8000,
  refractoryMs: 400,
  minSpeakerWindows: 5,
  micStallMs: 1500,
};

export interface TutorStatus {
  /** The tutor's audio is audible right now. */
  speaking: boolean;
  /** The tutor asked something and is waiting. */
  expectingAnswer: boolean;
  /** Speaking as a lecture (expensive to stop) or as a reply (cheap). Defaults to the profile. */
  speakingAs?: "lecture" | "reply";
}

export interface EndTurnInfo {
  transcript: string;
  durationMs: number;
  reason: string;
}

export interface ArbiterCallbacks {
  onDuck?: (gain: number, reason: string) => void;
  onRestore?: (reason: string) => void;
  /** Stop the tutor NOW. At most once per episode. */
  onPauseTutor?: (reason: string) => void;
  /** The tutor may carry on (an episode settled as not-for-us, or a reply never came). */
  onResumeTutor?: (reason: string) => void;
  /** A turn opened: send the pre-roll first, then every frame passed to onAudio. */
  onOpenTurn?: (preroll: Float32Array[], reason: string) => void;
  onAudio?: (pcm: Float32Array) => void;
  /** The turn is real and over: let the model answer. */
  onEndTurn?: (info: EndTurnInfo) => void;
  /** The turn was not for us: close it and suppress whatever comes back. */
  onDiscard?: (reason: string) => void;
  onState?: (from: TurnState, to: TurnState, reason: string, at: number) => void;
  onWatchdog?: (kind: "mic-stalled" | "response-timeout" | "max-utterance", detail: string, at: number) => void;
}

export interface ArbiterOptions {
  profile?: ArbiterProfile;
  config?: Partial<ArbiterConfig>;
  verifier?: SpeakerVerifier;
  wakeNames?: string[];
  callbacks?: ArbiterCallbacks;
}

export class TurnArbiter {
  readonly config: ArbiterConfig;
  readonly profile: ArbiterProfile;
  private readonly verifier: SpeakerVerifier;
  private readonly callbacks: ArbiterCallbacks;
  private readonly wakeNames?: string[];

  private state: TurnState = "idle";
  private tutor: TutorStatus = { speaking: false, expectingAnswer: false };
  private topicWords = new Set<string>();

  private attendingSince = 0;
  private lastFrameAt = -Infinity;
  private refractoryUntil = 0;
  private processingSince = 0;
  private ducked = false;
  private pausedTutor = false;

  private candidateAudio: Float32Array[] = [];
  private episodeFeatures: VoiceFrameFeatures[] = [];
  private episodeSpeechMs = 0;
  private speakerSum = 0;
  private speakerWindows = 0;
  private lastVerdict: AddressingVerdict | null = null;
  private lastTranscript = "";
  private addressedByWords = false;
  private negativeFinal = false;

  constructor(options: ArbiterOptions = {}) {
    this.config = { ...DEFAULT_ARBITER_CONFIG, ...options.config };
    this.profile = options.profile ?? "lecture";
    this.verifier = options.verifier ?? new NoSpeakerVerifier();
    this.callbacks = options.callbacks ?? {};
    this.wakeNames = options.wakeNames;
  }

  getState(): TurnState {
    return this.state;
  }

  getLastVerdict(): AddressingVerdict | null {
    return this.lastVerdict;
  }

  speakerVerdict(): SpeakerVerdict {
    if (!this.verifier.enrolled || this.speakerWindows < this.config.minSpeakerWindows) return "unknown";
    const mean = this.speakerSum / this.speakerWindows;
    if (mean >= 0.62) return "student";
    if (mean <= 0.42) return "other";
    return "unknown";
  }

  // --- Inputs ---------------------------------------------------------------------------------

  setTutor(status: TutorStatus): void {
    this.tutor = status;
  }

  setTopicWords(words: Iterable<string>): void {
    this.topicWords = new Set(words);
  }

  /** The tutor's reply to the last turn has begun: the wait is over. */
  responseStarted(now: number): void {
    if (this.state === "processing") this.transition("idle", "reply started", now);
  }

  /** Every frame, speech or not. Forwards audio when a turn is open and accumulates evidence. */
  onFrame(pcm: Float32Array, verdict: DetectorVerdict, now: number): void {
    const frameDelta = Number.isFinite(this.lastFrameAt) ? Math.max(0, Math.min(40, now - this.lastFrameAt)) : 20;
    this.lastFrameAt = now;
    if (this.state === "listening" || this.state === "committed") this.callbacks.onAudio?.(pcm);
    else if (this.state === "attending") {
      this.candidateAudio.push(pcm);
      // Bound a stalled transcriber to ~4 s of PCM; an accepted turn resolves long before that.
      if (this.candidateAudio.length > 200) this.candidateAudio.shift();
    }
    if (!verdict.speech) return;
    this.episodeSpeechMs += frameDelta;

    const features = verdict.features;
    if (features.f0 !== null && features.voicing >= 0.5 && this.verifier.enrolled) {
      this.speakerSum += this.verifier.match(features).similarity;
      this.speakerWindows += 1;
    }
    if (this.state === "attending" || this.state === "listening" || this.state === "committed") this.episodeFeatures.push(features);

    if (this.state !== "attending" && this.state !== "listening") return;
    const sustained = now - this.attendingSince;
    const who = this.speakerVerdict();

    if (this.tutor.speaking) {
      if (!this.ducked && sustained >= this.config.armMs && who !== "other") {
        this.ducked = true;
        this.callbacks.onDuck?.(this.config.duckGain, `sustained voice ${sustained} ms — ducking while the words arrive`);
      }
      if (who === "other" && this.ducked) {
        this.ducked = false;
        this.callbacks.onRestore?.("voice is not the student's");
      }
      if (this.negativeFinal) return;
      const replying = this.tutor.speakingAs === "reply" || (this.tutor.speakingAs === undefined && this.profile === "conversation");
      const verifiedNeed = replying ? this.config.verifiedBargeMsReply : this.config.verifiedBargeMsLecture;
      if (who === "student" && this.episodeSpeechMs >= verifiedNeed) {
        this.commit(now, `verified student voice for ${this.episodeSpeechMs} ms${this.lastVerdict ? "" : " with no transcript yet"}`);
        return;
      }
      if (replying && who === "unknown" && !this.verifier.enrolled && this.episodeSpeechMs >= this.config.unverifiedBargeMsReply && !this.lastVerdict) {
        this.commit(now, `unverified voice kept talking over the reply for ${this.episodeSpeechMs} ms`);
      }
    }
  }

  onEndpoint(event: EndpointEvent, now: number): void {
    switch (event.type) {
      case "onset":
        if (this.state === "refractory" && now < this.refractoryUntil) return;
        if (this.state === "refractory") this.transition("idle", "refractory over", now);
        if (this.state !== "idle") return;
        this.clearEpisode();
        this.attendingSince = now;
        this.transition("attending", "speech onset", now);
        return;
      case "start":
        if (this.state !== "attending") return;
        if (!this.tutor.speaking && !this.config.requireAddressingBeforeOpen) {
          // Nothing to interrupt: the turn opens now and the words decide what happens to it.
          this.open(now, event.preroll, "confirmed speech while the tutor is silent");
        } else if (this.addressedByWords) {
          this.open(now, event.preroll, "confirmed speech, words already addressed the tutor");
          this.commit(now, this.lastVerdict?.reason ?? "addressed");
        }
        return;
      case "pause":
      case "resume":
        return;
      case "abort":
        if (this.state === "attending") {
          this.restoreIfDucked("speech stopped before it could be judged");
          /*
           * A blip is not an episode. Settling it with the full refractory period meant that a
           * voice over a fan — which flickers, aborts once, then starts again 20 ms later — was
           * ignored for the next 400 ms, and the addressed words arrived with nobody attending.
           */
          this.settle(now, `ignored: ${event.reason}`, 40);
        } else if (this.state === "listening") {
          this.callbacks.onDiscard?.(`turn aborted: ${event.reason}`);
          this.restoreIfDucked(event.reason);
          this.settle(now, `discarded: ${event.reason}`);
        }
        return;
      case "end":
        if (event.reason === "max-utterance") this.callbacks.onWatchdog?.("max-utterance", `utterance ran ${event.durationMs} ms; ended`, now);
        this.endEpisode(now, event.durationMs, event.reason);
        return;
    }
  }

  /** Words from the transcriber. Interim text drives POSITIVE verdicts only; negatives wait for final text. */
  provideTranscript(text: string, final: boolean, now: number): void {
    if (this.state !== "attending" && this.state !== "listening" && this.state !== "committed") return;
    this.lastTranscript = text;
    let verdict = classifyAddressing(text, {
      expectingAnswer: this.tutor.expectingAnswer,
      tutorSpeaking: this.tutor.speaking,
      topicWords: this.topicWords,
      wakeNames: this.wakeNames,
    });
    if (verdict.addressed && this.speakerVerdict() === "other") {
      verdict = { addressed: false, score: verdict.score, reason: `${verdict.reason}, but the voice is not the student's` };
    }
    this.lastVerdict = verdict;

    if (verdict.addressed) {
      this.addressedByWords = true;
      this.negativeFinal = false;
      if (this.state === "attending") this.open(now, this.candidateAudio, `words: ${verdict.reason}`);
      if (this.state === "listening" && this.tutor.speaking) this.commit(now, `words: ${verdict.reason}`);
      return;
    }
    if (!final) return;
    this.negativeFinal = true;
    if (this.state === "attending") this.restoreIfDucked(`words: ${verdict.reason}`);
    else if (this.state === "listening" && this.tutor.speaking) {
      this.callbacks.onDiscard?.(`words: ${verdict.reason}`);
      this.restoreIfDucked(`words: ${verdict.reason}`);
      this.settle(now, `discarded: ${verdict.reason}`);
    }
  }

  /** Watchdogs. Call every frame and whenever frames are NOT arriving. */
  tick(now: number): void {
    if ((this.state === "attending" || this.state === "listening" || this.state === "committed") && now - this.lastFrameAt >= this.config.micStallMs) {
      this.callbacks.onWatchdog?.("mic-stalled", `no audio for ${Math.round(now - this.lastFrameAt)} ms`, now);
      if (this.state === "committed" || (this.state === "listening" && this.addressedByWords)) {
        // The student had the floor: deliver what we have rather than lose their question.
        this.endEpisode(now, now - this.attendingSince, "forced");
      } else {
        this.restoreIfDucked("microphone stalled");
        this.settle(now, "microphone stalled before the turn could be judged");
      }
      this.lastFrameAt = now;
      return;
    }
    if (this.state === "processing" && now - this.processingSince >= this.config.responseTimeoutMs) {
      this.callbacks.onWatchdog?.("response-timeout", `no reply for ${Math.round(now - this.processingSince)} ms`, now);
      if (this.pausedTutor) {
        this.pausedTutor = false;
        this.callbacks.onResumeTutor?.("no reply arrived — resuming");
      }
      this.transition("idle", "reply never came", now);
    }
  }

  reset(now = 0): void {
    this.restoreIfDucked("reset");
    this.clearEpisode();
    this.pausedTutor = false;
    this.transition("idle", "reset", now);
  }

  // --- Transitions ---------------------------------------------------------------------------

  private open(now: number, preroll: Float32Array[], reason: string): void {
    if (this.state !== "attending") return;
    const handed = [...preroll];
    this.candidateAudio = [];
    this.callbacks.onOpenTurn?.(handed, reason);
    this.transition("listening", reason, now);
  }

  private commit(now: number, reason: string): void {
    if (this.state === "committed") return;
    if (this.state === "attending") this.open(now, this.candidateAudio, reason);
    if (this.ducked) {
      this.ducked = false;
      this.callbacks.onRestore?.("pausing instead of ducking");
    }
    this.pausedTutor = true;
    this.callbacks.onPauseTutor?.(reason);
    this.transition("committed", `barge-in: ${reason}`, now);
  }

  private endEpisode(now: number, durationMs: number, endReason: string): void {
    const who = this.speakerVerdict();
    const finishTurn = (reason: string) => {
      for (const features of this.episodeFeatures) this.verifier.enrol(features);
      this.callbacks.onEndTurn?.({ transcript: this.lastTranscript, durationMs, reason });
      this.processingSince = now;
      this.transition("processing", reason, now);
      this.clearEpisode();
    };
    const drop = (reason: string) => {
      this.callbacks.onDiscard?.(reason);
      this.restoreIfDucked(reason);
      this.settle(now, `discarded: ${reason}`);
    };

    switch (this.state) {
      case "committed":
        finishTurn(`student turn complete (${endReason})`);
        return;
      case "listening":
        if (this.addressedByWords) return finishTurn(`turn complete: ${this.lastVerdict?.reason ?? "addressed"}`);
        if (this.lastVerdict && !this.lastVerdict.addressed) return drop(`words: ${this.lastVerdict.reason}`);
        if (who === "other") return drop("voice is not the student's and no words were for the tutor");
        if (!this.tutor.speaking) return finishTurn(`no transcript verdict; tutor silent, letting the model answer (${endReason})`);
        return drop("no words for the tutor before the voice stopped");
      case "attending":
        this.restoreIfDucked("speech ended without evidence it was for the tutor");
        this.settle(now, `ignored: ${this.lastVerdict ? this.lastVerdict.reason : who === "other" ? "another voice" : "no positive evidence"} (${endReason})`);
        return;
      default:
        return;
    }
  }

  private restoreIfDucked(reason: string): void {
    if (!this.ducked) return;
    this.ducked = false;
    this.callbacks.onRestore?.(reason);
  }

  private settle(now: number, reason: string, refractoryMs = this.config.refractoryMs): void {
    this.refractoryUntil = now + refractoryMs;
    this.transition("refractory", reason, now);
    this.clearEpisode();
  }

  private clearEpisode(): void {
    this.candidateAudio = [];
    this.episodeFeatures = [];
    this.episodeSpeechMs = 0;
    this.speakerSum = 0;
    this.speakerWindows = 0;
    this.lastVerdict = null;
    this.lastTranscript = "";
    this.addressedByWords = false;
    this.negativeFinal = false;
  }

  private transition(to: TurnState, reason: string, at: number): void {
    const from = this.state;
    if (from === to && to !== "idle") return;
    this.state = to;
    this.callbacks.onState?.(from, to, reason, at);
  }
}
