/**
 * THE VOICE GATE — decides, frame by frame, whether the microphone is carrying a turn for Aria.
 *
 * It sits between the microphone and Gemini Live and owns three decisions the old design left to
 * the server or to luck:
 *
 *   LISTEN   — open a turn and start sending audio (with pre-roll, so the first word is not lost).
 *   BARGE-IN — stop the tutor mid-sentence, because the student genuinely wants her to.
 *   DISCARD  — close the turn and throw the model's reply away, because it was not for us.
 *
 * Three layers feed it, each behind its own module so any one can be replaced:
 *   acoustic  (features.ts)        is this speech at all, and how loud, and is it voiced
 *   speaker   (speakerProfile.ts)  is it plausibly the student's voice
 *   semantic  (addressing.ts)      are the words for Aria
 *
 * THE RULE THAT SHAPES EVERYTHING: while Aria is speaking, nothing stops her without POSITIVE
 * evidence — her name, a lesson command, a question about the board, or a verified student voice
 * that has kept talking for two full seconds. Ducking is cheap and reversible, so the gate ducks
 * early and often; stopping is expensive, so it is late and rare. While Aria is silent the bar
 * drops, because there is nothing to interrupt — but a turn still only reaches the model once the
 * words or the voice say it should, and a turn that turns out to be the neighbour's is discarded
 * before the model's answer is heard.
 *
 * WHAT WAS WRONG BEFORE, so it is not reintroduced:
 *   - self-echo cooldown was dated from the END of each scheduled audio chunk, which during a
 *     streaming reply put the gate in permanent cooldown — barge-in was structurally impossible.
 *     Here the tutor's state is a live boolean the hook keeps true only while audio is audible.
 *   - while the tutor was silent the gate was bypassed and the turn held open, so every sound in
 *     the room became a user turn. Here a turn always needs a candidate episode to open.
 *   - a "rejected" episode was a terminal state. Here every episode returns to idle through a short
 *     refractory window, which is also the hysteresis against flapping.
 *   - the first ~240 ms of every barge-in were streamed outside the turn and never transcribed.
 *     Here a pre-roll ring buffer is replayed into the turn the moment it opens.
 *
 * Pure and clock-injected: no timers, no audio APIs. The hook supplies frames and time.
 */
import { DEFAULT_GATE_CONFIG, isVoiceLike, voiceConfidence } from "../interruptionGate";
import { classifyAddressing, type AddressingVerdict } from "./addressing";
import { analyzeVoiceFrame, type VoiceFrameFeatures } from "./features";
import { NoSpeakerVerifier, type SpeakerVerdict, type SpeakerVerifier } from "./speakerProfile";

/**
 * How much evidence a turn needs. See lib/voice/sharedVoiceGate.ts for the full rationale;
 * "dedicated" is a session the student opened on purpose, where anything they say is for the tutor.
 */
export type GateProfile = "lecture" | "conversation" | "dedicated";

export interface VoiceGateConfig {
  /** Frame length the hook delivers. Everything below is in ms and independent of it. */
  frameMs: number;
  /**
   * Voice-like audio before a turn opens and audio starts flowing. Must exceed the 160 ms the
   * steadiness test needs (8 voiced windows), or a chord on the TV opens a turn before it can be
   * told from a vowel. Nothing is lost by waiting: the pre-roll replays these frames into the turn.
   */
  candidateMs: number;
  /** Sustained voice before the tutor is ducked. Ducking is cheap, so this is short too. */
  armMs: number;
  /** Silence that ends an episode. Long enough to survive the pause inside a sentence. */
  silenceMs: number;
  /** After an episode ends, new candidates are ignored this long — hysteresis against flapping. */
  refractoryMs: number;
  /**
   * Verified student voice, sustained this long while the tutor speaks and with no transcript
   * verdict yet, stops the tutor. The safety net for a transcriber that is slow or silent — but
   * ONLY with the speaker layer's say-so; an unverified voice waits for words however long it goes.
   */
  maxUnverifiedMs: number;
  /** Tutor gain while ducked. */
  duckGain: number;
  /** After the tutor's audio actually ends, treat mic voice with suspicion this long (room echo). */
  echoGuardMs: number;
  /** voiceConfidence floor for a frame to count, tutor silent. */
  minConfidence: number;
  /** ...and while the tutor is speaking, where the mic hears the speakers too. */
  minConfidenceWhileTutorSpeaking: number;
  /** Audio kept before the turn opens and replayed into it. */
  prerollMs: number;
  /** Voiced windows needed before the speaker verdict for an episode is trusted. */
  minSpeakerWindows: number;
}

