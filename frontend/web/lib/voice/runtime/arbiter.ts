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

/** Mirrors GateProfile in ../sharedVoiceGate.ts — see there for what each costs. */
export type ArbiterProfile = "lecture" | "conversation" | "dedicated";
/** `verifying`: a voice ended with no local words; a second-opinion transcript is on its way. */
const ECHO_REASON = "the narration's own words (echo)";
/** Longer than this, unaddressed local words are a conversation, not a mis-heard call to Aria. */
const SECOND_OPINION_MAX_WORDS = 14;
/**
 * Enough voice to be worth transcribing. It was 450 ms, and a quick "hey Aria" — two short syllables
 * after a one-syllable greeting — measured under it in a real session and was dropped unheard.
 */
const SECOND_OPINION_MIN_SPEECH_MS = 250;

/** Her name as a transcriber spells it when it knows the word; "area" or "tutor" do not count here. */
const ARIA_SPOKEN = /\b(?:aria|arya|ariya|aaria|ariah)\b/i;
const NAMED_BY = /\bby name\b/;

/** The verdict rests on her being called: not merely on the words "teacher" or "tutor" appearing. */
function calledByName(text: string, verdict: AddressingVerdict): boolean {
  if (!verdict.addressed || !NAMED_BY.test(verdict.reason)) return false;
  return verdict.reason !== "addressed by name" || !/\b(?:teacher|tutor)\b/i.test(text) || ARIA_SPOKEN.test(text);
}

export type TurnState = "idle" | "attending" | "verifying" | "listening" | "committed" | "processing" | "refractory";

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
  /**
   * How long a confirmed voice may be held waiting for words before it is let through anyway.
   *
   * Only applies when `requireAddressingBeforeOpen` is set, which is what production runs whenever
   * the browser offers SpeechRecognition. Without this, a recogniser that returns nothing — denied,
   * throttled, unsupported locale, or losing the microphone to the Live session — held every
   * utterance forever: the student talks, the gate waits for a transcript that never comes, and the
   * tutor is silent with no error anywhere. A student saying "hey Aria" got exactly that.
   *
   * Opening on sustained speech alone is the safe failure: audio then reaches Gemini, whose own
   * transcription decides what to do with it. The cost of being wrong is one unnecessary turn; the
   * cost of waiting forever is an assistant that cannot be spoken to at all.
   */
  addressingTimeoutMs: number;
  /**
   * A call by name is never lost (owner, 2026-11-09: "I keep calling Aria and she does not respond").
   * The voice check can no longer veto her name, and speech the gate would have written off as
   * her own echo or another voice is still checked by the server, which can only accept her name.
   */
  callByNameAlwaysHeard: boolean;
  /** Those extra checks are paid for, so at most one in this long… */
  extraCheckGapMs: number;
  /** …and at most this many per session; past it the gate behaves as it did before. */
  extraChecksMax: number;
  /** While she teaches, how much recent speech one name check hears. Measured: 1.3 s hears a bare "Aria" best. */
  nameCheckClipMs: number;
  /** Voice with no gap this long earns a check anyway: her voice leaking into the mic may never leave one. */
  nameCheckContinuousMs: number;
  /** Less speech than this at a gap is not worth a check. */
  nameCheckMinSpeechMs: number;
  /** One check at a time, and no two starting closer than this. */
  nameCheckGapMs: number;
  /** Paid per clip. Past this the end-of-speech check still works. */
  nameChecksMax: number;
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
  // Long enough that a working recogniser almost always wins the race (interim results arrive in
  // 200-600 ms), short enough that a student does not conclude the tutor is deaf.
  addressingTimeoutMs: 1600,
  callByNameAlwaysHeard: false,
  extraCheckGapMs: 3_000,
  // 200 clips of the 12 s most is 40 minutes of audio, about $0.12 at $0.003 a minute: the worst case.
  extraChecksMax: 200,
  nameCheckClipMs: 1_300,
  nameCheckContinuousMs: 1_000,
  nameCheckMinSpeechMs: 250,
  nameCheckGapMs: 1_200,
  // 600 clips of 1.3 s is 13 minutes of audio, about 4 cents: the worst case.
  nameChecksMax: 600,
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
  onWatchdog?: (kind: "mic-stalled" | "response-timeout" | "max-utterance" | "addressing-timeout" | "second-opinion-timeout", detail: string, at: number) => void;
  /**
   * A clear voice ended and the local recogniser gave no words to judge it by. When provided, the
   * arbiter holds the utterance (`verifying`) and waits for `provideSecondOpinion` — a server
   * transcription of exactly this audio — instead of dropping it. See provideSecondOpinion.
   */
  onSecondOpinion?: (audio: Float32Array[]) => void;
  /** While she teaches: transcribe this recent speech and call provideNameCheck. See startNameCheck. */
  onNameCheck?: (audio: Float32Array[]) => void;
}

