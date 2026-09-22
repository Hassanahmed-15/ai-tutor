/**
 * THE SCENARIO SUITE — every room sound and conversation pattern the architecture must survive,
 * with the verdict a person would give, run through the SAME pipeline the microphone drives.
 *
 * The first 31 are ported from production's matrix so nothing that was known to work is lost.
 * The rest are new and target what the brief named directly: natural pauses inside a sentence,
 * a real stop followed by a second question, overlapping speakers, a microphone that drops out
 * mid-turn, a listening state that would otherwise never end, and a reply that never arrives.
 *
 * Pure. In the browser the same scenarios can be re-run with the neural VAD supplying probabilities.
 */
import { analyzeVoiceFrame, concatFrames } from "./acoustics";
import type { TurnState } from "./arbiter";
import { EventLog, type LabEvent } from "./events";
import { TurnPipeline } from "./pipeline";
import { ARIA, FRAME_MS, FRIEND, RATE, STUDENT, click, fan, mix, music, ping, seq, silence, traffic, voice } from "./signals";
import { HeuristicVoiceprint } from "./speakerProfile";
import type { ArbiterProfile } from "./arbiter";

export type Expect = "SILENT" | "TURN" | "BARGE-IN";

export interface Scenario {
  id: number;
  name: string;
  expect: Expect;
  profile?: ArbiterProfile;
  frames: Float32Array[];
  /** Tutor audible for these frames (a range), else silent throughout. */
  tutorSpeakingFrames?: [number, number];
  speakingAs?: "lecture" | "reply";
  expectingAnswer?: boolean;
  transcript?: { text: string; atFrame: number; final?: boolean };
  transcript2?: { text: string; atFrame: number; final?: boolean };
  unenrolled?: boolean;
  /** Frames in [start, start+count) never arrive at the pipeline — the microphone stalled. */
  gap?: { start: number; count: number };
  /** The tutor never starts a reply after a turn ends. */
  noResponse?: boolean;
  expectTurns?: number;
  expectWatchdog?: "mic-stalled" | "response-timeout" | "max-utterance";
  /** How many trailing silent frames to run so long watchdogs can fire. */
  trailingFrames?: number;
  note?: string;
}

export interface Outcome {
  verdict: Expect;
  turns: number;
  bargeReason: string | null;
  discarded: boolean;
  ducked: boolean;
  restored: boolean;
  resumed: boolean;
  finalState: TurnState;
  watchdogs: string[];
  events: LabEvent[];
  transcripts: string[];
}

export function enrolledVoiceprint(): HeuristicVoiceprint {
  const vp = new HeuristicVoiceprint();
  for (let i = 0; i < 80; i++) {
    const drift = 1 + 0.08 * Math.sin(i / 5);
    vp.enrol(analyzeVoiceFrame(concatFrames(voice(130 * drift, i, 0.14, 1.0), voice(130 * drift, i + 1, 0.14, 1.0)), RATE));
  }
  return vp;
}

export interface RunOptions {
  /** Supply a neural VAD probability per 20 ms frame (browser only); null means heuristic. */
  vad?: (frame: Float32Array) => number | null;
}

