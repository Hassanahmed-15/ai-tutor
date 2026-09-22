/**
 * THE LAB'S LIVE SESSION — the new stack wired to a real microphone, a real synthesised tutor, the
 * browser recogniser, the neural VAD, and a simulated model connection whose drops can be injected.
 *
 * This is the integration the production hook would eventually become. It owns no policy: every
 * decision is the pipeline's (lib/turn/pipeline.ts). It owns the plumbing and the truth-telling —
 * the tutor's audibility comes from real synthesis events, the microphone's health from frames
 * actually arriving, and every state of every part is pushed to the UI and the event log.
 */
import { EventLog } from "./events";
import { MicSession, type MicState } from "./micSession";
import { TurnPipeline } from "./pipeline";
import { NOISE_BEDS, FRAME } from "./signals";
import { SileroVad } from "./sileroVad";
import { HeuristicVoiceprint } from "./speakerProfile";
import { createTranscriber, transcriberAvailable, type Transcriber } from "./transcriber";
import { TutorPlayer } from "./tutorPlayer";
import type { TurnState } from "./arbiter";
import type { EndpointState } from "./endpointer";
import { CHAT_GREETING, LECTURE_SENTENCES, PDF_SENTENCES, PLANNING_QUESTIONS, TOPIC_WORDS, replyFor } from "./scripts";

export type LabMode = "normal" | "pdf" | "chat" | "planning";
export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface LiveStatus {
  running: boolean;
  mode: LabMode;
  mic: MicState;
  micDetail: string;
  level: number;
  vad: { ready: boolean; probability: number; speech: boolean; source: "silero" | "heuristic"; inferMs: number; reason: string };
  endpoint: EndpointState;
  turn: TurnState;
  tutor: { audible: boolean; as: "lecture" | "reply"; paused: boolean; sentence: string; expectingAnswer: boolean };
  transcriber: { available: boolean; status: string; last: string; lastFinal: boolean };
  connection: { state: ConnectionState; detail: string };
  speaker: { enrolledFrames: number; enrolled: boolean; verdict: string };
  stats: { turns: number; bargeIns: number; discards: number; ducks: number; watchdogs: number; falseInterruptions: number; missedSpeech: number; reconnects: number };
}

export interface LiveLabOptions {
  mode: LabMode;
  log: EventLog;
  onStatus: (status: LiveStatus) => void;
}

/**
 * A stand-in for the model socket, with the failure modes of a real one: it can be dropped, it
 * reconnects with backoff, and a turn that ends while it is down gets no reply until it is back —
 * which is exactly what the arbiter's response watchdog exists to survive.
 */
class SimulatedConnection {
  state: ConnectionState = "disconnected";
  detail = "";
  reconnects = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly onChange: (state: ConnectionState, detail: string) => void) {}
  connect(): void {
    this.set("connecting", "opening model session");
    this.timer = setTimeout(() => this.set("connected", "session open"), 400);
  }
  drop(reason: string): void {
    if (this.state === "disconnected") return;
    this.set("reconnecting", `dropped: ${reason}`);
    const attempt = () => {
      this.reconnects += 1;
      const delay = Math.min(4000, 300 * 2 ** (this.reconnects - 1));
      this.set("reconnecting", `reconnect ${this.reconnects} in ${delay} ms`);
      this.timer = setTimeout(() => this.set("connected", `reconnected after ${this.reconnects} attempt(s)`), delay);
    };
    attempt();
  }
  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.set("disconnected", "closed");
  }
  get ready(): boolean {
    return this.state === "connected";
  }
  private set(state: ConnectionState, detail: string): void {
    this.state = state;
    this.detail = detail;
    this.onChange(state, detail);
  }
}