export const DEFAULT_VOICE_GATE_CONFIG: VoiceGateConfig = {
  frameMs: 20,
  candidateMs: 180,
  armMs: 240,
  silenceMs: 700,
  refractoryMs: 500,
  maxUnverifiedMs: 2000,
  duckGain: 0.25,
  echoGuardMs: 250,
  minConfidence: 0.45,
  minConfidenceWhileTutorSpeaking: 0.7,
  prerollMs: 500,
  minSpeakerWindows: 5,
};

export type GateStage = "idle" | "candidate" | "listening" | "committed" | "refractory";

export type GateEventKind =
  | "listen"
  | "frame"
  | "duck"
  | "restore"
  | "barge-in"
  | "turn-end"
  | "discard"
  | "decision";

export interface GateDecision {
  stage: GateStage;
  reason: string;
  detail: string;
  at: number;
}

export interface VoiceGateCallbacks {
  /** A turn opened. `preroll` is the audio from just before it, oldest first — send it first. */
  onListen?: (preroll: Float32Array[]) => void;
  /** A frame that belongs to the open turn. Only fires between onListen and onTurnEnd/onDiscard. */
  onFrame?: (pcm: Float32Array) => void;
  onDuck?: (gain: number) => void;
  onRestore?: () => void;
  /** Stop the tutor NOW. Fires at most once per episode. */
  onBargeIn?: (reason: string) => void;
  /** The turn is a real one and it is over: close it and let the model answer. */
  onTurnEnd?: () => void;
  /** The turn was not for us: close it and suppress whatever the model says back. */
  onDiscard?: (reason: string) => void;
  onDecision?: (decision: GateDecision) => void;
}

export interface VoiceGateOptions {
  profile?: GateProfile;
  config?: Partial<VoiceGateConfig>;
  verifier?: SpeakerVerifier;
  callbacks?: VoiceGateCallbacks;
  wakeNames?: string[];
  /** True when words arrive from a browser-side recognizer before audio is sent to Gemini. */
  semanticPrefilter?: boolean;
}

export class VoiceGate {
  readonly config: VoiceGateConfig;
  readonly profile: GateProfile;
  private readonly verifier: SpeakerVerifier;
  private readonly callbacks: VoiceGateCallbacks;
  private readonly wakeNames?: string[];
  private readonly semanticPrefilter: boolean;

  private stage: GateStage = "idle";
  private tutorSpeaking = false;
  private tutorLastAudibleAt = -Infinity;
  private expectingAnswer = false;
  private topicWords: Set<string> = new Set();

  private pendingFrame: Float32Array | null = null;
  private preroll: Float32Array[] = [];
  /** Full candidate audio, including pre-roll. It is released only after semantic acceptance. */
  private candidateAudio: Float32Array[] = [];
  private readonly prerollFrames: number;

  /**
   * Recent voiced windows, for the STEADINESS test. Speech is never steady: its loudness pulses
   * with every syllable (4-8 Hz) and its pitch wanders by percent within a phrase. A chord, a hum, a
   * held note on the TV, a notification tone hold both flat — and on a single 40 ms window they are
   * indistinguishable from a vowel. Over 160 ms they are not.
   */
  private recentF0: number[] = [];
  private recentRms: number[] = [];

