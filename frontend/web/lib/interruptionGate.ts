/**
 * Deciding whether the student is TALKING TO THE TUTOR, as opposed to merely making noise.
 *
 * WHY THIS EXISTS. The tutor used to stop talking for a desk fan. Three separate triggers each cut
 * the audio the instant they saw energy — a broadband RMS test in the mic callback, the server's
 * own VAD pinned to its most eager sensitivity, and any interim transcript — and not one of them
 * could tell a voice from a air conditioner. The only thing in the system that could tell the
 * difference was a text classifier that ran AFTER the audio had already been cut, which is why the
 * symptom was audible every time.
 *
 * THE SHAPE OF THE FIX. Interruption is not one decision, it is three, and they answer different
 * questions at different costs:
 *
 *   1. IS THIS A VOICE AT ALL?  (acoustic, ~0 ms)  Rejects fans, AC, hum, hiss, keyboard clicks,
 *      door slams. Cheap, runs on every frame, and decides nothing on its own.
 *   2. IS IT SUSTAINED?  (debounce, ~240 ms)  Rejects the short accidental sounds that pass a
 *      single-frame voice test — a cough, a chair scrape, one key press.
 *   3. IS IT ADDRESSED TO US?  (transcript, ~300-900 ms)  The only question acoustics cannot
 *      answer. Someone across the room asking another person a question IS speech, by every
 *      spectral measure, and no threshold will ever reject it. Only the words can.
 *
 * Stage 3 is why the tutor DUCKS rather than stops. Waiting for a transcript before reacting at all
 * would make real interruptions feel dead; cutting the audio before the transcript arrives is the
 * bug. Ducking to a low volume within a frame or two of stage 2 gives an instant, honest response
 * to "someone is speaking" while keeping the cost of being wrong to a brief dip in volume instead
 * of a stopped lecture.
 *
 * NO SERVER VAD. With `automaticActivityDetection.disabled: true`, Gemini stops interrupting on its
 * own and the client owns the decision end to end. That is deliberate: the server cannot be taught
 * about this room, and its most conservative sensitivity is still a pure speech detector — it would
 * keep firing on the neighbour's conversation no matter how it were tuned.
 *
 * Everything here is pure and clock-injected so the whole matrix — fan, white noise, TV, two people
 * talking, whispering, stutters — can be tested deterministically without a microphone.
 */

export type InterruptionStage =
  /** Nothing of interest. The tutor talks normally. */
  | "idle"
  /** Voice-like audio has appeared but has not lasted long enough to act on. */
  | "candidate"
  /** Sustained voice. The tutor is ducked, and we are waiting on words to decide. */
  | "ducked"
  /** The words were addressed to the tutor. Full stop, hand over the turn. */
  | "committed"
  /** The words were not addressed to the tutor. Restore volume, keep teaching. */
  | "rejected";

/** One analysis window's worth of acoustic measurements. */
export type AudioFeatures = {
  /** Broadband root-mean-square level, 0..1. */
  rms: number;
  /**
   * Spectral flatness (Wiener entropy), 0..1. The single most useful number here.
   *
   * Noise with a flat spectrum — fans, AC, hiss, white noise — sits high, near 1. Voiced speech has
   * harmonic structure with sharp peaks at the pitch and its multiples, so it sits low, typically
   * well under 0.4. This is what separates "loud" from "voice", which RMS alone never could.
   */
  flatness: number;
  /**
   * Zero-crossing rate, 0..1. High for fricatives, hiss and clicks; moderate for voiced speech.
   * Used to reject the bright, noisy transients that flatness alone lets through.
   */
  zcr: number;
  /**
   * Share of total energy inside the 300-3400 Hz speech band, 0..1.
   *
   * A fan's energy piles up below 300 Hz; keyboard clicks and cymbals spread far above 3.4 kHz.
   * Speech concentrates here, which is precisely why telephony chose this band.
   */
  bandRatio: number;
  /**
   * RMS of the speech band alone, in the same units as `rms`.
   *
   * WHY A RATIO IS NOT ENOUGH. `bandRatio` is a SHARE, so loud noise outside the band inflates its
   * denominator and hides speech inside it. Measured on a clear voice over a running fan:
   *
   *     voice alone        rms 0.058  band ratio 0.998   <- obviously a voice
   *     fan alone          rms 0.119  band ratio 0.002
   *     the two together   rms 0.133  band ratio 0.170   <- scored 0.00 confidence
   *
   * The speech did not get quieter when the fan started; only its share did. Judging the mixture on
   * share alone concluded there was no voice present at all, and a student asking a question over
   * an air conditioner went unheard — the exact complaint this system exists to fix, arrived at
   * from the opposite direction.
   *
   * Absolute band energy does not move when noise is added elsewhere in the spectrum, so it answers
   * "is there speech-band energy here" independently of how loud the rest of the room is.
   */
  bandRms: number;
};