export class LiveLab {
  private readonly log: EventLog;
  private mode: LabMode;
  private readonly onStatus: (status: LiveStatus) => void;
  private mic: MicSession | null = null;
  private silero: SileroVad | null = null;
  private transcriber: Transcriber | null = null;
  private tutor: TutorPlayer | null = null;
  private pipeline: TurnPipeline | null = null;
  private readonly connection: SimulatedConnection;
  private readonly verifier = new HeuristicVoiceprint();
  private status: LiveStatus;
  private startedAt = 0;
  private bedName = "none";
  private bedLevel = 0.3;
  private bedOffset = 0;
  private lecturePosition = 0;
  private planningIndex = 0;
  private replyTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private vadProbability: number | null = null;

  constructor(options: LiveLabOptions) {
    this.log = options.log;
    this.mode = options.mode;
    this.onStatus = options.onStatus;
    this.connection = new SimulatedConnection((state, detail) => {
      this.log.log("conn", state, this.now(), detail, state === "connected" ? "ok" : state === "reconnecting" ? "bad" : "info");
      this.patch({ connection: { state, detail }, stats: { ...this.status.stats, reconnects: this.connection.reconnects } });
    });
    this.status = {
      running: false, mode: this.mode, mic: "idle", micDetail: "", level: 0,
      vad: { ready: false, probability: 0, speech: false, source: "heuristic", inferMs: 0, reason: "" },
      endpoint: "silent", turn: "idle",
      tutor: { audible: false, as: "lecture", paused: false, sentence: "", expectingAnswer: false },
      transcriber: { available: transcriberAvailable(), status: "idle", last: "", lastFinal: false },
      connection: { state: "disconnected", detail: "" },
      speaker: { enrolledFrames: 0, enrolled: false, verdict: "unknown" },
      stats: { turns: 0, bargeIns: 0, discards: 0, ducks: 0, watchdogs: 0, falseInterruptions: 0, missedSpeech: 0, reconnects: 0 },
    };
  }

  private now(): number {
    return this.startedAt ? Math.round(performance.now() - this.startedAt) : 0;
  }

  private patch(partial: Partial<LiveStatus>): void {
    this.status = { ...this.status, ...partial };
    this.onStatus(this.status);
  }

  getStatus(): LiveStatus {
    return this.status;
  }