  private candidateSince = 0;
  private lastVoiceAt = 0;
  private listeningSince = 0;
  private ducked = false;
  private refractoryUntil = 0;

  // Per-episode evidence.
  private episodeFrames: VoiceFrameFeatures[] = [];
  private speakerSum = 0;
  private speakerWindows = 0;
  private lastVerdict: AddressingVerdict | null = null;
  private lastTranscript = "";
  private addressedByWords = false;
  private notForUsCount = 0;
  private lastDecision: GateDecision | null = null;

  constructor(options: VoiceGateOptions = {}) {
    this.config = { ...DEFAULT_VOICE_GATE_CONFIG, ...options.config };
    this.profile = options.profile ?? "lecture";
    this.verifier = options.verifier ?? new NoSpeakerVerifier();
    this.callbacks = options.callbacks ?? {};
    this.wakeNames = options.wakeNames;
    this.semanticPrefilter = options.semanticPrefilter ?? false;
    this.prerollFrames = Math.max(1, Math.round(this.config.prerollMs / this.config.frameMs));
  }

  // --- Inputs from the hook -------------------------------------------------------------------

  getStage(): GateStage {
    return this.stage;
  }

  getLastDecision(): GateDecision | null {
    return this.lastDecision;
  }

  /** Live truth about the speakers: true only while tutor audio is actually audible. */
  setTutorSpeaking(speaking: boolean, now: number): void {
    if (this.tutorSpeaking && !speaking) this.tutorLastAudibleAt = now;
    this.tutorSpeaking = speaking;
  }

  /** Aria asked something and is waiting. Lowers the semantic bar to "a plain answer counts". */
  setExpectingAnswer(expecting: boolean): void {
    this.expectingAnswer = expecting;
  }

  setTopicWords(words: Iterable<string>): void {
    this.topicWords = new Set(words);
  }

  /**
   * One 20 ms frame of 16 kHz mono. Features are computed on a 40 ms window (this frame and the
   * previous one) because pitch needs two periods; the decision still updates every 20 ms.
   */
  push(pcm: Float32Array, now: number): void {
    // Pre-roll ring buffer: always kept, whatever the stage, so a turn can start in the past.
    this.preroll.push(pcm);
    if (this.preroll.length > this.prerollFrames) this.preroll.shift();

    const previous = this.pendingFrame;
    this.pendingFrame = pcm;
    const window = previous ? concat(previous, pcm) : pcm;
    const features = analyzeVoiceFrame(window, 16_000);

    if (this.stage === "listening" || this.stage === "committed") this.callbacks.onFrame?.(pcm);

    const confidence = voiceConfidence(features, DEFAULT_GATE_CONFIG);
    const floor = this.tutorSpeaking || now - this.tutorLastAudibleAt < this.config.echoGuardMs
      ? this.config.minConfidenceWhileTutorSpeaking
      : this.config.minConfidence;
    let voice = isVoiceLike(features, DEFAULT_GATE_CONFIG) && confidence >= floor && features.rms >= DEFAULT_GATE_CONFIG.minRms;

    if (voice && this.isSteadyTone(features)) {
      // Periodic and in-band, but with none of the movement of a voice: music, hum, a held tone.
      voice = false;
      if (this.stage === "idle" || this.stage === "candidate") this.decide(now, "steady-tone", "periodic but unmodulated — not speech");
    }

    if (voice) {
      this.lastVoiceAt = now;
      this.onVoiceFrame(features, now, confidence);
    } else {
      this.onQuietFrame(now);
    }
  }