export type InterruptionGateConfig = {
  /** Above this share of flat spectrum, the frame is noise no matter how loud it is. */
  maxFlatness: number;
  /** Below this share of speech-band energy, the frame is not a voice on share alone. */
  minBandRatio: number;
  /**
   * Absolute speech-band level that counts as speech regardless of what else is in the room.
   *
   * The second route into the speech-band test, for signals whose share is destroyed by loud
   * out-of-band noise. See `AudioFeatures.bandRms`.
   */
  minBandRms: number;
  /** Absolute speech-band level treated as unambiguous speech, for scoring confidence. */
  confidentBandRms: number;
  /** Above this zero-crossing rate, the frame is hiss or a click rather than a voice. */
  maxZcr: number;
  /** Absolute floor. Nothing quieter than this is ever treated as speech. */
  minRms: number;
  /** How far above the running noise floor a frame must sit. */
  noiseFloorMultiplier: number;
  /** Sustained voice-like audio required before the tutor ducks, in milliseconds. */
  minSpeechMs: number;
  /** Silence required before an episode is considered over, in milliseconds. */
  silenceMs: number;
  /** How long to wait for a transcript before giving the student the benefit of the doubt. */
  decisionTimeoutMs: number;
  /** Gain applied to the tutor's voice while ducked, 0..1. */
  duckGain: number;
  /** After the tutor stops speaking, ignore the mic this long so it cannot hear its own echo. */
  selfEchoCooldownMs: number;
};

/**
 * Defaults tuned to prefer a missed duck over a false stop.
 *
 * The asymmetry is deliberate and is the whole point of the change: a student whose interruption
 * takes an extra fifth of a second is mildly annoyed, while a lecture that stops every time the AC
 * cycles is unusable. Where a threshold was a judgement call, it went toward silence.
 */
export const DEFAULT_GATE_CONFIG: InterruptionGateConfig = {
  // Voiced speech measures ~0.05-0.35 here; a fan or hiss ~0.6-0.95. 0.45 sits in the empty middle.
  maxFlatness: 0.45,
  minBandRatio: 0.35,
  /*
   * The absolute speech-band floor, set from measurement.
   *
   *     fan 0.25 / 0.5        bandRms 0.005 / 0.011   <- noise, must stay below
   *     whisper at the mic    bandRms 0.023           <- quietest thing that must pass
   *     voice over a fan      bandRms 0.055           <- the case this route exists for
   *     distant bystander     bandRms 0.005           <- correctly below
   *
   * 0.02 sits in the gap between the loud fan and the whisper. Note that white noise measures
   * 0.08-0.16 here and so clears this floor easily — it is rejected on FLATNESS instead (0.58 against
   * a 0.45 ceiling), which is why this route is an alternative way to satisfy the band test and not
   * a way to bypass the others. Removing the flatness test would make this number dangerous.
   */
  minBandRms: 0.02,
  // Roughly a conversational voice at the microphone; above this, band evidence is as strong as it
  // needs to be and confidence is driven by spectral shape alone.
  confidentBandRms: 0.06,
  maxZcr: 0.45,
  /*
   * The absolute floor, set from measurement rather than intuition.
   *
   * This was 0.03, which silently discarded whispers: a quiet voice close to the mic measures about
   * 0.024 RMS, so "a quiet voice is still a voice" failed. The same voice at conversational level
   * measures ~0.11 and a genuinely distant one ~0.005, so 0.015 sits in open space between "someone
   * murmuring at this machine" and "someone audible across the room" — the distinction the floor is
   * actually for. Noise rejection does not depend on this number; flatness and band ratio do that.
   */
  minRms: 0.015,
  noiseFloorMultiplier: 2.6,
  // ~240 ms is about two syllables: long enough to reject a cough or a single key press, short
  // enough that a real "wait—" still ducks while the student is saying it.
  minSpeechMs: 240,
  silenceMs: 650,
  // If no transcript arrives by here, assume the student meant it. Being slow to stop for a real
  // question is worse than briefly ducking for a noise.
  decisionTimeoutMs: 1_200,
  // Audible enough to prove the tutor heard something, quiet enough to talk over comfortably.
  duckGain: 0.2,
  selfEchoCooldownMs: 350,
};

