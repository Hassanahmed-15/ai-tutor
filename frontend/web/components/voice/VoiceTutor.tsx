"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Beat } from "@/lib/lessonContent";
import { useGeminiLiveTutor } from "@/lib/useGeminiLiveTutor";
import { VOICE_SYSTEM_INSTRUCTION, VOICE_TOOLS } from "@/lib/voiceTutorContract";
import { VoiceTranscript, type TranscriptLine } from "./VoiceTranscript";
import { useAuth } from "@/components/auth/AuthGate";

/**
 * The voice-first tutor.
 *
 * This is not the standard player with accessibility adjustments bolted on. There is no board, no
 * beat navigation, no controls to find: Gemini Live IS the interface, and it drives the application
 * through the tools in voiceTutorContract.ts. The screen exists only to show a large, high-contrast
 * transcript for someone with usable sight — everything it displays is also spoken, so nothing is
 * lost by not reading it.
 *
 * HOW A LECTURE PLAYS. The narration is not a separate audio track. Each section's script is handed
 * to Gemini as text to speak, which buys three things a parallel TTS stream could not: one voice
 * throughout, interruption that already works (barge-in is handled by the Live session), and
 * questions answered in context because the tutor said the words itself and has them in its
 * history.
 *
 * WHAT LIVES IN REFS AND WHY. Tool handlers are given to the Gemini hook once, so anything they
 * read must be a ref — state captured in a closure would be the value from the render that
 * registered the handler, which is the first one. The refs and the state are kept in step
 * deliberately: state drives the transcript, refs answer tool calls.
 */

type LectureState = {
  status: "idle" | "building" | "ready" | "playing" | "paused" | "finished" | "error";
  topic: string;
  beats: Beat[];
  index: number;
  error?: string;
  /** Rough progress for build updates, so "how long" has an honest answer. */
  startedAt?: number;
};

const IDLE: LectureState = { status: "idle", topic: "", beats: [], index: 0 };