export function runScenario(s: Scenario, options: RunOptions = {}): Outcome {
  const o: Outcome = { verdict: "SILENT", turns: 0, bargeReason: null, discarded: false, ducked: false, restored: false, resumed: false, finalState: "idle", watchdogs: [], events: [], transcripts: [] };
  const log = new EventLog(20_000);
  let replyAt = -1;
  const pipeline = new TurnPipeline({
    profile: s.profile ?? "lecture",
    verifier: s.unenrolled ? new HeuristicVoiceprint() : enrolledVoiceprint(),
    log,
    callbacks: {
      onDuck: () => { o.ducked = true; },
      onRestore: () => { o.restored = true; },
      onPauseTutor: (why) => { if (!o.bargeReason) o.bargeReason = why; },
      onResumeTutor: () => { o.resumed = true; },
      onEndTurn: (info) => { o.turns += 1; o.transcripts.push(info.transcript); if (!s.noResponse) replyAt = -2; },
      onDiscard: () => { o.discarded = true; },
      onWatchdog: (kind) => { o.watchdogs.push(kind); },
    },
  });
  pipeline.setTopicWords(["demand", "curve", "price", "quantity", "slope", "downward", "substitution"]);
  const [tsStart, tsEnd] = s.tutorSpeakingFrames ?? [-1, -1];
  const total = s.frames.length + (s.trailingFrames ?? 80);
  for (let i = 0; i < total; i++) {
    const now = i * FRAME_MS;
    const tutorSpeaking = i >= tsStart && i < tsEnd;
    pipeline.setTutor({ speaking: tutorSpeaking, expectingAnswer: Boolean(s.expectingAnswer), speakingAs: s.speakingAs }, now);
    // A reply begins 200 ms after a turn ends, unless the scenario withholds it.
    if (replyAt === -2) replyAt = now + 200;
    if (replyAt >= 0 && now >= replyAt) { pipeline.responseStarted(now); replyAt = -1; }
    const inGap = s.gap && i >= s.gap.start && i < s.gap.start + s.gap.count;
    if (inGap) {
      pipeline.tick(now);
    } else {
      const frame = i < s.frames.length ? s.frames[i] : silence();
      pipeline.push(frame, now, options.vad ? options.vad(frame) : null);
    }
    if (s.transcript && i === s.transcript.atFrame) pipeline.provideTranscript(s.transcript.text, s.transcript.final ?? true, now);
    if (s.transcript2 && i === s.transcript2.atFrame) pipeline.provideTranscript(s.transcript2.text, s.transcript2.final ?? true, now);
  }
  o.finalState = pipeline.state;
  o.events = log.toJSON();
  o.verdict = o.bargeReason ? "BARGE-IN" : o.turns > 0 ? "TURN" : "SILENT";
  return o;
}

const LECTURE: [number, number] = [0, 100_000];