/** Why the gate did what it did. Every transition carries one, so decisions can be audited. */
export type GateDecision = {
  stage: InterruptionStage;
  /** Machine-readable cause, for tests and telemetry. */
  reason:
    | "quiet"
    | "below-noise-floor"
    | "flat-spectrum"
    | "out-of-band"
    | "high-zcr"
    | "self-echo-cooldown"
    | "voice-candidate"
    | "sustained-voice"
    | "addressed"
    | "not-addressed"
    | "decision-timeout"
    | "silence"
    | "reset";
  /** Human-readable, logged so a wrong call in a real room can be explained afterwards. */
  detail: string;
  /** 0..1 confidence that this frame is a human voice. Not a probability, a score. */
  voiceConfidence: number;
};

/** What the gate wants the audio layer to do right now. */
export type GateEffect = "none" | "duck" | "restore" | "stop";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * How voice-like one window is, 0..1.
 *
 * Deliberately a blend rather than a chain of hard gates: a whisper has weak band energy but very
 * un-flat spectrum, and a hard AND would throw it away. Each term is scored on its own and the
 * weakest evidence drags the score down without vetoing it outright.
 */
export function voiceConfidence(features: AudioFeatures, config: InterruptionGateConfig): number {
  /*
   * BAND RATIO IS THE ONLY TERM THAT CAN VETO, and it is deliberately multiplicative.
   *
   * The first version of this was a weighted sum with flatness dominant, and it scored a desk fan
   * at 0.70 — because a fan is a near-pure tone, so it is the LEAST flat signal in the whole set
   * (0.001) and has almost no zero crossings (0.006). Two of the three terms were reporting
   * "definitely a voice" about an air conditioner; only band ratio (0.004) disagreed, and a sum let
   * the majority win. Measured values that make the point:
   *
   *     fan 60-120 Hz   flat 0.001  zcr 0.006  band 0.004   <- low flatness, NOT a voice
   *     white noise     flat 0.580  zcr 0.511  band 0.380
   *     speech          flat 0.008  zcr 0.049  band 0.979
   *
   * Low flatness means "tonal", and speech is tonal — but so is a hum. What actually separates them
   * is WHERE the energy sits. So band ratio gates the whole score multiplicatively: no speech-band
   * energy, no confidence, whatever the other terms say. Flatness and ZCR then only refine a score
   * that band ratio has already allowed, which is the role they can actually play honestly.
   */
  /*
   * Band evidence comes from the better of two readings: the SHARE of energy in the speech band, or
   * the ABSOLUTE amount of it. Share is the sharper discriminator in a quiet room; absolute level is
   * what survives loud out-of-band noise, which is where share collapses (see `bandRms`). Taking
   * the maximum means a fan can no longer mask a voice, while a fan on its own still scores zero on
   * both — it has neither the share nor the speech-band energy.
   */
  const shareScore = clamp01((features.bandRatio - config.minBandRatio) / (1 - config.minBandRatio));
  /*
   * The absolute route is only open to TONAL frames.
   *
   * Broadband noise has plenty of absolute energy in 300-3400 Hz simply because it has energy
   * everywhere — white noise measures 0.08-0.16 bandRms, above a real voice at 0.058. Left ungated,
   * this route handed it a 0.35 confidence score on the strength of noise that happened to fall in
   * the band. It was still rejected downstream on flatness, but a detector that reports a third of
   * the way to "voice" about static has no headroom left, and the noise-floor learning rule keys on
   * this score at 0.5.
   *
   * Requiring the frame to be tonal first closes that: the absolute measure exists to rescue a
   * voice whose SHARE was destroyed by out-of-band noise, and such a frame is still harmonic. Noise
   * is not, so it gets nothing here and falls back to share, where it belongs.
   */
  const tonal = features.flatness <= config.maxFlatness;
  const absoluteScore = tonal
    ? clamp01((features.bandRms - config.minBandRms) / (config.confidentBandRms - config.minBandRms))
    : 0;
  const bandScore = Math.max(shareScore, absoluteScore);
  if (bandScore <= 0) return 0;
  const flatnessScore = clamp01((config.maxFlatness - features.flatness) / config.maxFlatness);
  const zcrScore = clamp01((config.maxZcr - features.zcr) / config.maxZcr);
  const shape = flatnessScore * 0.6 + zcrScore * 0.4;
  return clamp01(bandScore * (0.35 + 0.65 * shape));
}