export function VoiceTutor({ onExit }: { onExit: () => void }) {
  const { profile, openSettings, refresh } = useAuth();
  const [lecture, setLecture] = useState<LectureState>(IDLE);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [connected, setConnected] = useState(false);

  const lectureRef = useRef<LectureState>(IDLE);
  useEffect(() => {
    lectureRef.current = lecture;
  }, [lecture]);

  /** Set by the hook once connected; used to push narration text into the live session. */
  const speakRef = useRef<((text: string) => void) | null>(null);
  /**
   * True only while the turn currently being spoken is a SECTION being narrated.
   *
   * Without this, any turn finishing while a lecture was open advanced it — so answering a question
   * mid-lecture both replayed the section and stepped forward, and the student heard the same
   * paragraph twice. Status alone cannot tell the two apart: during an answer the lecture is
   * legitimately still "playing".
   */
  const narratingRef = useRef(false);
  const buildAbortRef = useRef<AbortController | null>(null);

  /**
   * Append streamed transcript text to the current speaker's line.
   *
   * The hook delivers output transcription as INCREMENTAL FRAGMENTS — "A leaf turns", " light into",
   * " sugar." — not as a growing whole. Replacing the line with each fragment therefore left only
   * the last one on screen ("sugar."), which is both useless and misleading. So fragments are
   * concatenated onto the open line, and a new line starts only when the speaker changes.
   *
   * Interim student text is the exception: partial speech recognition RE-SENDS the whole utterance
   * as it revises, so those replace rather than append.
   */
  const addLine = useCallback((role: TranscriptLine["role"], text: string, final: boolean) => {
    const chunk = text.trim();
    if (!chunk) return;
    setLines((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && !last.final) {
        const merged =
          role === "student"
            // Recognition revises the whole phrase; keep the longer of the two rather than gluing
            // a correction onto the text it was correcting.
            ? (chunk.length >= last.text.length ? chunk : last.text)
            : `${last.text} ${chunk}`.replace(/\s+/g, " ").trim();
        return [...prev.slice(0, -1), { role, text: merged, final, id: last.id }];
      }
      return [...prev.slice(-60), { role, text: chunk, final, id: `${role}-${Date.now()}-${Math.random()}` }];
    });
  }, []);

  /**
   * Speak one section, then advance.
   *
   * The script is sent as text for Gemini to voice. `onTutorTurnComplete` is what moves to the next
   * section, so playback follows the AUDIO finishing rather than a timer — a section interrupted by
   * a question does not silently roll on underneath the answer.
   */
  const playSection = useCallback((index: number) => {
    const state = lectureRef.current;
    const beat = state.beats[index];
    if (!beat) {
      setLecture((prev) => ({ ...prev, status: "finished" }));
      speakRef.current?.(
        "[SYSTEM] The lecture has finished. Tell the student it is done and ask what they would like next. Do not list options.",
      );
      return;
    }
    setLecture((prev) => ({ ...prev, status: "playing", index }));
    narratingRef.current = true;
    speakRef.current?.(
      `[SYSTEM] Read the following section aloud to the student, word for word, with natural teaching delivery. Do not add a preamble, do not summarise it, do not comment on it. Section ${index + 1} of ${state.beats.length}, titled "${beat.title}":\n\n${beat.script}`,
    );
  }, []);

  /** Kick off generation and report progress through the job poller. */
  const startBuild = useCallback(
    async (topic: string) => {
      buildAbortRef.current?.abort();
      const controller = new AbortController();
      buildAbortRef.current = controller;
      setLecture({ status: "building", topic, beats: [], index: 0, startedAt: Date.now() });

      try {
        const res = await fetch("/api/generate-lecture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic, mood: "Voice-first mode: spoken narration only, no visual board." }),
          signal: controller.signal,
        });
        let data = await res.json().catch(() => ({}));

        // Same polling contract as the visual player: the host cuts long requests, so generation
        // reports back through a job id.
        if (res.status === 202 && typeof data.jobId === "string") {
          for (;;) {
            if (controller.signal.aborted) return;
            await new Promise((r) => setTimeout(r, 3000));
            if (controller.signal.aborted) return;
            const poll = await fetch(`/api/generate-lecture/status?id=${encodeURIComponent(data.jobId)}`, {
              cache: "no-store",
              signal: controller.signal,
            }).catch(() => null);
            if (!poll?.ok) continue;
            const state = await poll.json().catch(() => ({}));
            if (state.state === "running") continue;
            if (state.state === "error") throw new Error(state.error || "The lecture could not be built.");
            if (state.state === "unknown") throw new Error("That build expired before it finished.");
            if (state.state === "done") {
              data = state;
              break;
            }
          }
        }

        const beats: Beat[] = Array.isArray(data.beats) ? data.beats : [];
        if (!beats.length) throw new Error(data.error || "The lecture came back empty.");

        setLecture({ status: "ready", topic, beats, index: 0 });
        // Gemini decides how to announce it and starts playback via control_lecture.
        speakRef.current?.(
          `[SYSTEM] The lecture on "${topic}" is ready — ${beats.length} sections. Tell the student briefly, then begin it by calling control_lecture with action "resume".`,
        );
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "The lecture could not be built.";
        setLecture({ status: "error", topic, beats: [], index: 0, error: message });
        speakRef.current?.(
          `[SYSTEM] Building failed: ${message}. Tell the student plainly in one sentence and ask if they want you to try again.`,
        );
      }
    },
    [],
  );

  /**
   * The orchestration surface Gemini acts through.
   *
   * Every return value is a sentence rather than a status code, because it goes straight back into
   * the conversation — Gemini reads it and speaks from it, so "Paused at section 3 of 8" produces a
   * useful reply where "ok" would not.
   */
  const handleTool = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<string> => {
      const state = lectureRef.current;

      if (name === "start_lecture") {
        const topic = typeof args.topic === "string" ? args.topic.trim() : "";
        if (!topic) return "No topic was given. Ask the student what they would like to learn.";
        if (state.status === "building") return `A lecture on "${state.topic}" is already being built.`;
        void startBuild(topic);
        return `Started building a lecture on "${topic}". This takes a few minutes. Keep the student company and teach them something about it while they wait; check describe_state for progress.`;
      }

      if (name === "control_lecture") {
        const action = typeof args.action === "string" ? args.action : "";
        if (!state.beats.length && action !== "stop") {
          return "There is no lecture yet. Ask the student what they would like to learn, then call start_lecture.";
        }
        switch (action) {
          case "pause":
            narratingRef.current = false;
            setLecture((prev) => ({ ...prev, status: "paused" }));
            return `Paused at section ${state.index + 1} of ${state.beats.length}. Stop speaking and wait for the student.`;
          case "resume": {
            // Resume replays the current section from its start: a section interrupted midway was
            // never heard in full, and picking up from an arbitrary point is worse than repeating.
            const index = state.status === "finished" ? 0 : state.index;
            playSection(index);
            return "Resumed. The section text is being sent to you separately — say nothing now and read that when it arrives.";
          }
          case "repeat":
            playSection(lectureRef.current.index);
            return "Repeating. The section text is being sent to you separately — say nothing now and read that when it arrives.";
          case "next": {
            // Read the index fresh: narration advances it between tool calls, so the value captured
            // when this handler was entered can already be a section behind.
            const next = lectureRef.current.index + 1;
            if (next >= state.beats.length) {
              setLecture((prev) => ({ ...prev, status: "finished" }));
              return "That was the last section. Tell the student the lecture is finished.";
            }
            playSection(next);
            return `Moving to section ${next + 1}. The text is being sent to you separately — say nothing now and read that when it arrives.`;
          }
          case "back": {
            const prevIndex = Math.max(0, lectureRef.current.index - 1);
            playSection(prevIndex);
            return `Going back to section ${prevIndex + 1}. The text is being sent to you separately — say nothing now and read that when it arrives.`;
          }
          case "restart":
            playSection(0);
            return "Restarted. The section text is being sent to you separately — say nothing now and read that when it arrives.";
          case "stop":
            narratingRef.current = false;
            buildAbortRef.current?.abort();
            setLecture(IDLE);
            return "The lecture is stopped. You are back to open conversation.";
          default:
            return `Unknown action "${action}".`;
        }
      }

      if (name === "describe_state") {
        if (state.status === "building") {
          const seconds = Math.round((Date.now() - (state.startedAt ?? Date.now())) / 1000);
          return `Still building "${state.topic}". About ${seconds} seconds so far; these usually take three to five minutes. Keep teaching the student something about the topic.`;
        }
        if (state.status === "error") {
          // Trim any trailing stop so the sentence does not end ".." — these strings are spoken,
          // and a doubled period reads as a stumble.
          const why = (state.error ?? "").replace(/\s*[.!?]+\s*$/, "");
          return `The last build failed: ${why}. Nothing is playing.`;
        }
        if (!state.beats.length) return "No lecture yet. The student has not chosen a topic.";
        const where = `section ${state.index + 1} of ${state.beats.length}, "${state.beats[state.index]?.title ?? ""}"`;
        if (state.status === "playing") return `Playing ${where}, from the lecture on "${state.topic}".`;
        if (state.status === "paused") return `Paused at ${where}.`;
        if (state.status === "finished") return `The lecture on "${state.topic}" is finished — all ${state.beats.length} sections.`;
        return `The lecture on "${state.topic}" is ready to start, ${state.beats.length} sections.`;
      }

      if (name === "get_section_text") {
        if (!state.beats.length) return "There is no lecture loaded.";
        const raw = Number(args.section);
        const index = Number.isFinite(raw) ? Math.round(raw) - 1 : state.index;
        const beat = state.beats[index];
        if (!beat) return `There is no section ${index + 1}. The lecture has ${state.beats.length}.`;
        return `Section ${index + 1}, "${beat.title}": ${beat.script}`;
      }

      if (name === "summarize_lecture") {
        if (!state.beats.length) return "There is no lecture loaded.";
        const list = state.beats.map((b, i) => `${i + 1}. ${b.title}`).join("; ");
        return `"${state.topic}" has ${state.beats.length} sections: ${list}. Currently at ${state.index + 1}.`;
      }

      if (name === "set_accessibility_profile") {
        /**
         * Changing the profile by voice, because the settings dialog is a visual form.
         *
         * `navigate` can open settings, but a student who cannot see it gains nothing from the
         * dialog appearing — so the one setting that actually matters here is changeable by asking.
         * Switching to a non-voice profile takes them out of this mode on the next load, which is
         * exactly what someone means when they say this mode is not working for them.
         */
        const next = typeof args.profile === "string" ? args.profile : "";
        const res = await fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessibility: next }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return `That did not save: ${data.error ?? "unknown error"}.`;
        await refresh();
        if (next !== "blind" && next !== "low-vision") {
          return `Switched to the ${next} profile. Tell the student the visual tutor will load, then call navigate with destination "home".`;
        }
        return `Switched to the ${next} profile. Nothing else changes right now.`;
      }

      if (name === "navigate") {
        const destination = typeof args.destination === "string" ? args.destination : "";
        if (destination === "settings") {
          openSettings();
          return "Settings are open. The student can change their profile or accessibility mode here, and you can read options aloud if asked.";
        }
        if (destination === "home") {
          buildAbortRef.current?.abort();
          setLecture(IDLE);
          return "Back at the start. Ask what they would like to learn.";
        }
        if (destination === "sign_out") {
          await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
          window.location.reload();
          return "Signing out now.";
        }
        return `Unknown destination "${destination}".`;
      }

      return `Unknown tool "${name}".`;
    },
    [openSettings, playSection, refresh, startBuild],
  );

  const tutor = useGeminiLiveTutor({
    topic: lecture.topic || "open conversation",
    getBeatContext: () => {
      const state = lectureRef.current;
      const beat = state.beats[state.index];
      return beat ? `Section ${state.index + 1}: ${beat.title}\n${beat.script}` : "No lecture is playing.";
    },
    systemInstruction: `${VOICE_SYSTEM_INSTRUCTION}${
      profile?.displayName ? `\n\nThe student's name is ${profile.displayName}.` : ""
    }`,
    customTools: VOICE_TOOLS,
    onCustomToolCall: handleTool,
    onBoardRequest: () => {
      // Voice mode has no board. Declared so the hook's contract is satisfied; a drawing request
      // simply has nowhere to go, and Gemini is instructed not to make them.
    },
    onTranscript: (role, text, final) => addLine(role === "student" ? "student" : "tutor", text, final),
    onTutorTurnComplete: () => {
      // Close the open transcript line so the NEXT turn starts a new paragraph. Without this the
      // whole session accumulates into one endless line, since tutor fragments never arrive marked
      // final.
      setLines((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.final) return prev;
        return [...prev.slice(0, -1), { ...last, final: true }];
      });

      // A finished narration turn advances the lecture. Only while playing: when paused, mid-answer
      // or idle, a completed turn is just the end of a sentence.
      const state = lectureRef.current;
      // Only a finished NARRATION turn advances the lecture. A turn that was an answer, a greeting
      // or a progress update just ended a sentence.
      if (!narratingRef.current || state.status !== "playing") return;
      narratingRef.current = false;
      const next = state.index + 1;
      if (next < state.beats.length) playSection(next);
      else {
        setLecture((prev) => ({ ...prev, status: "finished" }));
        speakRef.current?.(
          "[SYSTEM] That was the final section. Tell the student the lecture is complete and ask what they would like next.",
        );
      }
    },
    onExplicitPause: () => {
      narratingRef.current = false;
      setLecture((prev) => (prev.status === "playing" ? { ...prev, status: "paused" } : prev));
    },
    alwaysOn: true,
    lectureControlTools: false,
    startMuted: false,
  });

  /**
   * Test seam.
   *
   * The orchestration contract — what each tool does to the lecture state and what sentence it
   * hands back — is the part of this mode most worth testing, and it cannot be reached through the
   * UI because the only way in is real speech to a live model. This exposes the same handler
   * Gemini calls so a browser test can exercise it directly.
   *
   * Behind an explicit flag so it is not a scriptable remote control on a real user's session.
   */
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_VOICE_TEST_HOOKS !== "1") return;
    const w = window as unknown as Record<string, unknown>;
    w.__voiceTool = handleTool;
    // Lets a test speak to Gemini as if by microphone, so tool SELECTION can be exercised rather
    // than only tool execution.
    w.__voiceSay = (text: string) => speakRef.current?.(text);
    return () => {
      delete w.__voiceTool;
      delete w.__voiceSay;
    };
  }, [handleTool]);

  // Expose the session's text channel to the tool handlers once it is live. `say` prompts a spoken
  // turn (unlike addContext, which stores something silently) — narration has to be heard.
  useEffect(() => {
    speakRef.current = tutor.say;
    setConnected(tutor.status === "live" || tutor.status === "drawing");
  }, [tutor.say, tutor.status]);

  useEffect(() => () => buildAbortRef.current?.abort(), []);

  return (
    <VoiceTranscript
      lines={lines}
      status={tutor.status}
      connected={connected}
      lecture={lecture}
      error={tutor.errorMessage}
      onExit={onExit}
      onRetryConnect={tutor.start}
    />
  );
}