export const SCENARIOS: Scenario[] = [
  // --- Environmental noise while the tutor teaches: none may even open a turn. ---
  { id: 1, name: "fan / AC running while the tutor teaches", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: seq(150, (i) => fan(0.35, i)) },
  { id: 2, name: "keyboard typing while the tutor teaches", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: seq(150, (i) => (i % 5 === 0 ? click(0.5) : silence())) },
  { id: 3, name: "TV / music in the background", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: seq(150, (i) => music(0.12, i)) },
  { id: 4, name: "traffic outside", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: seq(150, (i) => traffic(0.3, i)) },
  { id: 5, name: "a cough", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: [...seq(10, () => silence()), ...seq(4, (i) => STUDENT(i, 0.25)), ...seq(60, () => silence())] },
  { id: 6, name: "laughing (short bursts, 'haha')", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: seq(90, (i) => (i % 12 < 5 ? STUDENT(i, 0.18) : silence())), transcript: { text: "haha", atFrame: 40 } },
  { id: 7, name: "a phone notification", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: seq(80, (i) => ping(i, 10)) },

  // --- People in the room, not talking to the tutor. ---
  { id: 8, name: "friend talking to someone else", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: seq(90, (i) => FRIEND(i)), transcript: { text: "no it was on the table next to the keys", atFrame: 45 } },
  { id: 9, name: "friend talking to ME (not to the tutor)", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: seq(90, (i) => FRIEND(i)), transcript: { text: "hey are you coming to dinner", atFrame: 45 } },
  { id: 10, name: "me talking to my friend", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: seq(90, (i) => STUDENT(i)), transcript: { text: "hey Sam I'll call you back in a minute", atFrame: 45 } },
  { id: 11, name: "background conversation while the tutor is talking", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: seq(120, (i) => mix(FRIEND(i, 0.08), voice(170, i, 0.07, 0.7))), transcript: { text: "did you remember to send that email", atFrame: 50 } },
  { id: 12, name: "the tutor's own voice through the speakers", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: seq(120, (i) => ARIA(i, 0.12)) },
  { id: 13, name: "friend says a question, to someone else", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: seq(90, (i) => FRIEND(i)), transcript: { text: "what do you want for dinner?", atFrame: 45 } },

  // --- The student, genuinely talking to the tutor while she teaches: must barge in. ---
  { id: 14, name: "me interrupting with a question about the board", expect: "BARGE-IN", tutorSpeakingFrames: LECTURE, frames: seq(80, (i) => STUDENT(i)), transcript: { text: "wait, what does that step mean?", atFrame: 30 } },
  { id: 15, name: "saying her name mid-lecture", expect: "BARGE-IN", tutorSpeakingFrames: LECTURE, frames: seq(60, (i) => STUDENT(i)), transcript: { text: "aria", atFrame: 20, final: false } },
  { id: 16, name: "a short command: 'stop'", expect: "BARGE-IN", tutorSpeakingFrames: LECTURE, frames: seq(40, (i) => STUDENT(i)), transcript: { text: "stop", atFrame: 15 } },
  { id: 17, name: "whispering a request", expect: "BARGE-IN", tutorSpeakingFrames: LECTURE, frames: seq(80, (i) => STUDENT(i, 0.06)), transcript: { text: "can you slow down please", atFrame: 35 } },
  { id: 18, name: "overlapping speech: me over my friend", expect: "BARGE-IN", tutorSpeakingFrames: LECTURE, frames: seq(80, (i) => mix(STUDENT(i, 0.15), FRIEND(i, 0.06))), transcript: { text: "aria can you repeat that", atFrame: 35 } },
  { id: 19, name: "speaking with pauses and stutters", expect: "BARGE-IN", tutorSpeakingFrames: LECTURE, frames: seq(100, (i) => (i % 11 === 10 ? silence() : STUDENT(i))), transcript: { text: "so — so why is it, um, why is it negative?", atFrame: 60 } },
  { id: 20, name: "me over a running fan", expect: "BARGE-IN", tutorSpeakingFrames: LECTURE, frames: seq(80, (i) => mix(fan(0.3, i), STUDENT(i, 0.16))), transcript: { text: "why did that step change the sign?", atFrame: 35 } },
  { id: 21, name: "verified student keeps talking and the transcriber is silent", expect: "BARGE-IN", tutorSpeakingFrames: LECTURE, frames: seq(160, (i) => STUDENT(i)) },
  { id: 22, name: "UNVERIFIED voice keeps talking over the lecture, no words — no stop", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: seq(160, (i) => STUDENT(i)), unenrolled: true },
  { id: 23, name: "interim 'not for us' then final for-us — her name arrives late", expect: "BARGE-IN", tutorSpeakingFrames: LECTURE, frames: seq(90, (i) => STUDENT(i)), transcript: { text: "so the thing is", atFrame: 30, final: false }, transcript2: { text: "so the thing is aria I don't get it", atFrame: 60 } },

  // --- Tutor silent (planning / chat): turns must reach her, and only the right ones. ---
  { id: 24, name: "answering the tutor's question in planning", expect: "TURN", profile: "conversation", expectingAnswer: true, frames: seq(80, (i) => STUDENT(i)), transcript: { text: "I think it slopes down because people buy less", atFrame: 40 } },
  { id: 25, name: "a bare 'yes' to a yes/no question", expect: "TURN", profile: "conversation", expectingAnswer: true, frames: seq(30, (i) => STUDENT(i)), transcript: { text: "yes", atFrame: 12 } },
  { id: 26, name: "friend answers someone else while the tutor waits", expect: "SILENT", profile: "conversation", expectingAnswer: true, frames: seq(80, (i) => FRIEND(i)), transcript: { text: "it's in the kitchen drawer", atFrame: 40 } },
  { id: 27, name: "fan while the tutor waits for an answer", expect: "SILENT", profile: "conversation", expectingAnswer: true, frames: seq(150, (i) => fan(0.35, i)) },
  { id: 28, name: "asking something out of the blue while the tutor is idle", expect: "TURN", profile: "conversation", frames: seq(80, (i) => STUDENT(i)), transcript: { text: "aria, can you explain demand curves?", atFrame: 40 } },
  { id: 29, name: "me talking to my friend while the tutor is idle", expect: "SILENT", profile: "conversation", frames: seq(80, (i) => STUDENT(i)), transcript: { text: "hey Sam did you lock the door", atFrame: 40 } },
  { id: 30, name: "student speaks just after the tutor stops (echo guard must not swallow it)", expect: "TURN", profile: "conversation", expectingAnswer: true, tutorSpeakingFrames: [0, 8], frames: [...seq(8, (i) => ARIA(i)), ...seq(80, (i) => STUDENT(i))], transcript: { text: "the second one", atFrame: 50 } },
  { id: 31, name: "friend directly addresses the tutor but is not the enrolled student", expect: "SILENT", tutorSpeakingFrames: LECTURE, frames: seq(80, (i) => FRIEND(i)), transcript: { text: "Aria, stop the lecture", atFrame: 40 } },

  // --- New: turn-taking patterns the brief named. ---
  { id: 32, name: "a natural pause mid-sentence (800 ms) stays ONE turn", expect: "TURN", expectTurns: 1, profile: "conversation", expectingAnswer: true,
    frames: [...seq(60, (i) => STUDENT(i)), ...seq(40, () => silence()), ...seq(50, (i) => STUDENT(i + 100))],
    transcript: { text: "I think it slopes down because", atFrame: 55, final: false }, transcript2: { text: "I think it slopes down because people buy less", atFrame: 135 },
    note: "the interim ends in 'because', so the endpointer tolerates a longer pause" },
  { id: 33, name: "a real stop (1.4 s) then a second question is TWO turns", expect: "TURN", expectTurns: 2, profile: "conversation", expectingAnswer: true,
    frames: [...seq(60, (i) => STUDENT(i)), ...seq(70, () => silence()), ...seq(50, (i) => STUDENT(i + 130))],
    transcript: { text: "yes I think so", atFrame: 40 }, transcript2: { text: "and what about the supply curve?", atFrame: 160 } },
  { id: 34, name: "microphone drops mid-turn: the question is delivered, nothing sticks", expect: "TURN", expectWatchdog: "mic-stalled", profile: "conversation",
    frames: seq(100, (i) => STUDENT(i)), gap: { start: 45, count: 120 }, transcript: { text: "aria why is it negative", atFrame: 30 } },
  { id: 35, name: "25 s of voice with no words: the utterance is ended, never stuck listening", expect: "TURN", expectWatchdog: "max-utterance", profile: "conversation",
    frames: seq(1250, (i) => STUDENT(i)), trailingFrames: 100 },
  { id: 36, name: "barge-in on the tutor's REPLY needs less than on a lecture (verified voice, 600 ms)", expect: "BARGE-IN", profile: "conversation", tutorSpeakingFrames: LECTURE, speakingAs: "reply",
    frames: seq(60, (i) => STUDENT(i)) },
  { id: 37, name: "no reply ever arrives: the lecture resumes instead of hanging", expect: "BARGE-IN", expectWatchdog: "response-timeout", tutorSpeakingFrames: [0, 40], noResponse: true,
    frames: seq(50, (i) => STUDENT(i)), transcript: { text: "aria wait what", atFrame: 20 }, trailingFrames: 520 },
  { id: 38, name: "a long think (1.5 s of silence) before answering", expect: "TURN", expectTurns: 1, profile: "conversation", expectingAnswer: true,
    frames: [...seq(75, () => silence()), ...seq(60, (i) => STUDENT(i))], transcript: { text: "the second one", atFrame: 100 } },
  { id: 39, name: "'um', a 500 ms pause, then the real question — one barge-in", expect: "BARGE-IN", expectTurns: 1, tutorSpeakingFrames: LECTURE,
    frames: seq(90, (i) => (i >= 15 && i < 40 ? silence() : STUDENT(i))), transcript: { text: "um", atFrame: 12, final: false }, transcript2: { text: "um why is it negative?", atFrame: 70 } },
  { id: 40, name: "friend talks over the tutor's reply — not the student, no barge-in", expect: "SILENT", profile: "conversation", tutorSpeakingFrames: LECTURE, speakingAs: "reply",
    frames: seq(90, (i) => FRIEND(i)), transcript: { text: "no it was on the table", atFrame: 45 } },
];

export function scoreScenario(s: Scenario, o: Outcome): { pass: boolean; why: string } {
  const problems: string[] = [];
  if (o.verdict !== s.expect) problems.push(`verdict ${o.verdict}, expected ${s.expect}${o.bargeReason ? ` (barge: ${o.bargeReason})` : ""}`);
  if (s.expectTurns !== undefined && o.turns !== s.expectTurns) problems.push(`${o.turns} turn(s), expected ${s.expectTurns}`);
  if (s.expectWatchdog && !o.watchdogs.includes(s.expectWatchdog)) problems.push(`watchdog ${s.expectWatchdog} did not fire`);
  if (o.ducked && !o.restored && !o.bargeReason) problems.push("ducked but never restored");
  if (o.finalState !== "idle" && o.finalState !== "refractory") problems.push(`ended in ${o.finalState}`);
  return { pass: problems.length === 0, why: problems.join("; ") };
}