/** Voice-like enough to bother debouncing. */
export function isVoiceLike(features: AudioFeatures, config: InterruptionGateConfig): boolean {
  // Either test can establish the speech band, for the reason given in `voiceConfidence`: a loud
  // fan destroys the share while leaving the absolute speech-band energy untouched.
  const tonal = features.flatness <= config.maxFlatness;
  // The absolute route is gated on tonality for the reason given in `voiceConfidence`; here that is
  // implicit, since `tonal` is required overall — but it is spelled out so the two stay in step.
  const inSpeechBand =
    features.bandRatio >= config.minBandRatio || (tonal && features.bandRms >= config.minBandRms);
  return tonal && inSpeechBand && features.zcr <= config.maxZcr;
}

export type InterruptionGateCallbacks = {
  /** Duck the tutor to `gain`. Called once per episode, as early as stage 2 allows. */
  onDuck?: (gain: number) => void;
  /** Return the tutor to full volume. The episode was not addressed to us. */
  onRestore?: () => void;
  /** Stop the tutor outright and hand over the turn. */
  onStop?: () => void;
  /** Every decision, for the log. */
  onDecision?: (decision: GateDecision) => void;
};

/**
 * The state machine.
 *
 * Fed one analysis window at a time by the mic callback, plus transcript text when it arrives. Holds
 * no audio and touches no browser API, so it runs identically in a test.
 */
export class InterruptionGate {
  private config: InterruptionGateConfig;
  private callbacks: InterruptionGateCallbacks;
  private stage: InterruptionStage = "idle";
  private noiseFloor = 0.015;
  private candidateSince = 0;
  private lastVoiceAt = 0;
  private duckedAt = 0;
  private tutorSpeakingUntil = 0;
  private lastDecision: GateDecision | null = null;

  constructor(config: Partial<InterruptionGateConfig> = {}, callbacks: InterruptionGateCallbacks = {}) {
    this.config = { ...DEFAULT_GATE_CONFIG, ...config };
    this.callbacks = callbacks;
  }

  getStage(): InterruptionStage {
    return this.stage;
  }

  getNoiseFloor(): number {
    return this.noiseFloor;
  }

  getLastDecision(): GateDecision | null {
    return this.lastDecision;
  }

  /**
   * Tell the gate the tutor is producing audio right now.
   *
   * Browser echo cancellation is built for a headset and is unreliable over speakers, so the mic
   * genuinely hears the tutor. Without this the tutor interrupts itself — and its own voice passes
   * every acoustic test in this file, because it IS a voice.
   */
  noteTutorAudio(now: number): void {
    this.tutorSpeakingUntil = now + this.config.selfEchoCooldownMs;
  }

  private emit(decision: GateDecision): GateDecision {
    this.lastDecision = decision;
    this.callbacks.onDecision?.(decision);
    return decision;
  }

