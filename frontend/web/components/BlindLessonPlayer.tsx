"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { beats as demoBeats, type Beat } from "@/lib/lessonContent";
import { playNarration, unlockAudio, type NarrationHandle } from "@/lib/voice";
import { getBlindBeatContent } from "@/lib/blindLectureContent";
import { playCue, unlockSonicCues } from "@/lib/sonicCues";
import { createLocalVad, type LocalVadController, type VadState } from "@/lib/localVad";
import { getSpeechRecognition, type SpeechRecognitionLike } from "@/lib/speech";
import { HudCorners } from "./hud/HudKit";

/**
 * A genuinely separate, audio-first lecture player for blind students — not the sighted
 * LessonPlayer with labels added. There is no visual board. The teaching itself is
 * different in kind: every concept that would have been drawn is instead spoken as a
 * structural description (lib/blindLectureContent.ts), marked with a distinct non-speech
 * sonic cue (lib/sonicCues.ts) so the student builds intuition through sound as well as
 * words, and the student is never more than ~2 beats away from a response point — either
 * a real checkpoint or a brief spoken comprehension ping.
 *
 * Sequence per beat: script -> (if a checkpoint) cue + prompt + wait for typed answer,
 * retried on a wrong answer same as the sighted player; (otherwise) audio description with
 * its cue, then an optional quick yes/no ping that pauses for any keypress before advancing.
 */

const MAX_ATTEMPTS = 2;
type CheckpointResult = { correct: boolean; feedback: string; revealed?: boolean } | null;

function checkAnswer(beat: Beat, answer: string): CheckpointResult {
  if (!beat.checkpoint) return null;
  const lower = answer.toLowerCase();
  const matched = beat.checkpoint.acceptableKeywords.some((set) => set.every((kw) => lower.includes(kw)));
  return matched
    ? { correct: true, feedback: beat.checkpoint.correctFeedback }
    : { correct: false, feedback: beat.checkpoint.hintFeedback };
}

type Phase = "script" | "description" | "checkpoint-prompt" | "waiting-answer" | "feedback" | "done";
type ConversationState = "lecture" | "nova-speaking" | "barge-detected" | "listening-turn" | "thinking" | "responding" | "resume";

// The wake name is deliberately strict: commands only act after a whole-word "Nova".
// That prevents background noise, narration, or nearby conversation from pausing the lecture.
const WAKE_WORDS = ["hey nova", "okay nova", "ok nova", "nova"];

function normalizeSpeech(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9'\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phraseRegex(phrase: string) {
  return new RegExp(`(^|\\s)${phrase.replace(/\s+/g, "\\s+")}(?=$|\\s)`, "i");
}

function speechMatches(text: string, words: string[]) {
  return words.some((w) => phraseRegex(w).test(text));
}