  private isSteadyTone(features: VoiceFrameFeatures): boolean {
    if (features.f0 !== null && features.voicing >= 0.5) {
      this.recentF0.push(features.f0);
      this.recentRms.push(features.rms);
      if (this.recentF0.length > 8) {
        this.recentF0.shift();
        this.recentRms.shift();
      }
    }
    if (this.recentF0.length < 8) return false;
    const cv = (values: number[]) => {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
      return mean > 0 ? Math.sqrt(variance) / mean : 0;
    };
    // Real speech: pitch CV well over 1% and loudness CV well over 10% across 160 ms.
    return cv(this.recentF0) < 0.006 && cv(this.recentRms) < 0.08;
  }

  /**
   * Words from the transcriber, interim or final. Interim text is used for POSITIVE verdicts only
   * (her name arriving mid-sentence should stop her at once); negatives wait for the final text,
   * because interim results truncate mid-word.
   */
  provideTranscript(text: string, final: boolean, now: number): void {
    if (this.stage !== "candidate" && this.stage !== "listening" && this.stage !== "committed") return;
    this.lastTranscript = text;
    let verdict = classifyAddressing(text, {
      expectingAnswer: this.expectingAnswer,
      tutorSpeaking: this.tutorSpeaking,
      topicWords: this.topicWords,
      wakeNames: this.wakeNames,
    });
    /*
     * A DEDICATED SESSION HAS NOBODY ELSE TO BE TALKING TO. The student pressed a button that says
     * "listening" and is speaking at it; demanding a question form or the tutor's name filtered out
     * "hello", "hey" and "explain linear regression" — 0.15 against a 0.50 bar — so the session
     * looked live and never answered. The words test is skipped unless it positively identifies
     * someone else's conversation (a hail to a named person, or domestic side-talk), which is the
     * only thing it can usefully tell us here.
     */
    if (this.profile === "dedicated" && !verdict.addressed && verdict.score > 0) {
      verdict = { addressed: true, score: Math.max(verdict.score, 0.6), reason: `${verdict.reason} (dedicated voice session)` };
    }
    /*
     * The words and the voice must agree when the words are only WEAKLY for us. "It's in the
     * kitchen drawer" while Aria waits for an answer is addressed on the words alone — an answer
     * is expected and this is a sentence — but if the voice is plainly not the student's, it is
     * someone else answering someone else. Once a voice profile is enrolled, it also applies to
     * hard rules: a nearby person saying "Aria, stop" is still not the enrolled student's turn.
     */
    if (verdict.addressed && this.speakerVerdict() === "other") {
      verdict = { addressed: false, score: verdict.score, reason: `${verdict.reason}, but the voice is not the student's` };
    }
    this.lastVerdict = verdict;

    if (verdict.addressed) {
      this.addressedByWords = true;
      this.notForUsCount = 0;
      if (this.stage === "candidate") this.listen(now);
      if (this.stage === "listening" && this.tutorSpeaking) this.commit(now, `words: ${verdict.reason}`);
      else this.decide(now, "addressed", `"${text.slice(0, 50)}": ${verdict.reason}`);
      return;
    }

    if (!final) {
      this.notForUsCount += 1;
      this.decide(now, "not-addressed-interim", `"${text.slice(0, 50)}": ${verdict.reason}`);
      return;
    }
    // A browser recognizer may finalize clauses separately. Do not reject a still-speaking
    // candidate on the first negative clause: a later "Arya, ..." must still be able to accept the
    // same utterance. The silence confirmation window settles the negative without opening Gemini.
    if (this.stage === "candidate") this.decide(now, "not-addressed-final", `"${text.slice(0, 50)}": ${verdict.reason}`);
    else if (this.stage === "listening") this.discard(now, `words: ${verdict.reason}`);
    else this.decide(now, "not-addressed-after-commit", `"${text.slice(0, 50)}": ${verdict.reason}`);
  }

  reset(): void {
    if (this.ducked) this.callbacks.onRestore?.();
    this.ducked = false;
    this.stage = "idle";
    this.clearEpisode();
    this.pendingFrame = null;
  }

  // --- The state machine ----------------------------------------------------------------------