  /** Feed one analysis window. Returns the decision for this frame. */
  push(features: AudioFeatures, now: number): GateDecision {
    const confidence = voiceConfidence(features, this.config);

    // The tutor's own voice, coming back through the speakers. Never a student interruption.
    if (now < this.tutorSpeakingUntil) {
      return this.emit({
        stage: this.stage,
        reason: "self-echo-cooldown",
        detail: `within ${this.config.selfEchoCooldownMs}ms of the tutor's own audio`,
        voiceConfidence: confidence,
      });
    }

    const adaptiveThreshold = Math.max(this.config.minRms, this.noiseFloor * this.config.noiseFloorMultiplier);
    const voiceLike = isVoiceLike(features, this.config);

    /*
     * STRONG SPECTRAL EVIDENCE OUTRANKS THE ADAPTIVE THRESHOLD.
     *
     * The multiplier is there so that ambiguous energy in a loud room does not trigger — it is a
     * defence against LEVEL, and level is exactly the wrong test for a whisper. A quiet voice close
     * to the mic measures ~0.024 RMS against a 0.039 adaptive threshold, so it was rejected on
     * loudness while scoring 0.92 on voice shape: the detector was simultaneously certain it was
     * hearing a person and certain that person was too quiet to count.
     *
     * So a frame that is unmistakably voice-shaped only has to clear the ABSOLUTE floor. Anything
     * less certain still has to clear the room. Noise cannot exploit this: a fan scores 0.00 and
     * white noise 0.02, both far below the bar, because band placement gates the score.
     */
    const confidentVoice = voiceLike && confidence >= 0.75;
    const threshold = confidentVoice ? this.config.minRms : adaptiveThreshold;
    /*
     * MEASURE THE LEVEL IN THE SPEECH BAND, not across the whole spectrum.
     *
     * The adaptive threshold is learned from broadband RMS, so a loud fan raises it — and then the
     * same fan's energy is counted again on the other side of the comparison when a voice arrives.
     * A student speaking over an air conditioner measured 0.135 broadband against a 0.290 threshold
     * the fan itself had trained, and went unheard: the level test was comparing the noise to
     * itself. The student's voice never got quieter; only the ratio did.
     *
     * Comparing speech-band level instead removes the noise from both sides of that comparison for
     * frames that already look like a voice. Frames that do not look like a voice keep the
     * broadband test, so noise is still measured the way the floor that rejects it was learned.
     */
    const level = confidentVoice ? Math.max(features.bandRms, features.rms * 0.35) : features.rms;
    const loudEnough = level >= threshold;

    if (loudEnough && voiceLike) {
      this.lastVoiceAt = now;
      this.candidateSince ||= now;

      if (this.stage === "idle") {
        this.stage = "candidate";
        return this.emit({
          stage: this.stage,
          reason: "voice-candidate",
          detail: `voice-like at rms ${features.rms.toFixed(3)} (floor ${threshold.toFixed(3)}), waiting ${this.config.minSpeechMs}ms`,
          voiceConfidence: confidence,
        });
      }

      if (this.stage === "candidate" && now - this.candidateSince >= this.config.minSpeechMs) {
        this.stage = "ducked";
        this.duckedAt = now;
        this.callbacks.onDuck?.(this.config.duckGain);
        return this.emit({
          stage: this.stage,
          reason: "sustained-voice",
          detail: `voice sustained ${Math.round(now - this.candidateSince)}ms — ducking to ${this.config.duckGain}, awaiting words`,
          voiceConfidence: confidence,
        });
      }

      // Already ducked and still hearing speech: hold, and let the transcript decide.
      if (this.stage === "ducked" && now - this.duckedAt >= this.config.decisionTimeoutMs) {
        this.stage = "committed";
        this.callbacks.onStop?.();
        return this.emit({
          stage: this.stage,
          reason: "decision-timeout",
          detail: `no transcript in ${this.config.decisionTimeoutMs}ms but speech continues — treating as addressed`,
          voiceConfidence: confidence,
        });
      }

      return this.emit({
        stage: this.stage,
        reason: this.stage === "candidate" ? "voice-candidate" : "sustained-voice",
        detail: "voice continuing",
        voiceConfidence: confidence,
      });
    }

    /*
     * Learn the room — but never from something that sounds like a person.
     *
     * This used to adapt on every non-triggering frame, which meant a QUIET voice trained the
     * detector to ignore it: each frame of a whisper nudged the floor up, the threshold climbed
     * away faster than the whisper could reach it, and the speaker was absorbed into the noise
     * estimate. Traced frame by frame at 0.0236 RMS — floor 0.0154 -> 0.0171, threshold 0.0401 ->
     * 0.0444, never once triggering. The same mechanism would swallow any real speech that starts
     * below threshold, so it was a correctness bug and not just a whisper edge case.
     *
     * Voice-likeness is a spectral judgement and is independent of level, so it stays reliable
     * exactly where the level test fails. A fan scores 0.00 here and a whisper 0.92, so the floor
     * still tracks genuine room noise and simply declines to learn from human speech.
     */
    const voiceLikeButQuiet = isVoiceLike(features, this.config) && confidence >= 0.5;
    if ((this.stage === "idle" || this.stage === "candidate") && !voiceLikeButQuiet) {
      this.noiseFloor = this.noiseFloor * 0.95 + Math.min(features.rms, 0.12) * 0.05;
    }

    if (this.stage === "candidate" && now - this.lastVoiceAt >= this.config.silenceMs) {
      this.stage = "idle";
      this.candidateSince = 0;
      return this.emit({
        stage: this.stage,
        reason: "silence",
        detail: "candidate faded before it lasted long enough — short accidental sound",
        voiceConfidence: confidence,
      });
    }

    if ((this.stage === "ducked" || this.stage === "committed") && now - this.lastVoiceAt >= this.config.silenceMs) {
      const wasDucked = this.stage === "ducked";
      this.stage = "idle";
      this.candidateSince = 0;
      if (wasDucked) this.callbacks.onRestore?.();
      return this.emit({
        stage: this.stage,
        reason: "silence",
        detail: wasDucked ? "speech ended without words addressed to the tutor — restoring" : "episode over",
        voiceConfidence: confidence,
      });
    }

    const reason: GateDecision["reason"] = !loudEnough
      ? features.rms < this.config.minRms
        ? "quiet"
        : "below-noise-floor"
      : features.flatness > this.config.maxFlatness
        ? "flat-spectrum"
        : features.bandRatio < this.config.minBandRatio
          ? "out-of-band"
          : "high-zcr";

    return this.emit({
      stage: this.stage,
      reason,
      detail:
        reason === "flat-spectrum"
          ? `flatness ${features.flatness.toFixed(2)} > ${this.config.maxFlatness} — broadband noise, not a voice`
          : reason === "out-of-band"
            ? `only ${(features.bandRatio * 100).toFixed(0)}% of energy in the speech band`
            : reason === "high-zcr"
              ? `zcr ${features.zcr.toFixed(2)} — hiss or click, not a voice`
              : `rms ${features.rms.toFixed(3)} below threshold ${threshold.toFixed(3)}`,
      voiceConfidence: confidence,
    });
  }