  async start(): Promise<void> {
    this.startedAt = performance.now();
    this.log.clear();
    this.log.log("ui", "start", 0, `mode ${this.mode}`, "ok");
    this.patch({ running: true, mode: this.mode });

    const profile = this.mode === "normal" || this.mode === "pdf" ? "lecture" : "conversation";
    this.pipeline = new TurnPipeline({
      profile,
      verifier: this.verifier,
      log: this.log,
      callbacks: {
        onDuck: (_gain, reason) => { this.tutor?.pause(`duck — ${reason}`); this.patch({ stats: { ...this.status.stats, ducks: this.status.stats.ducks + 1 } }); },
        onRestore: (reason) => { this.tutor?.resume(reason); },
        onPauseTutor: (reason) => {
          this.lecturePosition = this.tutor?.position.index ?? this.lecturePosition;
          this.tutor?.cancel(`barge-in — ${reason}`);
          this.patch({ stats: { ...this.status.stats, bargeIns: this.status.stats.bargeIns + 1 } });
        },
        onResumeTutor: (reason) => { void this.resumeLecture(reason); },
        onEndTurn: (info) => {
          this.patch({ stats: { ...this.status.stats, turns: this.status.stats.turns + 1 } });
          this.respond(info.transcript);
        },
        onDiscard: () => this.patch({ stats: { ...this.status.stats, discards: this.status.stats.discards + 1 } }),
        onState: (_from, to) => this.patch({ turn: to }),
        onWatchdog: () => this.patch({ stats: { ...this.status.stats, watchdogs: this.status.stats.watchdogs + 1 } }),
      },
    });
    this.pipeline.setTopicWords(TOPIC_WORDS);

    // Neural VAD, in parallel with the microphone prompt; the heuristic path covers the gap.
    void SileroVad.load().then((vad) => {
      this.silero = vad;
      this.log.log("vad", vad ? "silero-ready" : "silero-unavailable", this.now(), vad ? "neural VAD loaded (576-sample frames, threshold 0.35)" : "using acoustic heuristics", vad ? "ok" : "warn");
      this.patch({ vad: { ...this.status.vad, ready: Boolean(vad), source: vad ? "silero" : "heuristic" } });
    });

    this.tutor = new TutorPlayer({
      onState: (audible, detail) => {
        this.log.log("tutor", audible ? "audible" : "silent", this.now(), detail, audible ? "info" : "warn");
        const expectingAnswer = this.mode === "planning" && !audible;
        this.pipeline?.setTutor({ speaking: audible, expectingAnswer, speakingAs: this.tutor?.speakingAs }, this.now());
        this.patch({ tutor: { ...this.status.tutor, audible, paused: this.tutor?.isPaused ?? false, as: this.tutor?.speakingAs ?? "lecture", expectingAnswer } });
      },
      onSentence: (index, text) => { this.lecturePosition = index; this.patch({ tutor: { ...this.status.tutor, sentence: text } }); },
    });

    this.transcriber = createTranscriber(
      (t) => {
        this.patch({ transcriber: { ...this.status.transcriber, last: t.text, lastFinal: t.final } });
        this.pipeline?.provideTranscript(t.text, t.final, this.now());
      },
      (status, detail) => {
        this.log.log("words", status, this.now(), detail, status === "error" ? "warn" : "info");
        this.patch({ transcriber: { ...this.status.transcriber, status } });
      },
    );

    this.mic = new MicSession(
      {
        onFrame: (pcm) => this.onFrame(pcm),
        onState: (state, detail) => {
          this.log.log("mic", state, this.now(), detail, state === "connected" ? "ok" : state === "stalled" || state === "failed" || state === "denied" ? "bad" : state === "reconnecting" ? "warn" : "info");
          this.patch({ mic: state, micDetail: detail });
        },
        onLevel: (rms) => this.patch({ level: rms }),
      },
      { bed: () => this.bed() },
    );
    this.connection.connect();
    await this.mic.start();
    this.transcriber.start();
    this.tickTimer = setInterval(() => this.pipeline?.tick(this.now()), 250);
    void this.beginMode();
  }