export interface ArbiterOptions {
  profile?: ArbiterProfile;
  config?: Partial<ArbiterConfig>;
  verifier?: SpeakerVerifier;
  wakeNames?: string[];
  callbacks?: ArbiterCallbacks;
}

/** Content words for comparing a transcript with the narration: lower-case, 3+ letters. */
function echoWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']{3,}/g) ?? []).map((w) => w.replace(/'s$/, ""));
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
  /** When a confirmed voice started waiting on a transcript; -1 when not waiting. */
  private awaitingWordsSince = -1;
  /** The preroll captured when the wait began, so the released turn keeps the opening words. */
  private pendingPreroll: Float32Array[] = [];
  /**
   * Whether the local recogniser has EVER returned a transcript in this session.
   *
   * Session-scoped on purpose, so it is deliberately not cleared by clearEpisode(): one working
   * transcript proves the recogniser exists, and from then on a turn with no words is a student who
   * has not spoken yet rather than a broken transcriber. It is the difference between "wait, the
   * words are coming" and "nothing is ever coming, let the audio through".
   */
  private everTranscribed = false;
  /** The utterance held while a second opinion is fetched (see provideSecondOpinion). */
  private verifyingAudio: Float32Array[] = [];
  private verifyingSince = -1;
  private verifyingDurationMs = 0;
  /** The narration's recent sentences (see setEchoText). */
  private echoTexts: Array<{ words: Set<string>; at: number }> = [];
  /** The held utterance reached the server only to look for her name: nothing else may accept it. */
  private verifyingNeedsName = false;
  private extraChecksUsed = 0;
  private lastExtraCheckAt = -Infinity;
  private nameCheckInFlight = false;
  private nameChecksUsed = 0;
  private lastNameCheckAt = -Infinity;
  private speechSinceNameCheck = 0;
  /** The utterance ended with only a name check still out: it decides, nothing else was asked. */
  private verifyingOnNameCheck = false;
  /** The endpointer is inside an utterance, whether or not this gate is attending to it. */
  private endpointActive = false;
  /** That utterance's audio while the gate was busy, and how much of it was voice. */
  private tailAudio: Float32Array[] = [];
  private tailSpeechMs = 0;
  /** This episode began mid-speech: only her literal name may accept it. */
  private joinedEpisode = false;

  /**
   * A near-miss in the student's OWN voice is for her. Background speech lost the easy credit that
   * let any question through (see the idle credit in addressing.ts); the student's plain "what
   * happens next?" should not lose it with it. A voice the verifier has enrolled from their earlier
   * turns and matches now tips a sentence that was only just short. Unknown and other voices get
   * nothing extra.
   */
  private creditStudentVoice(verdict: AddressingVerdict): AddressingVerdict {
    if (verdict.addressed || verdict.score < 0.4 || this.speakerVerdict() !== "student") return verdict;
    return { addressed: true, score: Math.min(1, verdict.score + 0.1), reason: `${verdict.reason} + the student's own voice` };
  }

  /**
   * The voice check may turn away vague speech, never her name. A wrong voice profile lasts the
   * whole lecture and rejected calls cannot correct it, so a veto here locked the student out.
   */
  private nameOverridesVoice(text: string, verdict: AddressingVerdict): boolean {
    return this.config.callByNameAlwaysHeard && calledByName(text, verdict);
  }

  /** May one more name-only server check be spent now? Counts it when it may. */
  private takeExtraCheck(now: number): boolean {
    if (!this.config.callByNameAlwaysHeard) return false;
    if (this.extraChecksUsed >= this.config.extraChecksMax || now - this.lastExtraCheckAt < this.config.extraCheckGapMs) return false;
    this.extraChecksUsed += 1;
    this.lastExtraCheckAt = now;
    return true;
  }

  /**
   * LISTENING FOR HER NAME WHILE SHE TEACHES (owner, 2026-11-10: "you keep saying aria aria, it
   * listens after multiple retries"). The server check used to wait for the speech to END, so
   * "Aria… Aria… Aria" with short gaps kept postponing it, and her voice leaking into the mic could
   * postpone it for 20 s. Until a first call succeeds there is no voice profile to help either.
   * So at the first small gap, or after each second of unbroken voice, the last moments are checked
   * and the episode keeps running: a repeated call still counts.
   */
  private startNameCheck(now: number): void {
    const config = this.config;
    if (!config.callByNameAlwaysHeard || !this.callbacks.onNameCheck || !this.tutor.speaking || this.state !== "attending") return;
    if (this.addressedByWords || this.lastVerdict?.addressed || this.candidateAudio.length === 0) return;
    if (this.nameCheckInFlight || this.nameChecksUsed >= config.nameChecksMax || now - this.lastNameCheckAt < config.nameCheckGapMs) return;
    this.nameCheckInFlight = true;
    this.nameChecksUsed += 1;
    this.lastNameCheckAt = now;
    this.speechSinceNameCheck = 0;
    this.callbacks.onNameCheck(this.candidateAudio.slice(-Math.round(config.nameCheckClipMs / 20)));
  }

  /**
   * SPEECH THAT STARTED WHILE THE GATE WAS BUSY. An onset only counts from `idle`, so a call begun
   * during the 1-2 s server check of an earlier sound, or its cooldown, was never attended to: the
   * endpointer stayed inside that utterance and fired no new onset. Measured on the real player with
   * narration leaking into the mic, this was every missed first "Aria". Join it when the gate frees.
   */
  private collectSpeechUnderWay(pcm: Float32Array, speech: boolean, frameDelta: number, now: number): void {
    if (!this.endpointActive || !this.config.callByNameAlwaysHeard || !this.tutor.speaking) return;
    if (this.state !== "verifying" && this.state !== "refractory" && this.state !== "idle") return;
    this.tailAudio.push(pcm);
    if (this.tailAudio.length > 600) this.tailAudio.shift();
    if (speech) this.tailSpeechMs += frameDelta;
    if (this.state === "verifying" || (this.state === "refractory" && now < this.refractoryUntil)) return;
    const audio = this.tailAudio;
    const speechMs = this.tailSpeechMs;
    if (this.state === "refractory") this.transition("idle", "refractory over", now);
    this.clearEpisode();
    this.tailAudio = [];
    this.tailSpeechMs = 0;
    this.candidateAudio = audio;
    this.episodeSpeechMs = speechMs;
    this.speechSinceNameCheck = speechMs;
    this.joinedEpisode = true;
    this.attendingSince = now;
    this.transition("attending", "joined speech already under way", now);
  }

  /** The script itself saying her name ("I'm Aria") must not read as a call. */
  private narrationSaysName(now: number): boolean {
    return this.echoTexts.some((e) => now - e.at < 20_000 && [...e.words].some((word) => ARIA_SPOKEN.test(word)));
  }

  /** What the name check heard. Only her name, spelled as her name, does anything. */
  provideNameCheck(text: string, now: number): void {
    this.nameCheckInFlight = false;
    const clean = text.trim();
    const heard = ARIA_SPOKEN.test(clean) && !this.narrationSaysName(now);
    if (this.state === "verifying") {
      if (heard) {
        this.verifyingOnNameCheck = false;
        this.provideSecondOpinion(clean, now);
      } else if (this.verifyingOnNameCheck) {
        this.verifyingAudio = [];
        this.verifyingNeedsName = false;
        this.settle(now, "ignored: her name was not said");
      }
      return;
    }
    if (!heard || this.state !== "attending") return;
    const verdict = classifyAddressing(clean, { expectingAnswer: this.tutor.expectingAnswer, tutorSpeaking: this.tutor.speaking, topicWords: this.topicWords, wakeNames: this.wakeNames });
    if (!verdict.addressed) return;
    this.lastTranscript = clean;
    this.lastVerdict = verdict;
    this.addressedByWords = true;
    this.negativeFinal = false;
    this.open(now, this.candidateAudio, `name check: ${verdict.reason}`);
    if (this.tutor.speaking) this.commit(now, `name check: ${verdict.reason}`);
  }

  /** Whether a transcript is mostly the narration's own recent words (and names nobody). */
  private isEcho(text: string, now: number): boolean {
    if (!this.tutor.speaking) return false;
    const recent = this.echoTexts.filter((e) => now - e.at < 20_000);
    if (!recent.length) return false;
    const words = echoWords(text);
    if (words.length < 3) return false;
    const heard = words.filter((w) => recent.some((e) => e.words.has(w))).length;
    return heard / words.length >= 0.7;
  }

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

  /**
   * The local recogniser died (or came back). While it is dead no words will ever arrive, so a
   * voice must not wait on them: the "ever transcribed" proof that made waiting safe is withdrawn,
   * and the addressing timeout lets the turn through to the model, whose own transcription decides.
   * Without this, one working transcript early in the session kept the gate waiting forever after
   * the recogniser failed — every "Aria…" settled as "ignored".
   */
  setTranscriberAlive(alive: boolean): void {
    if (!alive) this.everTranscribed = false;
  }

  /**
   * What the lecture is saying right now. The browser recogniser hears the speakers too, so the
   * narration came back as "the student's" words — a rhetorical "what is a derivative?" in the
   * script scored as a question for the tutor and paused the lecture. A transcript made mostly of
   * the last sentences she spoke is her own echo, not the student.
   */
  setEchoText(text: string, now: number): void {
    this.echoTexts.push({ words: new Set(echoWords(text)), at: now });
    if (this.echoTexts.length > 3) this.echoTexts.shift();
  }

  /**
   * THE WORDS THE LOCAL RECOGNISER MISSED.
   *
   * Chrome's speech recogniser captures through its own audio path, and measured with a real voice
   * on the same microphone it answered "no-speech" to every phrase while this gate heard each one
   * clearly — "Hey Aria, can you pause the lecture?" was ducked, then dropped as "no evidence it was
   * for the tutor". During a lecture a voice with no words is never let through (it could be anyone),
   * so the name could not work at all. A second opinion on exactly that audio settles it: addressed,
   * and the turn opens with the audio — so the model hears what was said — and pauses the lecture;
   * not addressed, and it is ignored as before.
   */
  provideSecondOpinion(text: string, now: number): void {
    if (this.state !== "verifying") return;
    const audio = this.verifyingAudio;
    this.verifyingAudio = [];
    const needsName = this.verifyingNeedsName;
    this.verifyingNeedsName = false;
    const clean = text.trim();
    if (clean) this.everTranscribed = true;
    let verdict = clean
      ? classifyAddressing(clean, { expectingAnswer: this.tutor.expectingAnswer, tutorSpeaking: this.tutor.speaking, topicWords: this.topicWords, wakeNames: this.wakeNames })
      : { addressed: false, score: 0, reason: "no words in the second opinion" };
    /*
     * The same two vetoes the local words get (provideTranscript). The second opinion is the path
     * phone and TV audio took: the browser recogniser barely hears a loudspeaker across the room,
     * the server transcriber hears it perfectly, and its words were judged with no check that the
     * voice was the student's or that they were not the lecture's own narration coming back.
     */
    if (verdict.addressed && this.speakerVerdict() === "other" && !this.nameOverridesVoice(clean, verdict)) {
      verdict = { addressed: false, score: verdict.score, reason: `${verdict.reason}, but the voice is not the student's` };
    }
    verdict = this.creditStudentVoice(verdict);
    /*
     * ONLY HER NAME, SPELLED AS HER NAME. This clip is mostly the narration or another voice, so
     * anything looser lets the lecture stop itself: a script saying "the teacher", or ending on
     * "area", is a call by the ordinary rules.
     */
    if (needsName && !ARIA_SPOKEN.test(clean)) verdict = { addressed: false, score: 0, reason: "extra check: her name was not said" };
    if (verdict.addressed && this.isEcho(clean, now) && !/\bby name\b/.test(verdict.reason)) {
      verdict = { addressed: false, score: 0, reason: ECHO_REASON };
    }
    this.lastTranscript = clean;
    this.lastVerdict = verdict;
    if (!verdict.addressed) {
      this.settle(now, `ignored (second opinion): ${verdict.reason}`);
      return;
    }
    this.transition("attending", "second opinion: addressed", now);
    this.addressedByWords = true;
    this.open(now, audio, `second opinion: ${verdict.reason}`);
    if (this.tutor.speaking) this.commit(now, `second opinion: ${verdict.reason}`);
    this.endEpisode(now, this.verifyingDurationMs, "second-opinion");
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
      /*
       * Bounded, but long enough for a whole request. It was ~4 s, trimmed from the FRONT — and the
       * front is where the name is: "Aria, draw a binary search tree with the keys seven, two, nine,
       * one, five and three" reached the second opinion (and the model) as "2, 9, 1, 5 and 3 for me",
       * and was ignored. 12 s of 20 ms frames also stays under the transcription upload limit.
       */
      if (this.candidateAudio.length > 600) this.candidateAudio.shift();
    }
    this.collectSpeechUnderWay(pcm, verdict.speech, frameDelta, now);
    if (!verdict.speech) return;
    this.episodeSpeechMs += frameDelta;
    this.speechSinceNameCheck += frameDelta;
    if (this.state === "attending" && this.speechSinceNameCheck >= this.config.nameCheckContinuousMs) this.startNameCheck(now);

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
      const replying = this.tutor.speakingAs === "reply" || (this.tutor.speakingAs === undefined && this.profile !== "lecture");
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
    if (event.type === "onset" || event.type === "start") this.endpointActive = true;
    if (event.type === "end" || event.type === "abort") {
      this.endpointActive = false;
      this.tailAudio = [];
      this.tailSpeechMs = 0;
    }
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
        } else if (this.config.requireAddressingBeforeOpen && !this.tutor.speaking) {
          /*
           * Confirmed speech, tutor silent, no words yet. Start the clock rather than waiting
           * indefinitely: tick() opens this turn if the transcript never arrives. Interrupting a
           * SPEAKING tutor on no evidence is a different, worse trade, so that case still waits.
           */
          this.awaitingWordsSince = now;
          this.pendingPreroll = event.preroll;
        }
        return;
      case "pause":
        if (this.speechSinceNameCheck >= this.config.nameCheckMinSpeechMs) this.startNameCheck(now);
        return;
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
    // Recorded before the state guard: a transcript arriving while idle still proves the recogniser
    // is alive, which is all the addressing watchdog needs to know.
    if (text.trim()) this.everTranscribed = true;
    if (this.state !== "attending" && this.state !== "listening" && this.state !== "committed") return;
    this.lastTranscript = text;
    const echo = this.isEcho(text, now);
    let verdict = classifyAddressing(text, {
      expectingAnswer: this.tutor.expectingAnswer,
      tutorSpeaking: this.tutor.speaking,
      topicWords: this.topicWords,
      wakeNames: this.wakeNames,
    });
    if (verdict.addressed && this.speakerVerdict() === "other" && !this.nameOverridesVoice(text, verdict)) {
      verdict = { addressed: false, score: verdict.score, reason: `${verdict.reason}, but the voice is not the student's` };
    }
    verdict = this.creditStudentVoice(verdict);
    // Echo is dropped unless her name was actually said: "Aria, what is that?" is never an echo.
    if (echo && !/\bby name\b/.test(verdict.reason)) {
      verdict = { addressed: false, score: 0, reason: ECHO_REASON };
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
    /*
     * A confirmed voice waited for words that never came. Let it through.
     *
     * The transcript feeding the addressing gate comes from the browser's SpeechRecognition, which
     * can silently produce nothing — permission denied, an unsupported locale, throttling, or the
     * Live session taking the microphone. When that happened the turn was held indefinitely and the
     * tutor never answered, with no error raised anywhere: exactly "I keep saying hey Aria and it
     * doesn't listen". Opening on sustained speech hands the audio to Gemini, whose own
     * transcription then decides; one unnecessary turn is a far cheaper mistake than silence.
     */
    if (
      this.state === "attending" &&
      this.awaitingWordsSince >= 0 &&
      !this.addressedByWords &&
      !this.tutor.speaking &&
      // Only when the recogniser has produced NOTHING for this whole session. A transcriber that is
      // working — even slowly, even mid-sentence — must be allowed to finish, or a student speaking
      // with pauses gets cut off and their neighbour's side-talk gets let in. Both were measured:
      // scenarios 53 and 54 broke on timing alone, and 26 and 29 leaked.
      this.lastTranscript === "" &&
      !this.everTranscribed &&
      now - this.awaitingWordsSince >= this.config.addressingTimeoutMs
    ) {
      const waited = Math.round(now - this.awaitingWordsSince);
      const preroll = this.pendingPreroll;
      this.awaitingWordsSince = -1;
      this.pendingPreroll = [];
      this.callbacks.onWatchdog?.("addressing-timeout", `no transcript after ${waited} ms; opening anyway`, now);
      /*
       * Open, but do NOT commit. Committing pauses the tutor and reports a barge-in, which is wrong
       * here: this branch only runs while she is silent, so there is nothing to interrupt. Opening
       * streams the audio to Gemini and lets the ordinary end-of-utterance path finish the turn.
       */
      this.open(now, preroll, "confirmed speech, but no words arrived to judge it");
      return;
    }

    if (this.state === "verifying" && now - this.verifyingSince >= 5_000) {
      this.callbacks.onWatchdog?.("second-opinion-timeout", `no second opinion after ${Math.round(now - this.verifyingSince)} ms`, now);
      this.verifyingAudio = [];
      this.settle(now, "ignored: the second opinion never came");
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
    this.nameCheckInFlight = false;
    this.endpointActive = false;
    this.tailAudio = [];
    this.tailSpeechMs = 0;
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
      // A turn that ends normally must give Aria her volume back: without this a student answering
      // just as she finished left her next replies at the ducked quarter volume.
      this.restoreIfDucked("the student's turn is complete");
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
        /*
         * A clear voice the local recogniser could not vouch for: ask for a second opinion on
         * exactly this audio rather than dropping it (see provideSecondOpinion).
         *
         * Not only when it produced NO words — also when its words were not addressed. Chrome hears
         * "hey Aria" in an accent as "Yaariyan" or "hey idea"; that garbled verdict used to count as
         * proof the student was talking to someone else, and the one phrase that should always work
         * was dropped three times in a row (measured in the user's own session). Only the
         * narration's echo, another person's voice, and long talk (a conversation, not a call) are
         * trusted to be for someone else.
         */
        const localWords = this.lastTranscript.trim().split(/\s+/).filter(Boolean).length;
        const localSaysEcho = this.lastVerdict?.reason === ECHO_REASON;
        const askable = !this.lastVerdict?.addressed && this.episodeSpeechMs >= SECOND_OPINION_MIN_SPEECH_MS && Boolean(this.callbacks.onSecondOpinion) && this.candidateAudio.length > 0;
        const ordinary = !this.joinedEpisode && !localSaysEcho && localWords <= SECOND_OPINION_MAX_WORDS && who !== "other";
        /*
         * What used to be written off without a check: her echo, a voice that does not match, or a
         * long run of words under the narration (Chrome writing down her sentence over the call).
         */
        const writtenOff = this.joinedEpisode || localSaysEcho || (who === "other" && localWords <= SECOND_OPINION_MAX_WORDS) || (localWords > SECOND_OPINION_MAX_WORDS && this.tutor.speaking);
        const extra = askable && !ordinary && writtenOff && this.takeExtraCheck(now);
        if (askable && (ordinary || extra)) {
          this.verifyingNeedsName = !ordinary;
          this.verifyingAudio = [...this.candidateAudio];
          this.verifyingSince = now;
          this.verifyingDurationMs = durationMs;
          this.candidateAudio = [];
          this.restoreIfDucked("holding the utterance for a second opinion");
          this.transition("verifying", `${this.lastTranscript ? `local words "${this.lastTranscript.slice(0, 40)}" unconvincing` : "no local words"} for ${Math.round(this.episodeSpeechMs)} ms of voice; asking for a second opinion`, now);
          this.callbacks.onSecondOpinion?.(this.verifyingAudio);
          return;
        }
        // A name check is still out on this speech: its answer decides, so a call is not dropped.
        if (this.nameCheckInFlight && !this.lastVerdict?.addressed) {
          this.verifyingOnNameCheck = true;
          this.verifyingNeedsName = true;
          this.verifyingAudio = [...this.candidateAudio];
          this.verifyingSince = now;
          this.verifyingDurationMs = durationMs;
          this.candidateAudio = [];
          this.restoreIfDucked("holding the utterance for the name check");
          this.transition("verifying", "speech ended while a name check is out", now);
          return;
        }
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
    this.speechSinceNameCheck = 0;
    this.verifyingOnNameCheck = false;
    this.joinedEpisode = false;
    this.speakerSum = 0;
    this.speakerWindows = 0;
    this.lastVerdict = null;
    this.lastTranscript = "";
    this.addressedByWords = false;
    this.negativeFinal = false;
    // Clear the addressing clock with the episode, so a wait from a previous utterance cannot fire
    // against the next one.
    this.awaitingWordsSince = -1;
    this.pendingPreroll = [];
  }

  private transition(to: TurnState, reason: string, at: number): void {
    const from = this.state;
    if (from === to && to !== "idle") return;
    this.state = to;
    this.callbacks.onState?.(from, to, reason, at);
  }
}