  /**
   * Hand the gate what the student actually said.
   *
   * This is the only stage that can tell "explain that again" from the neighbour asking someone to
   * pass the salt, and it is why ducking exists — there is nowhere else to put this decision that
   * does not either cut the audio early or respond late.
   */
  provideTranscript(text: string, addressed: boolean, now: number): GateDecision {
    if (this.stage !== "ducked" && this.stage !== "candidate") {
      return this.emit({
        stage: this.stage,
        reason: "reset",
        detail: "transcript arrived outside an episode — ignored",
        voiceConfidence: this.lastDecision?.voiceConfidence ?? 0,
      });
    }

    if (addressed) {
      this.stage = "committed";
      this.callbacks.onStop?.();
      return this.emit({
        stage: this.stage,
        reason: "addressed",
        detail: `"${text.slice(0, 60)}" is addressed to the tutor — stopping`,
        voiceConfidence: this.lastDecision?.voiceConfidence ?? 1,
      });
    }

    this.stage = "rejected";
    this.callbacks.onRestore?.();
    this.candidateSince = 0;
    this.lastVoiceAt = now;
    return this.emit({
      stage: this.stage,
      reason: "not-addressed",
      detail: `"${text.slice(0, 60)}" is not addressed to the tutor — restoring volume`,
      voiceConfidence: this.lastDecision?.voiceConfidence ?? 0,
    });
  }