export function BlindLessonPlayer({
  onExit,
  beats = demoBeats,
  title = "Photosynthesis",
  autoStart = false,
}: {
  onExit?: () => void;
  beats?: Beat[];
  title?: string;
  autoStart?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [phase, setPhase] = useState<Phase>("script");
  const [announcement, setAnnouncement] = useState("Press Space to begin the lecture.");
  const [checkpointResult, setCheckpointResult] = useState<CheckpointResult>(null);
  const [checkpointAttempts, setCheckpointAttempts] = useState(0);
  const [answerValue, setAnswerValue] = useState("");
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  const [awaitingQuickCheckKey, setAwaitingQuickCheckKey] = useState(false);
  // Continuous voice control: the mic is hot for the whole session so the student drives
  // everything by voice ("start", "stop", spoken answers). `micOn` reflects whether the
  // always-listening loop is running; `micSupported` is false on browsers without the API.
  const [micOn, setMicOn] = useState(false);
  const [heard, setHeard] = useState("");
  const [micSupported, setMicSupported] = useState<boolean>(() => getSpeechRecognition() !== null);
  const [vadState, setVadState] = useState<VadState>("idle");
  const [conversationState, setConversationState] = useState<ConversationState>("lecture");

  const cancelRef = useRef<NarrationHandle | null>(null);
  const speechRunRef = useRef(0);
  const autoStartedRef = useRef(false);
  const answerInputRef = useRef<HTMLInputElement | null>(null);
  // Echo guard: true while Aria's TTS is playing, so the mic doesn't process her own voice
  // coming back through the speakers as a command.
  const speakingRef = useRef(false);
  const beat = beats[index];
  const isCheckpoint = beat.slideKind === "checkpoint";
  const content = getBlindBeatContent(beat, beats[index + 1]);

  const speak = useCallback(
    (text: string, onEnd: () => void) => {
      speechRunRef.current += 1;
      const runId = speechRunRef.current;
      cancelRef.current?.cancel();
      cancelRef.current = null;
      speakingRef.current = true;
      const handle = playNarration(text, {
        onStart: () => {
          vadRef.current?.setCooldown(900);
          setConversationState("nova-speaking");
          if (speechRunRef.current === runId) setAnnouncement(text);
        },
        onEnd: () => {
          if (speechRunRef.current !== runId) return;
          speakingRef.current = false;
          cancelRef.current = null;
          vadRef.current?.setCooldown(900);
          setConversationState("resume");
          onEnd();
        },
        onBlocked: () => {
          if (speechRunRef.current === runId) {
            setVoiceBlocked(true);
            setPlaying(false);
          }
        },
      });
      cancelRef.current = handle;
    },
    []
  );

  const stopVoice = useCallback(() => {
    speechRunRef.current += 1;
    cancelRef.current?.cancel();
    cancelRef.current = null;
    speakingRef.current = false;
    vadRef.current?.setCooldown(450);
    setConversationState("lecture");
  }, []);

  // Mirror the current control state into refs so the always-on recognition handler (wired
  // up once) can route a spoken phrase against the live state without being re-subscribed.
  const stateRef = useRef({ playing, phase, isCheckpoint, awaitingQuickCheckKey, index });
  stateRef.current = { playing, phase, isCheckpoint, awaitingQuickCheckKey, index };
  // Stable refs to the beats + title so the memoized remote-interpreter can read the CURRENT
  // beat's context without being re-created (and re-subscribed) on every render.
  const beatsRef = useRef(beats);
  beatsRef.current = beats;
  const titleRef = useRef(title);
  titleRef.current = title;

  // Each phase step is resolved into the NEXT real phase before any setState happens, so
  // the effect below only ever calls setState from an async callback (speak's onEnd, or a
  // timer) — never synchronously just to skip past an empty phase. That's what keeps this
  // clear of the "setState synchronously in an effect" cascading-render trap: a phase that
  // has nothing to do (no audio description, no quick-check) is folded into the previous
  // step's callback chain instead of becoming its own effect run.
  function runDescriptionThenQuickCheck() {
    const goToQuickCheck = () => {
      if (!content.quickCheck) {
        advanceBeat();
      } else {
        setAwaitingQuickCheckKey(true);
        speak(content.quickCheck, () => {});
      }
    };
    if (!content.audioDescription) {
      goToQuickCheck();
      return;
    }
    if (content.cueTiming === "before") playCue(content.cue);
    speak(content.audioDescription, () => {
      if (content.cueTiming === "after") playCue(content.cue);
      goToQuickCheck();
    });
  }

  // Drives the whole sequence. Re-runs whenever the beat or phase changes while playing.
  useEffect(() => {
    if (!playing) return;

    if (phase === "script") {
      speak(beat.script, () => {
        if (isCheckpoint) {
          playCue("checkpoint");
          setPhase("checkpoint-prompt");
        } else {
          setPhase("description");
        }
      });
      return;
    }

    if (phase === "description") {
      runDescriptionThenQuickCheck();
      return;
    }

    if (phase === "checkpoint-prompt" && beat.checkpoint) {
      speak(beat.checkpoint.prompt, () => {
        setPhase("waiting-answer");
        window.setTimeout(() => answerInputRef.current?.focus(), 50);
      });
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, phase, index]);

  function advanceBeat() {
    setAwaitingQuickCheckKey(false);
    setCheckpointResult(null);
    setCheckpointAttempts(0);
    setAnswerValue("");
    if (index < beats.length - 1) {
      setIndex((i) => i + 1);
      setPhase("script");
    } else {
      setPhase("done");
      setAnnouncement("That's the end of the lecture. Press R to restart, or Escape to exit.");
    }
  }

  function submitAnswer(answer: string = answerValue) {
    const trimmed = answer.trim();
    if (!trimmed || !beat.checkpoint) return;
    const result = checkAnswer(beat, trimmed);
    setCheckpointResult(result);
    setPhase("feedback");
    if (result?.correct) {
      playCue("correct");
      speak(result.feedback, () => window.setTimeout(advanceBeat, 400));
    } else {
      playCue("incorrect");
      const attempts = checkpointAttempts + 1;
      setCheckpointAttempts(attempts);
      const exhausted = attempts >= MAX_ATTEMPTS;
      const toSay = exhausted ? `${result?.feedback} ${beat.checkpoint.revealAnswer}` : result?.feedback ?? "";
      speak(toSay, () => {
        if (exhausted) {
          window.setTimeout(advanceBeat, 600);
        } else {
          setPhase("waiting-answer");
          setAnswerValue("");
          window.setTimeout(() => answerInputRef.current?.focus(), 50);
        }
      });
    }
  }

  function start() {
    unlockAudio();
    unlockSonicCues();
    setVoiceBlocked(false);
    setPlaying(true);
    if (micSupported && !micWantedRef.current) startMic();
  }

  function restart() {
    stopVoice();
    setIndex(0);
    setPhase("script");
    setCheckpointResult(null);
    setCheckpointAttempts(0);
    setAnswerValue("");
    setAwaitingQuickCheckKey(false);
    setPlaying(true);
  }

  function repeatDescription() {
    stopVoice();
    if (content.audioDescription) {
      speak(content.audioDescription, () => {});
    } else {
      speak(beat.script, () => {});
    }
  }

  // "Nova, explain this" — give the student a fuller explanation of the current beat: the
  // script AND its richer structural audio description, spoken together. No API cost; uses
  // the in-depth content already written for this beat.
  function explainThis() {
    stopVoice();
    const parts = [beat.script];
    if (content.audioDescription) parts.push(content.audioDescription);
    const full = parts.join(" ");
    // Speak this directly instead of toggling normal playback on. If playback was paused
    // by "Nova" or "Nova, stop", setting `playing` true would also restart the beat effect
    // underneath the explanation and could cancel this custom response.
    speak(`Here's a fuller explanation. ${full}`, () => {});
  }

  function goToBeat(newIndex: number) {
    if (newIndex < 0 || newIndex >= beats.length) return;
    stopVoice();
    setAwaitingQuickCheckKey(false);
    setCheckpointResult(null);
    setCheckpointAttempts(0);
    setAnswerValue("");
    setIndex(newIndex);
    setPhase("script");
    setPlaying(true);
  }

  // ── WAKE-WORD ("Nova") ─────────────────────────────────────────────────────
  // Like a voice assistant: the mic is always hot, but nothing acts until the student says
  // the wake-word "Nova". They can say it WITH a command in one breath ("Nova, explain this",
  // "Nova, stop") or say "Nova" alone — which chimes and opens a short window to catch the
  // command in a following breath. This stops the lecture's own narration and random speech
  // from ever triggering commands by accident.
  // How long (ms) after a bare "Nova" we keep listening for the command before giving up.
  const WAKE_WINDOW_MS = 6000;
  // True while we've heard "Nova" and are waiting for the command that follows.
  const [awaitingCommand, setAwaitingCommand] = useState(false);
  const awaitingCommandRef = useRef(false);
  awaitingCommandRef.current = awaitingCommand;
  const wakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasPlayingBeforeWakeRef = useRef(false);
  const commandWindowFreeformRef = useRef(true);
  const resumeAfterCommandWindowRef = useRef(false);

  // Routes one finalized spoken phrase to an action, based on the live control state. The
  // command words ("start", "stop", "next"…) are checked first; in a checkpoint's
  // waiting-answer phase, anything that isn't a command is treated as the spoken answer.
  const COMMANDS = {
    start: ["start", "begin", "play", "resume", "continue", "go ahead", "keep going", "let's go", "lets go"],
    stop: ["stop", "pause", "wait", "hold on", "be quiet", "quiet", "shush"],
    next: ["next", "skip", "move on", "forward"],
    back: ["back", "previous", "go back"],
    repeat: ["repeat", "again", "say that again", "one more time"],
    explain: ["explain this", "explain that", "explain me", "explain", "re explain", "reexplain", "what does this mean", "tell me more", "i don't understand", "i dont understand", "more detail", "elaborate"],
    restart: ["restart", "start over", "from the beginning"],
    exit: ["exit", "quit", "close", "leave"],
    continue: ["continue", "yes", "yeah", "got it", "okay", "ok", "understood", "i'm following", "im following"],
  };
  // Strips the wake-word (and everything before it) off a phrase, leaving just the command:
  // "nova, stop" -> "stop", "um nova next" -> "next". Uses the wake-word's position so a
  // student who says a filler word before "Nova" still gets a clean command.
  const stripWakeWord = (text: string): string => {
    const normalized = normalizeSpeech(text);
    let best = -1;
    let bestEnd = 0;
    for (const w of WAKE_WORDS) {
      const match = phraseRegex(w).exec(normalized);
      const idx = match?.index ?? -1;
      // Prefer the EARLIEST wake-word; on a tie prefer the LONGEST (so "hey nova" beats "nova").
      if (match && (best === -1 || idx < best || (idx === best && idx + match[0].length > bestEnd))) {
        best = idx;
        bestEnd = idx + match[0].length;
      }
    }
    if (best === -1) return normalized.trim();
    let rest = normalized.slice(bestEnd);
    // Drop a possessive "'s" only when it's directly attached to the wake-word ("nova's stop").
    rest = rest.replace(/^'s\b/, "");
    // Drop separating whitespace/punctuation — but NOT letters, so "start"/"stop" stay intact.
    return rest.trim();
  };

  const clearWakeTimer = () => {
    if (wakeTimerRef.current) { clearTimeout(wakeTimerRef.current); wakeTimerRef.current = null; }
  };

  // Identifies which command a phrase matches (wake-word already stripped), or null. Order
  // matters: "explain" is checked before "stop"/"start" etc. so multi-word commands win.
  const commandKey = (text: string): keyof typeof COMMANDS | null => {
    if (!text) return null;
    if (speechMatches(text, COMMANDS.exit)) return "exit";
    if (speechMatches(text, COMMANDS.restart)) return "restart";
    if (speechMatches(text, COMMANDS.explain)) return "explain";
    if (speechMatches(text, COMMANDS.stop)) return "stop";
    if (speechMatches(text, COMMANDS.start)) return "start";
    if (speechMatches(text, COMMANDS.next)) return "next";
    if (speechMatches(text, COMMANDS.back)) return "back";
    if (speechMatches(text, COMMANDS.repeat)) return "repeat";
    if (speechMatches(text, COMMANDS.continue)) return "start";
    return null;
  };

  // Runs an actual command phrase (wake-word already stripped). Returns true if it matched.
  const runCommand = (text: string): boolean => {
    const s = stateRef.current;
    const key = commandKey(text);
    switch (key) {
      case "exit": stopVoice(); onExit?.(); return true;
      case "restart": restart(); return true;
      case "explain": explainThis(); return true;
      case "stop":
        // Always cut the audio, even if React still thinks we're mid-transition.
        stopVoice();
        setPlaying(false);
        setAnnouncement('Paused. Say "Nova, start" to continue.');
        return true;
      case "start": if (!s.playing) start(); return true;
      case "next": goToBeat(s.index + 1); return true;
      case "back": goToBeat(s.index - 1); return true;
      case "repeat": repeatDescription(); return true;
      default: return false;
    }
  };

  // Bare "Nova": chime, pause narration, and open a short window to catch the command that
  // follows in the next breath. If nothing comes, quietly resume where we were.
  const enterCommandWindow = ({
    allowFreeform = true,
    resumeOnTimeout = false,
  }: { allowFreeform?: boolean; resumeOnTimeout?: boolean } = {}) => {
    clearWakeTimer();
    playCue("wake");
    wasPlayingBeforeWakeRef.current = stateRef.current.playing;
    commandWindowFreeformRef.current = allowFreeform;
    resumeAfterCommandWindowRef.current = resumeOnTimeout;
    // Pause Aria so she isn't talking over the student's command.
    stopVoice();
    setPlaying(false);
    setAwaitingCommand(true);
    setConversationState("listening-turn");
    setAnnouncement("Listening… ask me anything, or say a command like “repeat”, “next”, or “stop”.");
    wakeTimerRef.current = setTimeout(() => {
      setAwaitingCommand(false);
      wakeTimerRef.current = null;
      // Nothing said — resume the beat if we were mid-lecture.
      if (wasPlayingBeforeWakeRef.current && resumeAfterCommandWindowRef.current) {
        setAnnouncement("Resuming.");
        setPlaying(true);
      } else if (wasPlayingBeforeWakeRef.current) {
        setAnnouncement('No command heard. Say "Nova, start" to continue.');
      } else {
        setAnnouncement('Say "Nova" then a command whenever you\'re ready.');
      }
      setConversationState("resume");
      resumeAfterCommandWindowRef.current = false;
      commandWindowFreeformRef.current = true;
    }, WAKE_WINDOW_MS);
  };

  // De-dup: a phrase is heard first as interim (possibly many times) and again when finalized.
  // We act on the interim so commands feel instant, then suppress the same command from firing
  // again for a short cooldown.
  const lastActionRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const ACTION_COOLDOWN_MS = 1800;
  const recentlyFired = (key: string): boolean => {
    const now = Date.now();
    if (lastActionRef.current.key === key && now - lastActionRef.current.at < ACTION_COOLDOWN_MS) return true;
    lastActionRef.current = { key, at: now };
    return false;
  };

  // OBVIOUS commands fire INSTANTLY and locally (no round-trip): a short phrase that clearly is
  // just a control word. Anything longer or fuzzier ("go over the leaf again", "I'm lost on the
  // light part") is sent to OpenAI to interpret. Keeping the obvious ones local means "Nova,
  // stop" is still instant, while you can also say anything and Nova figures it out.
  const isObviousCommand = (cmd: string): boolean => {
    const words = cmd.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 3) return false; // long phrases -> let the model read intent
    const key = commandKey(cmd);
    // "explain" is intentionally NOT obvious — an explanation should be a tailored AI answer.
    return key !== null && key !== "explain";
  };

  // Whether we're waiting on the OpenAI interpreter (shown as a "thinking" state, spoken too).
  const [thinking, setThinking] = useState(false);

  // Sends whatever the student said after "Nova" to the interpreter, then acts on the result:
  // a control action runs locally; an "answer" is spoken aloud as a fresh explanation.
  const interpretRemotely = useCallback(async (phrase: string) => {
    const s = stateRef.current;
    stopVoice();
    setThinking(true);
    setConversationState("thinking");
    setAnnouncement("One moment…");
    playCue("wake");
    const beatContext = `${beatsRef.current[s.index]?.title ?? ""}: ${beatsRef.current[s.index]?.script ?? ""}`;
    try {
      const res = await fetch("/api/voice-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: phrase, topic: titleRef.current, beatContext }),
      });
      const data = (await res.json().catch(() => ({}))) as { action?: string; answer?: string; error?: string };
      setThinking(false);
      if (!res.ok || !data.action) {
        setAnnouncement('Sorry, I didn\'t catch that. Say "Nova" and try again.');
        return;
      }
      switch (data.action) {
        case "stop": case "start": case "next": case "back": case "repeat": case "restart": case "exit":
          runCommand(data.action);
          return;
        case "answer":
          if (data.answer) {
            setConversationState("responding");
            speak(data.answer, () => {});
          } else {
            repeatDescription();
          }
          return;
        default:
          setAnnouncement('I\'m not sure what you meant. Say "Nova" and try again.');
      }
    } catch {
      setThinking(false);
      setConversationState("resume");
      setAnnouncement('I couldn\'t reach the assistant. Say "Nova" and try again.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speak, stopVoice]);

  // Recreated every render (not memoized) so it always closes over the CURRENT beat,
  // answerValue, and action functions. The always-on recognition reads it through
  // handlerRef.current (below) so it never calls a stale version.
  //
  // WAKE-WORD GATE: nothing acts unless the student has said "Nova" — either in this same
  // phrase ("Nova, stop") or just before (bare "Nova" opened a command window). There is
  // no exception for checkpoints: spoken answers must also start with "Nova".
  //
  // `isFinal` = the recognizer settled this phrase (spoken pause). We ALSO run on interim
  // (isFinal=false) so wake-word commands fire the instant they're heard, without waiting for
  // the pause — but interim only acts on clear wake-word commands, never on free-form answers.
  const handleVoiceCommand = (raw: string, isFinal: boolean) => {
    const text = normalizeSpeech(raw);
    if (!text) return;
    const s = stateRef.current;

    // (1) We're already awaiting a command after a bare "Nova" — this phrase IS the command.
    if (awaitingCommandRef.current) {
      const cmd = stripWakeWord(text); // tolerate the student repeating "Nova" here too
      const phraseHadWake = speechMatches(text, WAKE_WORDS);
      if (isFinal && commandKey(cmd) === "explain") {
        if (recentlyFired("win:explain")) return;
        clearWakeTimer();
        setAwaitingCommand(false);
        explainThis();
        return;
      }
      // Obvious control word -> fire instantly (even on interim, so it feels snappy).
      if (isObviousCommand(cmd)) {
        const key = commandKey(cmd)!;
        if (recentlyFired("win:" + key)) return;
        clearWakeTimer();
        setAwaitingCommand(false);
        runCommand(cmd);
        return;
      }
      // Anything else waits for the FINAL phrase, then goes to the interpreter (or is taken as a
      // checkpoint answer if we're waiting for one).
      if (!isFinal) return;
      if (!cmd) return;
      if (!commandWindowFreeformRef.current && !phraseHadWake) {
        setAnnouncement('Listening… say "Nova" before a question, or say a command like "stop", "repeat", or "explain".');
        return;
      }
      clearWakeTimer();
      setAwaitingCommand(false);
      if (s.playing && s.isCheckpoint && s.phase === "waiting-answer" && !speakingRef.current) {
        submitAnswer(cmd);
        return;
      }
      if (cmd) {
        if (recentlyFired("remote:" + cmd)) return;
        void interpretRemotely(cmd);
      }
      return;
    }

    const hasWake = speechMatches(text, WAKE_WORDS);

    // (2) A pending comprehension ping just needs acknowledgement — say "Nova" to advance.
    if (s.awaitingQuickCheckKey && hasWake) {
      const cmd = stripWakeWord(text);
      const key = commandKey(cmd);
      if (cmd && key && key !== "start") {
        if (recentlyFired("quickcheck:" + key)) return;
        setAwaitingQuickCheckKey(false);
        runCommand(cmd);
        return;
      }
      if (cmd && key === "explain" && isFinal) {
        if (recentlyFired("quickcheck:explain")) return;
        setAwaitingQuickCheckKey(false);
        explainThis();
        return;
      }
      if (cmd && !key && isFinal) {
        if (recentlyFired("quickcheck:remote:" + cmd)) return;
        setAwaitingQuickCheckKey(false);
        void interpretRemotely(cmd);
        return;
      }
      if (recentlyFired("quickcheck")) return;
      setAwaitingQuickCheckKey(false);
      stopVoice();
      advanceBeat();
      return;
    }

    // (3) Spoken checkpoint answers also require "Nova". If the student says an answer without
    // the wake name, ignore it exactly like background noise.

    // (4) Everything else MUST contain the wake-word, or it's ignored entirely.
    if (!hasWake) return;
    const cmd = stripWakeWord(text);
    if (!cmd && !isFinal && (s.playing || speakingRef.current)) {
      if (recentlyFired("wake:interim")) return;
      enterCommandWindow();
    } else if (isFinal && commandKey(cmd) === "explain") {
      if (recentlyFired("cmd:explain")) return;
      explainThis();
    } else if (isObviousCommand(cmd)) {
      // "Nova, stop" / "Nova, next" — obvious control word, fire instantly (interim or final).
      const key = commandKey(cmd)!;
      if (recentlyFired("cmd:" + key)) return;
      runCommand(cmd);
    } else if (cmd && isFinal && s.playing && s.isCheckpoint && s.phase === "waiting-answer" && !speakingRef.current) {
      if (recentlyFired("answer:" + cmd)) return;
      submitAnswer(cmd);
    } else if (cmd && isFinal) {
      // "Nova, <anything else>" — a fuzzy request or a real question. Wait for the FINAL phrase
      // (so we have the whole thing) and let OpenAI interpret it: control action or spoken answer.
      if (recentlyFired("remote:" + cmd)) return;
      void interpretRemotely(cmd);
    } else if (!cmd && isFinal) {
      // Bare "Nova" with a real pause after it (FINAL only) — chime and open the command window.
      if (recentlyFired("wake")) return;
      enterCommandWindow();
    }
    // "Nova <partial>" on interim — wait for more speech.
  };
  // Always points at the latest handleVoiceCommand so the recognition handler (wired once)
  // never invokes a stale closure.
  const handlerRef = useRef(handleVoiceCommand);
  handlerRef.current = handleVoiceCommand;

  const vadStatus =
    conversationState === "thinking"
      ? "Nova is thinking."
      : conversationState === "responding"
      ? "Nova is answering."
      : conversationState === "barge-detected"
      ? "Barge-in detected."
      : conversationState === "listening-turn"
      ? "Listening to your turn."
      : vadState === "speaking"
      ? "Voice activity detected."
      : vadState === "cooldown"
      ? "Nova is avoiding echo."
      : vadState === "listening"
      ? "VAD listening."
      : "";

  // The always-on microphone. Once started it stays hot for the whole session. Browsers
  // still end speech-recognition sessions after pauses or while page audio is playing, so
  // each end/error schedules a brand-new recognizer instead of relying on one fragile object.
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const micWantedRef = useRef(false);
  const micRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micHealthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const micSessionRef = useRef(0);
  const vadRef = useRef<LocalVadController | null>(null);

  const clearMicRestartTimer = () => {
    if (micRestartTimerRef.current) {
      clearTimeout(micRestartTimerRef.current);
      micRestartTimerRef.current = null;
    }
  };

  const detachRecognition = (recognition: SpeechRecognitionLike | null) => {
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
  };

  const scheduleMicRestart = (session: number, delay = 350) => {
    clearMicRestartTimer();
    micRestartTimerRef.current = setTimeout(() => {
      micRestartTimerRef.current = null;
      if (!micWantedRef.current || micSessionRef.current !== session) return;
      startRecognitionSession();
    }, delay);
  };

  const refreshRecognitionAfterVadSpeech = () => {
    clearMicRestartTimer();
    micRestartTimerRef.current = setTimeout(() => {
      micRestartTimerRef.current = null;
      if (micWantedRef.current) startRecognitionSession();
    }, 120);
  };

  async function startVadDetector() {
    if (vadRef.current) return;
    const vad = createLocalVad({
      minSpeechMs: 180,
      silenceMs: 650,
      cooldownMs: 900,
      thresholdMultiplier: 2.2,
      minThreshold: 0.035,
      shouldDetectSpeech: () => {
        const lectureIsTalking = speakingRef.current || stateRef.current.playing;
        return micWantedRef.current && (lectureIsTalking || awaitingCommandRef.current);
      },
      onEvent: (event) => {
        if (event.type === "state") {
          setVadState(event.state);
          return;
        }
        if (event.type === "speechstart") {
          if (!awaitingCommandRef.current && (speakingRef.current || stateRef.current.playing)) {
            setConversationState("barge-detected");
            enterCommandWindow({ allowFreeform: false, resumeOnTimeout: true });
            setHeard("Voice detected. Listening now...");
            refreshRecognitionAfterVadSpeech();
          } else if (awaitingCommandRef.current) {
            setConversationState("listening-turn");
          }
          return;
        }
        if (event.type === "speechend" && awaitingCommandRef.current) {
          setConversationState("thinking");
          setHeard((current) => current || "Speech ended. Waiting for words...");
        }
      },
    });
    vadRef.current = vad;
    const started = await vad.start();
    if (!started && vadRef.current === vad) {
      vadRef.current = null;
      setVadState("idle");
    }
  }

  function stopVadDetector() {
    vadRef.current?.stop();
    vadRef.current = null;
    setVadState("idle");
  }

  function startRecognitionSession() {
    if (!micWantedRef.current) return;
    const recognition = getSpeechRecognition();
    if (!recognition) {
      setMicSupported(false);
      setMicOn(false);
      micWantedRef.current = false;
      return;
    }

    const previous = recognitionRef.current;
    detachRecognition(previous);
    try { previous?.stop(); } catch { /* ignore */ }

    const session = micSessionRef.current + 1;
    micSessionRef.current = session;
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          // The router itself applies the echo guard: explicit commands (like "stop") always
          // act, but free-form speech is only taken as an answer when Aria isn't speaking.
          handlerRef.current(transcript, true);
          setHeard("");
        } else {
          interim += transcript;
        }
      }
      // Act on INTERIM speech too — the Web Speech API only finalizes a result after a pause,
      // so waiting for `isFinal` made the student say "Nova … start" as two turns and made
      // "Nova, stop" not register until Aria stopped on her own. Firing a wake-word command as
      // soon as it appears in the interim transcript makes it feel instant. handleVoiceCommand
      // de-dupes so the same phrase isn't run again when it later finalizes.
      if (interim) {
        handlerRef.current(interim, false);
        const heardWake = speechMatches(normalizeSpeech(interim), WAKE_WORDS);
        if (heardWake || awaitingCommandRef.current) setHeard(interim);
        else setHeard("");
      }
    };
    recognition.onerror = (event) => {
      if (micSessionRef.current !== session) return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        micWantedRef.current = false;
        setMicOn(false);
        setAnnouncement("Microphone permission is blocked. Allow the microphone to use Nova.");
        return;
      }
      // Chrome often ends recognition while page audio is playing. Start a fresh recognizer
      // instead of trusting the same object to recover.
      scheduleMicRestart(session, 500);
    };
    recognition.onend = () => {
      // Auto-restart so the mic stays continuously live, unless we intentionally stopped it.
      if (micWantedRef.current && micSessionRef.current === session) {
        scheduleMicRestart(session);
      }
    };

    try {
      recognition.start();
      setMicOn(true);
    } catch {
      scheduleMicRestart(session, 500);
    }
  }

  const startMic = useCallback(() => {
    if (micWantedRef.current) return;
    micWantedRef.current = true;
    startRecognitionSession();
    void startVadDetector();
    micHealthTimerRef.current ??= setInterval(() => {
      if (!micWantedRef.current) return;
      if (!recognitionRef.current) startRecognitionSession();
    }, 1500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopMic = useCallback(() => {
    micWantedRef.current = false;
    micSessionRef.current += 1;
    clearMicRestartTimer();
    if (micHealthTimerRef.current) {
      clearInterval(micHealthTimerRef.current);
      micHealthTimerRef.current = null;
    }
    setMicOn(false);
    setHeard("");
    const r = recognitionRef.current;
    recognitionRef.current = null;
    detachRecognition(r);
    if (r) { try { r.stop(); } catch { /* ignore */ } }
    stopVadDetector();
  }, []);

  // Open the mic automatically as soon as the Blind player mounts. In generated Blind
  // lectures, `autoStart` also begins the first beat immediately so a blind learner is not
  // stranded on a visual "Start lecture" button after already speaking the topic.
  useEffect(() => {
    if (!micSupported) return;
    const t = setTimeout(() => {
      startMic();
      if (autoStart && !autoStartedRef.current) {
        autoStartedRef.current = true;
        start();
        setAnnouncement('Starting the lecture now. Say "Nova, stop" any time to pause, or "Nova, explain this" for more detail.');
      } else {
        setAnnouncement('Microphone is on. Say "Nova, start" to begin the lecture. Say "Nova" any time to give a command.');
      }
    }, 300);
    return () => { clearTimeout(t); stopMic(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Full keyboard control: Space play/pause, arrows skip beats, R restart, A repeat the
  // description, Escape exit. Any key clears a pending quick-check (the comprehension
  // ping just needs acknowledgement, not a specific answer).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const typing = document.activeElement === answerInputRef.current;
      if (awaitingQuickCheckKey && !typing) {
        e.preventDefault();
        setAwaitingQuickCheckKey(false);
        stopVoice();
        advanceBeat();
        return;
      }
      if (typing) return; // let the answer input handle its own keys (Enter submits via form)

      if (e.code === "Space") {
        e.preventDefault();
        if (!playing) start();
        else {
          stopVoice();
          setPlaying(false);
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToBeat(index + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToBeat(index - 1);
      } else if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        restart();
      } else if (e.key.toLowerCase() === "a") {
        e.preventDefault();
        repeatDescription();
      } else if (e.key.toLowerCase() === "e") {
        e.preventDefault();
        explainThis();
      } else if (e.key === "Escape") {
        e.preventDefault();
        stopVoice();
        onExit?.();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, index, awaitingQuickCheckKey]);

  useEffect(() => {
    return () => {
      stopVoice();
      if (wakeTimerRef.current) { clearTimeout(wakeTimerRef.current); wakeTimerRef.current = null; }
    };
  }, [stopVoice]);

  return (
    <main role="main" aria-label="Audio-first lecture player" className="hud-canvas hud-grain relative min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
        <header className="relative flex items-center justify-between">
          <HudCorners accent="var(--accent-blind)" />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent-blind">Audio-first lecture · beat {index + 1} of {beats.length}</p>
            <h1 className="text-2xl font-black tracking-tight">{title}</h1>
          </div>
          {onExit && (
            <button
              onClick={() => {
                stopVoice();
                onExit();
              }}
              className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white/80 transition hover:bg-white/10"
              aria-label="Exit lecture"
            >
              Exit
            </button>
          )}
        </header>

        {voiceBlocked && (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-3.5">
            <p className="text-sm font-bold text-amber-200">Your browser blocked audio. Press Space to enable sound and start.</p>
          </div>
        )}

        {/* Voice-control status. The mic is on for the whole session, but commands only run
            after the wake name: "Nova, start", "Nova, stop", "Nova, repeat", etc. */}
        {micSupported ? (
          <div className={`flex flex-wrap items-center gap-3 rounded-2xl border px-5 py-3.5 transition-colors ${thinking ? "border-violet-400/50 bg-violet-500/15" : awaitingCommand ? "border-emerald-400/50 bg-emerald-500/15" : "border-accent-blind/25 bg-accent-blind/10"}`}>
            <span className={`grid size-9 shrink-0 place-items-center rounded-full ${thinking ? "bg-violet-400/40 text-violet-100 animate-pulse" : awaitingCommand ? "bg-emerald-400/40 text-emerald-100" : micOn ? "bg-emerald-500/25 text-emerald-200" : "bg-white/10 text-white/50"}`} aria-hidden="true">
              {thinking ? "✦" : awaitingCommand ? "👂" : "🎙"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white/85" aria-live="polite">
                {!micOn
                  ? "Microphone is off."
                  : thinking
                  ? "Nova is thinking…"
                  : awaitingCommand
                  ? "Nova is listening — ask a question or say a command like “repeat”, “next”, or “stop”."
                  : heard
                  ? `Heard: “${heard}”`
                  : `${vadStatus ? `${vadStatus} ` : ""}Say “Nova” then anything — “Nova, explain the light part”, “Nova, go back”, “Nova, stop”.`}
              </p>
            </div>
            <button
              onClick={() => (micOn ? stopMic() : startMic())}
              className="shrink-0 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white/80 transition hover:bg-white/10"
            >
              {micOn ? "Turn mic off" : "Turn mic on"}
            </button>
          </div>
        ) : (
          <p className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-5 py-3.5 text-sm font-bold text-amber-200">
            Voice control isn&rsquo;t available in this browser — use the keyboard controls below (Space to start).
          </p>
        )}

        {(!autoStart || voiceBlocked) && !playing && phase !== "done" && (
          <button
            onClick={start}
            className="rounded-full px-6 py-3 text-base font-black"
            style={{ background: "linear-gradient(180deg, var(--accent-blind-bright), var(--accent-blind))", color: "#0c0a2e", boxShadow: "0 0 24px var(--accent-blind-glow)" }}
            autoFocus
          >
            {index === 0 ? 'Start lecture (or say "Nova, start")' : 'Resume (or say "Nova, start")'}
          </button>
        )}

        {/* The transcript: low-vision users get visual confirmation, screen readers announce
            it live without needing focus moved anywhere. This is supplementary, not primary —
            the lecture is fully usable with this region entirely unread, by sound alone. */}
        <section aria-live="polite" aria-atomic="true" className="min-h-[3em] rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-lg font-semibold leading-relaxed text-white/90">
          {announcement}
        </section>

        {phase === "waiting-answer" && isCheckpoint && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitAnswer();
            }}
          >
            <label htmlFor="blind-answer" className="text-sm font-bold text-white/60">
              {micSupported ? 'Speak your answer aloud starting with "Nova"' : "Your answer"}{checkpointAttempts > 0 ? ` (attempt ${checkpointAttempts + 1} of ${MAX_ATTEMPTS})` : ""}
              {micSupported && <span className="ml-2 font-semibold text-white/40">— for example, “Nova, oxygen”</span>}
            </label>
            <input
              id="blind-answer"
              ref={answerInputRef}
              value={answerValue}
              onChange={(e) => setAnswerValue(e.target.value)}
              className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3.5 text-lg font-semibold text-white placeholder:text-white/30 focus:border-accent-blind focus:outline-none"
              placeholder="Type your answer and press Enter"
              autoComplete="off"
            />
            <button
              type="submit"
              className="self-start rounded-2xl px-6 py-3 text-base font-black"
              style={{ background: "linear-gradient(180deg, var(--accent-blind-bright), var(--accent-blind))", color: "#0c0a2e", boxShadow: "0 0 24px var(--accent-blind-glow)" }}
            >
              Submit answer (Enter)
            </button>
          </form>
        )}

        {checkpointResult && phase === "feedback" && (
          <p className={`rounded-2xl px-5 py-3.5 text-base font-bold ${checkpointResult.correct ? "bg-emerald-500/15 text-emerald-200" : "bg-amber-500/15 text-amber-200"}`}>
            {checkpointResult.feedback}
          </p>
        )}

        {awaitingQuickCheckKey && (
          <p className="text-sm font-bold uppercase tracking-[0.15em] text-fuchsia-300">Say “Nova” or press any key to continue…</p>
        )}

        {phase === "done" && (
          <button
            onClick={restart}
            className="self-start rounded-full px-6 py-3 text-base font-black"
            style={{ background: "linear-gradient(180deg, var(--accent-blind-bright), var(--accent-blind))", color: "#0c0a2e", boxShadow: "0 0 24px var(--accent-blind-glow)" }}
          >
            Restart (R)
          </button>
        )}

        <nav aria-label="Voice and keyboard controls" className="mt-auto flex flex-col gap-3">
          <p className="text-sm font-semibold text-accent-blind/80">
            Say <span className="font-black text-white/90">“Nova”</span>, then talk to her naturally — without that name, noise is ignored.
            Try <span className="font-black text-white/90">“Nova, explain the light part again”</span>, <span className="font-black text-white/90">“Nova, I&rsquo;m a bit lost”</span>, <span className="font-black text-white/90">“Nova, go back”</span>, or quick commands like <span className="font-black text-white/90">“Nova, stop”</span> / <span className="font-black text-white/90">“Nova, next”</span> / <span className="font-black text-white/90">“Nova, exit”</span>. At a checkpoint, answer the same way: <span className="font-black text-white/90">“Nova, oxygen”</span>.
          </p>
          <div className="grid grid-cols-2 gap-2 text-sm font-semibold text-white/40 sm:grid-cols-3">
          <p><kbd className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">Space</kbd> play / pause</p>
          <p><kbd className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">←</kbd> / <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">→</kbd> previous / next beat</p>
          <p><kbd className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">A</kbd> repeat description</p>
          <p><kbd className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">E</kbd> explain this</p>
          <p><kbd className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">R</kbd> restart</p>
          <p><kbd className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">Esc</kbd> exit</p>
          <p><kbd className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">Enter</kbd> submit answer</p>
          </div>
        </nav>
      </div>
    </main>
  );
}