  stop(): void {
    this.log.log("ui", "stop", this.now(), "", "info");
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.replyTimer) clearTimeout(this.replyTimer);
    this.tickTimer = null;
    this.tutor?.cancel("lab stopped");
    this.transcriber?.stop();
    this.mic?.stop();
    this.connection.close();
    this.pipeline?.reset(this.now());
    this.patch({ running: false, turn: "idle", endpoint: "silent" });
  }

  setMode(mode: LabMode): void {
    this.mode = mode;
    this.patch({ mode });
  }

  setNoiseBed(name: string, level: number): void {
    this.bedName = name;
    this.bedLevel = level;
    this.log.log("ui", "noise-bed", this.now(), `${name} at ${level.toFixed(2)}`);
  }

  simulateMicDrop(): void {
    this.log.log("ui", "simulate", this.now(), "microphone drop", "warn");
    this.mic?.simulateDrop();
  }

  simulateConnectionDrop(): void {
    this.log.log("ui", "simulate", this.now(), "model connection drop", "warn");
    this.connection.drop("simulated");
  }

  /** Tester feedback: the tutor stopped for something that was not me talking to her. */
  markFalseInterruption(): void {
    this.log.log("ui", "mark", this.now(), "FALSE INTERRUPTION reported by tester", "bad");
    this.patch({ stats: { ...this.status.stats, falseInterruptions: this.status.stats.falseInterruptions + 1 } });
  }

  /** Tester feedback: I spoke to her and nothing happened. */
  markMissedSpeech(): void {
    this.log.log("ui", "mark", this.now(), "MISSED SPEECH reported by tester", "bad");
    this.patch({ stats: { ...this.status.stats, missedSpeech: this.status.stats.missedSpeech + 1 } });
  }

  exportLog(): string {
    return JSON.stringify({ mode: this.mode, status: this.status, events: this.log.toJSON() }, null, 2);
  }

  /** Silero for a scenario run: a fresh model state per scenario, awaited frame by frame. */
  async vadForScenarios(): Promise<((frame: Float32Array) => Promise<number | null>) | null> {
    const vad = this.silero ?? (await SileroVad.load());
    if (!vad) return null;
    return async (frame) => vad.push(frame);
  }

  /** Reset the neural VAD's memory between scenarios so one room does not bleed into the next. */
  resetVad(): void {
    this.silero?.reset();
  }

  private bed(): Float32Array | null {
    if (this.bedName === "none" || this.bedLevel <= 0) return null;
    const make = NOISE_BEDS[this.bedName];
    if (!make) return null;
    this.bedOffset += 1;
    return make(this.bedOffset, this.bedLevel);
  }

  private onFrame(pcm: Float32Array): void {
    if (!this.pipeline) return;
    const now = this.now();
    if (this.silero) void this.silero.push(pcm).then((p) => { this.vadProbability = p; });
    const verdict = this.pipeline.push(pcm, now, this.silero ? this.vadProbability : null);
    if (pcm.length !== FRAME) return;
    this.patch({
      vad: { ready: Boolean(this.silero), probability: verdict.probability, speech: verdict.speech, source: verdict.source, inferMs: this.silero?.inferMs ?? 0, reason: verdict.reason },
      endpoint: this.pipeline.endpointState,
      turn: this.pipeline.state,
      speaker: { enrolledFrames: this.verifier.enrolledFrames, enrolled: this.verifier.enrolled, verdict: this.pipeline.arbiter.speakerVerdict() },
    });
  }

  private async beginMode(): Promise<void> {
    if (!this.tutor) return;
    this.lecturePosition = 0;
    this.planningIndex = 0;
    if (this.mode === "normal") await this.tutor.say({ sentences: LECTURE_SENTENCES, as: "lecture" });
    else if (this.mode === "pdf") await this.tutor.say({ sentences: PDF_SENTENCES, as: "lecture" });
    else if (this.mode === "chat") await this.tutor.say({ sentences: CHAT_GREETING, as: "reply" });
    else await this.askNextPlanningQuestion();
  }

  private async askNextPlanningQuestion(): Promise<void> {
    if (!this.tutor) return;
    const question = PLANNING_QUESTIONS[Math.min(this.planningIndex, PLANNING_QUESTIONS.length - 1)];
    await this.tutor.say({ sentences: [question], as: "reply", expectsAnswer: true });
  }

  /** The tutor's reply to a finished turn — only once the model connection is up. */
  private respond(transcript: string): void {
    const speak = async () => {
      if (!this.tutor || !this.pipeline) return;
      this.pipeline.responseStarted(this.now());
      await this.tutor.say({ sentences: replyFor(this.mode, transcript), as: "reply" });
      if (this.mode === "planning") {
        this.planningIndex += 1;
        await this.askNextPlanningQuestion();
      } else if (this.mode === "normal" || this.mode === "pdf") {
        await this.resumeLecture("reply finished");
      }
    };
    const wait = (tries: number) => {
      if (this.connection.ready) { void speak(); return; }
      if (tries > 40) { this.log.log("conn", "reply-abandoned", this.now(), "connection never recovered; the watchdog resumes the lecture", "bad"); return; }
      this.replyTimer = setTimeout(() => wait(tries + 1), 250);
    };
    wait(0);
  }

  private async resumeLecture(reason: string): Promise<void> {
    if (!this.tutor || (this.mode !== "normal" && this.mode !== "pdf")) return;
    const sentences = this.mode === "normal" ? LECTURE_SENTENCES : PDF_SENTENCES;
    if (this.lecturePosition >= sentences.length) return;
    this.log.log("tutor", "continue", this.now(), `${reason} — from sentence ${this.lecturePosition + 1}`, "ok");
    await this.tutor.continueFrom(this.lecturePosition, { sentences, as: "lecture" });
  }
}