  private onVoiceFrame(features: VoiceFrameFeatures, now: number, confidence: number): void {
    const speaker = this.verifier.match(features);
    if (speaker.verdict !== "unknown" || this.verifier.enrolled) {
      if (features.f0 !== null && features.voicing >= 0.5) {
        this.speakerSum += speaker.similarity;
        this.speakerWindows += 1;
      }
    }

    switch (this.stage) {
      case "refractory":
        if (now < this.refractoryUntil) {
          // The utterance we just settled is still going. It cannot become a new turn until it has
          // actually stopped — otherwise a discarded sentence re-opens itself every half second.
          this.refractoryUntil = now + this.config.refractoryMs;
          return;
        }
        this.stage = "idle";
      // falls through
      case "idle":
        this.stage = "candidate";
        this.candidateSince = now;
        this.candidateAudio = [...this.preroll];
        this.decide(now, "voice-candidate", `confidence ${confidence.toFixed(2)}`);
        return;
      case "candidate":
        this.candidateAudio.push(this.pendingFrame as Float32Array);
        // Bound a stalled recognizer to four seconds of PCM (~256 KB). A longer utterance keeps
        // its most recent audio; normal accepted turns resolve hundreds of milliseconds in.
        if (this.candidateAudio.length > 200) this.candidateAudio.shift();
        // Without a local semantic prefilter, audio has to reach Gemini to obtain words. This
        // compatibility path is paired with NO_INTERRUPTION at the transport layer. On supported
        // browsers the candidate remains local until the transcript says it is for Arya.
        if (!this.semanticPrefilter && now - this.candidateSince >= this.config.candidateMs) this.listen(now);
        else if (
          this.semanticPrefilter &&
          this.tutorSpeaking &&
          this.speakerVerdict() === "student" &&
          now - this.candidateSince >= this.config.maxUnverifiedMs
        ) {
          this.listen(now);
          this.commit(now, "verified student voice sustained while local transcription was unavailable");
        }
        return;
      case "listening": {
        this.episodeFrames.push(features);
        const sustained = now - this.listeningSince;
        if (this.tutorSpeaking && !this.ducked && sustained >= this.config.armMs) {
          this.ducked = true;
          this.callbacks.onDuck?.(this.config.duckGain);
          this.decide(now, "sustained-voice", "ducking the tutor while the words come in");
        }
        const who = this.speakerVerdict();
        if (who === "other" && this.tutorSpeaking && sustained >= this.config.armMs) {
          // Not the student, tutor talking: this can never be a barge-in. Stop ducking, keep the
          // turn open for the transcript only so the discard below is certain.
          if (this.ducked) {
            this.ducked = false;
            this.callbacks.onRestore?.();
            this.decide(now, "other-speaker", "restoring the tutor: voice is not the student's");
          }
        }
        if (this.tutorSpeaking && who === "student" && sustained >= this.config.maxUnverifiedMs && !this.lastVerdict) {
          this.commit(now, "verified student voice sustained with no transcript verdict");
        }
        return;
      }
      case "committed":
        this.episodeFrames.push(features);
        return;
    }
  }

  private onQuietFrame(now: number): void {
    switch (this.stage) {
      case "candidate":
        // Leave a confirmation window for a final local transcript, which commonly lands just
        // after the last phoneme. No Gemini activity has opened, so waiting is harmless.
        if (now - this.lastVoiceAt >= this.config.silenceMs) this.rejectCandidate(now, "no addressed transcript in confirmation window");
        return;
      case "listening":
      case "committed":
        if (now - this.lastVoiceAt >= this.config.silenceMs) this.endEpisode(now);
        return;
      case "refractory":
        if (now >= this.refractoryUntil) this.stage = "idle";
        return;
      default:
        return;
    }
  }