  /** Drop all episode state. Used on mute, teardown and reconnect. */
  reset(): void {
    const had = this.stage === "ducked";
    this.stage = "idle";
    this.candidateSince = 0;
    this.lastVoiceAt = 0;
    this.duckedAt = 0;
    if (had) this.callbacks.onRestore?.();
    this.emit({ stage: "idle", reason: "reset", detail: "gate reset", voiceConfidence: 0 });
  }
}

/**
 * Measure one window of PCM.
 *
 * Kept separate from the state machine so tests can feed either real captured audio or synthesised
 * signals, and so the DSP can be checked on its own — a detector that mismeasures flatness would
 * otherwise look like a tuning problem forever.
 */
export function analyzeFrame(samples: Float32Array, sampleRate: number): AudioFeatures {
  const n = samples.length;
  if (n === 0) return { rms: 0, flatness: 1, zcr: 0, bandRatio: 0, bandRms: 0 };

  let energy = 0;
  let crossings = 0;
  for (let i = 0; i < n; i += 1) {
    energy += samples[i] * samples[i];
    if (i > 0 && (samples[i] >= 0) !== (samples[i - 1] >= 0)) crossings += 1;
  }
  const rms = Math.sqrt(energy / n);
  const zcr = crossings / Math.max(1, n - 1);

  // A Goertzel-style magnitude sweep rather than a full FFT: this runs in the audio callback, and
  // only a coarse spectral shape is needed — 32 bins across 0-8 kHz is ample to tell a harmonic
  // stack from flat noise, at a fraction of the cost.
  const BINS = 32;
  const maxHz = Math.min(8000, sampleRate / 2);
  const magnitudes = new Float64Array(BINS);
  for (let bin = 0; bin < BINS; bin += 1) {
    const hz = ((bin + 0.5) / BINS) * maxHz;
    const omega = (2 * Math.PI * hz) / sampleRate;
    const cosine = 2 * Math.cos(omega);
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < n; i += 1) {
      s0 = samples[i] + cosine * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    magnitudes[bin] = Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - cosine * s1 * s2)) / n;
  }

  let total = 0;
  let band = 0;
  let logSum = 0;
  let arithmeticSum = 0;
  const EPSILON = 1e-10;
  for (let bin = 0; bin < BINS; bin += 1) {
    const hz = ((bin + 0.5) / BINS) * maxHz;
    const power = magnitudes[bin] * magnitudes[bin];
    total += power;
    if (hz >= 300 && hz <= 3400) band += power;
    logSum += Math.log(power + EPSILON);
    arithmeticSum += power + EPSILON;
  }

  // Wiener entropy: geometric mean over arithmetic mean. Equal across bins (noise) drives it to 1;
  // concentrated in a few bins (a harmonic voice) drives it toward 0.
  const geometricMean = Math.exp(logSum / BINS);
  const arithmeticMean = arithmeticSum / BINS;
  const flatness = arithmeticMean > 0 ? clamp01(geometricMean / arithmeticMean) : 1;
  const bandRatio = total > 0 ? clamp01(band / total) : 0;

  /*
   * Absolute speech-band level, scaled to be comparable with the time-domain `rms` above.
   *
   * The band's SHARE of total power, times the total power, is the band's power — so taking it as a
   * fraction of the measured RMS converts the spectral estimate into the same units without relying
   * on the Goertzel magnitudes being calibrated in absolute terms. That matters because the sweep is
   * coarse and unwindowed, so its absolute scale is only approximate, while the ratio between bins
   * is reliable — which is exactly the part being used here.
   */
  const bandRms = rms * Math.sqrt(bandRatio);

  return { rms, flatness, zcr, bandRatio, bandRms };
}