  private listen(now: number): void {
    this.stage = "listening";
    this.listeningSince = now;
    const buffered = this.candidateAudio.length ? this.candidateAudio : this.preroll;
    this.callbacks.onListen?.([...buffered]);
    this.candidateAudio = [];
    this.decide(now, "listening", `accepted turn opened with ${buffered.length} buffered frames`);
  }

  private rejectCandidate(now: number, why: string): void {
    this.decide(now, "candidate-rejected", why);
    this.finish(now);
  }

  private commit(now: number, why: string): void {
    if (this.stage === "committed") return;
    this.stage = "committed";
    if (this.ducked) {
      this.ducked = false;
      this.callbacks.onRestore?.();
    }
    this.callbacks.onBargeIn?.(why);
    this.decide(now, "barge-in", why);
  }

  private discard(now: number, why: string): void {
    if (this.ducked) {
      this.ducked = false;
      this.callbacks.onRestore?.();
    }
    this.callbacks.onDiscard?.(why);
    this.decide(now, "discard", why);
    this.finish(now);
  }

  /** Silence ended the episode: settle it one way or the other. */
  private endEpisode(now: number): void {
    const who = this.speakerVerdict();
    if (this.stage === "committed") {
      this.enrolEpisode();
      this.callbacks.onTurnEnd?.();
      this.decide(now, "turn-end", "student turn complete");
      this.finish(now);
      return;
    }
    if (this.addressedByWords) {
      this.enrolEpisode();
      this.callbacks.onTurnEnd?.();
      this.decide(now, "turn-end", `turn complete: ${this.lastVerdict?.reason ?? "addressed"}`);
      this.finish(now);
      return;
    }
    if (this.lastVerdict && !this.lastVerdict.addressed) {
      this.discard(now, `words: ${this.lastVerdict.reason}`);
      return;
    }
    if (who === "other") {
      this.discard(now, "voice is not the student's and no words were for Aria");
      return;
    }
    /*
     * No words at all. Tutor silent and the student (or an unknown voice) spoke: the transcriber
     * may simply be slow, and ending the turn lets the model answer whatever was said. In lecture
     * mode with the tutor speaking there is nothing to answer — the tutor was never stopped — so
     * the turn is discarded rather than handed to the model to reply over the narration.
     */
    if (!this.tutorSpeaking && (this.profile === "conversation" || this.profile === "dedicated")) {
      this.enrolEpisode();
      this.callbacks.onTurnEnd?.();
      this.decide(now, "turn-end", "no transcript verdict; tutor silent, letting the model answer");
      this.finish(now);
      return;
    }
    this.discard(now, "no words for Aria before the voice stopped");
  }

  private finish(now: number): void {
    this.stage = "refractory";
    this.refractoryUntil = now + this.config.refractoryMs;
    this.clearEpisode();
  }

  private clearEpisode(): void {
    this.episodeFrames = [];
    this.recentF0 = [];
    this.recentRms = [];
    this.speakerSum = 0;
    this.speakerWindows = 0;
    this.lastVerdict = null;
    this.lastTranscript = "";
    this.addressedByWords = false;
    this.notForUsCount = 0;
    this.candidateSince = 0;
    this.candidateAudio = [];
  }

  /** Only turns the words accepted teach the profile, so a neighbour never becomes the student. */
  private enrolEpisode(): void {
    for (const features of this.episodeFrames) this.verifier.enrol(features);
  }

  private speakerVerdict(): SpeakerVerdict {
    if (!this.verifier.enrolled || this.speakerWindows < this.config.minSpeakerWindows) return "unknown";
    const mean = this.speakerSum / this.speakerWindows;
    if (mean >= 0.62) return "student";
    if (mean <= 0.42) return "other";
    return "unknown";
  }

  private decide(at: number, reason: string, detail: string): void {
    const decision: GateDecision = { stage: this.stage, reason, detail, at };
    this.lastDecision = decision;
    this.callbacks.onDecision?.(decision);
  }
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
