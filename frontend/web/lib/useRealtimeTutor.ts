"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DrawScript } from "@/components/sketch/LiveSketch";

/**
 * Full-duplex live voice tutor over the OpenAI Realtime API (WebRTC, speech-to-speech).
 *
 * Flow: mint an ephemeral token from /api/realtime-session, open an RTCPeerConnection (mic up,
 * remote audio down, `oai-events` data channel), SDP-handshake against OpenAI, then stream events.
 * Server-side VAD handles barge-in/turn-taking. A `show_board` function tool lets the tutor draw
 * an explanation board via /api/explain (rendered by the caller through onBoardRequest).
 *
 * Single-speaker discipline is the caller's responsibility: it must silence the scripted TTS
 * (pause + cancelActiveNarrations) before start() and resume after stop() — the remote audio
 * track is the ONLY audio during a session.
 *
 * Guardrails: idle timeout (no speech) + hard max-session timeout, both force stop().
 */

export type RealtimeStatus =
  | "idle"
  | "connecting"
  | "live" // connected; either listening or the tutor is speaking
  | "drawing" // a show_board tool call is in flight
  | "mic-denied"
  | "blocked" // autoplay blocked
  | "error";

export type RealtimeBoard = { script: string; draw?: DrawScript };

type TranscriptRole = "student" | "tutor";

export type UseRealtimeTutorOptions = {
  topic: string;
  getBeatContext: () => string;
  /** Compact digest of the WHOLE lesson (all beats / the task-folder content) so the tutor has
   *  context of the entire video, not just the current beat. Sent once at session start. */
  getLessonContext?: () => string;
  mood?: string;
  /** Called when the tutor's show_board tool fires and /api/explain returns a board to draw. */
  onBoardRequest: (board: RealtimeBoard) => void;
  /** Live transcript lines (both sides) for the accessibility panel. */
  onTranscript?: (role: TranscriptRole, text: string, final: boolean) => void;
  /** Fired when the session ends (any reason) so the caller can resume the lecture. */
  onSessionEnded?: (reason: "user" | "idle" | "timeout" | "error") => void;
  /** Fired the instant the student STARTS speaking (server VAD) — use to pause the lecture
   *  immediately, before the tutor even responds. */
  onStudentSpeechStarted?: () => void;
  /** Fired when the student STOPS speaking. */
  onStudentSpeechStopped?: () => void;
  /** Fired when the tutor's ENTIRE response turn is complete (response.done) — the reliable
   *  "tutor finished talking" signal (unlike `speaking`, which flickers between audio segments). */
  onTutorTurnComplete?: () => void;
  /** The tutor called its pause_lecture tool — the caller should pause the scripted lecture. */
  onPauseLecture?: () => void;
  /** The tutor called its resume_lecture tool — the caller should resume the scripted lecture. */
  onResumeLecture?: () => void;
  /** ALWAYS-ON mode (ADHD): keep the session open for the whole lecture — disable the idle
   *  auto-end and the hard max-session cap. The caller ends it explicitly. */
  alwaysOn?: boolean;
  /** show_board should render a simple TEXT-ONLY blackboard (no images/animations). */
  boardTextOnly?: boolean;
  /** Expose lecture-control tools (pause_lecture / resume_lecture) to the model. */
  lectureControlTools?: boolean;
};

const IDLE_TIMEOUT_MS = 60_000; // no speech for 60s -> auto-end (cost guard)
const MAX_SESSION_MS = 5 * 60_000; // hard cap 5 min (cost guard)

export function useRealtimeTutor(opts: UseRealtimeTutorOptions) {
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [speaking, setSpeaking] = useState(false); // tutor is currently speaking
  const [muted, setMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  // Timestamp of the student's last speech-stop, to measure reply latency (Paper 3 p95 budget).
  const speechStopTsRef = useRef<number>(0);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  // True between response.created and response.done. `silence()` uses it so it only cancels a turn
  // that actually exists — the voice director calls silence() defensively on every hand-off.
  const responseInFlightRef = useRef(false);
  // True while her audio is ACTUALLY coming out of the speakers (output_audio_buffer.started ..
  // .stopped). This is different from responseInFlight: the model finishes GENERATING (response.done)
  // a second or two before the buffered audio finishes PLAYING. We must not report "she stopped"
  // until playback is truly done, or the lecture resumes over her tail — the collision the student
  // keeps hearing.
  const audioPlayingRef = useRef(false);
  // Guards onTutorTurnComplete to exactly once per settled turn. Reset when a new response begins.
  const turnCompletedRef = useRef(false);
  // show_board is a silent tool call that chains into MORE responses (a "let me draw…" filler, a
  // multi-second /api/explain draw, then the narration). While this is set we never declare the turn
  // over, so the lecture can't resume in the middle of that sequence. Cleared right before the final
  // narration response, and on barge-in.
  const boardChainPendingRef = useRef(false);
  // The turn ends when she has been SILENT for a short debounce — audio drained AND no response in
  // flight. This one signal is correct for every case (silent tool calls, spoken answers, chained
  // show_board), because it keys off actual silence rather than per-response bookkeeping.
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SETTLE_MS = 700;

  // "Her turn is fully over" — fire the completion callback once.
  const finishTutorTurn = useCallback(() => {
    if (turnCompletedRef.current) return;
    turnCompletedRef.current = true;
    audioPlayingRef.current = false;
    responseInFlightRef.current = false;
    setSpeaking(false);
    optsRef.current.onTutorTurnComplete?.();
  }, []);

  const cancelSettle = useCallback(() => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  // Arm the "she's settled" debounce. If she starts making sound again before it fires, cancelSettle
  // clears it; while a show_board chain is mid-flight we don't arm it at all.
  const scheduleSettle = useCallback(() => {
    if (boardChainPendingRef.current) return;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      finishTutorTurn();
    }, SETTLE_MS);
  }, [finishTutorTurn]);

  // She is actively producing sound (or about to). Keep the turn open.
  const markChatbotActive = useCallback(() => {
    cancelSettle();
    setSpeaking(true);
  }, [cancelSettle]);

  // Re-evaluate after a flag change: if she's gone quiet, arm the settle; otherwise keep it open.
  const reassessSettle = useCallback(() => {
    if (responseInFlightRef.current || audioPlayingRef.current) cancelSettle();
    else scheduleSettle();
  }, [cancelSettle, scheduleSettle]);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endedRef = useRef(false);
  // Keep latest callbacks/props without forcing start()/stop() identity to change.
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  }, [opts]);

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    idleTimerRef.current = null;
    maxTimerRef.current = null;
    settleTimerRef.current = null;
  }, []);

  // Full teardown — idempotent. This is the point the lecture resumes, so nothing may keep
  // playing audio or holding the mic afterward.
  const teardown = useCallback(
    (reason: "user" | "idle" | "timeout" | "error") => {
      if (endedRef.current) return;
      endedRef.current = true;
      clearTimers();
      try {
        dcRef.current?.close();
      } catch {
        /* ignore */
      }
      try {
        pcRef.current?.getSenders().forEach((s) => s.track?.stop());
      } catch {
        /* ignore */
      }
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      try {
        pcRef.current?.close();
      } catch {
        /* ignore */
      }
      if (audioElRef.current) {
        audioElRef.current.srcObject = null;
        audioElRef.current.remove();
      }
      pcRef.current = null;
      dcRef.current = null;
      micStreamRef.current = null;
      audioElRef.current = null;
      setSpeaking(false);
      setStatus("idle");
      optsRef.current.onSessionEnded?.(reason);
    },
    [clearTimers]
  );

  const stop = useCallback(() => teardown("user"), [teardown]);

  const resetIdleTimer = useCallback(() => {
    if (optsRef.current.alwaysOn) return; // no idle auto-end in always-on mode
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => teardown("idle"), IDLE_TIMEOUT_MS);
  }, [teardown]);

  // Send a JSON event to the model over the data channel.
  const sendEvent = useCallback((event: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(event));
  }, []);

  /**
   * Cut the tutor's voice off RIGHT NOW.
   *
   * The server stops generating the moment we cancel, but audio it already streamed is buffered
   * inside the <audio> element and keeps playing (~1-2s of Aria talking over whoever interrupted).
   * WebRTC gives us no buffer flush, so we cut it hard: mute the element and jump it to its live
   * edge, which drops the buffered tail, then unmute shortly after so the NEXT response is audible.
   *
   * This is the primitive the voice director uses to guarantee the teacher and the tutor never
   * speak at once — it is called both on student barge-in and before the teacher takes the channel.
   */
  const silence = useCallback(() => {
    const el = audioElRef.current;
    if (el) {
      el.muted = true;
      try {
        if (Number.isFinite(el.duration) && el.duration > 0) el.currentTime = el.duration;
      } catch {
        /* seeking a live MediaStream can throw — ignore */
      }
      setTimeout(() => {
        if (audioElRef.current) audioElRef.current.muted = false;
      }, 250);
    }
    // Tell the server to truncate/cancel the in-flight response immediately.
    if (responseInFlightRef.current) {
      responseInFlightRef.current = false;
      sendEvent({ type: "response.cancel" });
    }
    // The tail is cut — she is no longer playing. Mark the turn done so a deferred resume can fire,
    // but WITHOUT calling onTutorTurnComplete (a barge-in is the student taking over, not her
    // finishing a thought the lecture should resume behind). Also drop any pending settle and any
    // half-finished board chain so neither wedges a later turn.
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    boardChainPendingRef.current = false;
    audioPlayingRef.current = false;
    turnCompletedRef.current = true;
    setSpeaking(false);
  }, [sendEvent]);

  // Handle a show_board tool call: draw via /api/explain, then hand the result back so the
  // model can talk about the now-visible board. The model narrates it (NOT playNarration) —
  // that keeps the single-speaker invariant.
  const handleShowBoard = useCallback(
    async (callId: string, concept: string) => {
      setStatus("drawing");
      // Mask the /api/explain latency: ask Aria to say a short filler line NOW, while the board
      // generates, so the multi-second wait isn't dead air. This response is spoken before the
      // tool result comes back; the follow-up response.create (below) narrates the finished board.
      sendEvent({
        type: "response.create",
        response: {
          instructions:
            `Say a brief, natural filler line (about 4-8 words) telling the student you're ` +
            `sketching "${concept}" now — e.g. "Let me draw that out for you…". Do not explain ` +
            `anything yet; the board is still being drawn.`,
        },
      });
      let outcome = "board shown";
      try {
        const res = await fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: optsRef.current.topic,
            beatContext: optsRef.current.getBeatContext(),
            question: concept,
            textOnly: optsRef.current.boardTextOnly === true,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.script) throw new Error(data.error || "explain failed");
        optsRef.current.onBoardRequest({ script: data.script, draw: data.draw });
        outcome = `board shown for "${concept}"`;
      } catch {
        outcome = `could not draw a board for "${concept}" — explain it verbally instead`;
      } finally {
        if (!endedRef.current) setStatus("live");
      }
      // The chain's final leg — the narration — is about to start. Release the guard so THIS
      // response settles normally (and resumes the lecture) once she finishes talking about the board.
      boardChainPendingRef.current = false;
      // Return the tool result and ask the model to respond about the board.
      sendEvent({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: outcome },
      });
      sendEvent({ type: "response.create" });
    },
    [sendEvent]
  );

  const handleServerEvent = useCallback(
    (evt: Record<string, unknown>) => {
      const type = evt.type as string;
      switch (type) {
        case "input_audio_buffer.speech_started": {
          resetIdleTimer();
          setSpeaking(false); // student started talking (barge-in) -> tutor yields
          // Notify the caller IMMEDIATELY so it can pause the lecture the moment the student speaks
          // (not later when the tutor replies).
          optsRef.current.onStudentSpeechStarted?.();
          // Drop the buffered tail of whatever the tutor was saying so she doesn't talk over the
          // student for the next second or two. See silence() for why this is needed.
          silence();
          break;
        }
        case "input_audio_buffer.speech_stopped":
          resetIdleTimer();
          speechStopTsRef.current = performance.now();
          optsRef.current.onStudentSpeechStopped?.();
          break;
        case "response.created":
          // A tutor turn has begun (may contain several audio segments). She is active — hold the
          // turn open until she has been silent for the settle debounce.
          responseInFlightRef.current = true;
          turnCompletedRef.current = false;
          markChatbotActive();
          if (speechStopTsRef.current > 0) {
            console.error(`[realtime] reply latency: ${Math.round(performance.now() - speechStopTsRef.current)}ms`);
            speechStopTsRef.current = 0;
          }
          break;
        case "output_audio_buffer.started":
          // Her audio is now actually playing out of the speakers.
          audioPlayingRef.current = true;
          markChatbotActive();
          break;
        case "output_audio_buffer.stopped":
        case "output_audio_buffer.cleared":
          // Her audio drained. If nothing else is in flight, arm the settle debounce; the turn ends
          // (and the lecture may resume) only once she's stayed quiet through it.
          audioPlayingRef.current = false;
          reassessSettle();
          break;
        case "response.audio_transcript.delta":
          markChatbotActive();
          if (typeof evt.delta === "string") optsRef.current.onTranscript?.("tutor", evt.delta, false);
          break;
        case "response.audio_transcript.done":
          // Do NOT settle here — this fires per audio segment. The debounce, driven by real silence,
          // is what ends the turn.
          if (typeof evt.transcript === "string") optsRef.current.onTranscript?.("tutor", evt.transcript, true);
          break;
        case "response.done":
          // Generation is complete, but her audio may still be PLAYING. Reassess: if audio has also
          // drained, arm the settle; otherwise output_audio_buffer.stopped will. This correctly ends
          // silent terminal responses (a bare resume_lecture / pause_lecture tool call) too — the old
          // code swallowed those, which is why voice-resume got stuck.
          responseInFlightRef.current = false;
          reassessSettle();
          break;
        case "conversation.item.input_audio_transcription.delta":
          if (typeof evt.delta === "string") optsRef.current.onTranscript?.("student", evt.delta, false);
          break;
        case "conversation.item.input_audio_transcription.completed":
          if (typeof evt.transcript === "string") optsRef.current.onTranscript?.("student", evt.transcript, true);
          break;
        case "response.function_call_arguments.done": {
          const name = evt.name as string;
          const callId = evt.call_id as string;
          if (name === "show_board") {
            let concept = "";
            try {
              concept = (JSON.parse((evt.arguments as string) || "{}").concept as string) || "";
            } catch {
              /* ignore malformed args */
            }
            if (concept) {
              // This kicks off a multi-response chain (filler → draw → narration). Hold the turn open
              // across the whole thing so the lecture can't resume in the middle of it; handleShowBoard
              // releases the guard right before the final narration response.
              boardChainPendingRef.current = true;
              cancelSettle();
              void handleShowBoard(callId, concept);
            }
          } else if (name === "pause_lecture") {
            optsRef.current.onPauseLecture?.();
            // Report the result but do NOT force another response — the model already said its line
            // before calling this; a response.create here would make it keep talking on its own.
            sendEvent({
              type: "conversation.item.create",
              item: { type: "function_call_output", call_id: callId, output: "lecture paused. Now stay silent and wait for the student." },
            });
          } else if (name === "resume_lecture") {
            optsRef.current.onResumeLecture?.();
            // Critical: NO response.create here. The scripted lecture is now speaking again — the
            // tutor must go silent, not generate its own speech over the lecture.
            sendEvent({
              type: "conversation.item.create",
              item: { type: "function_call_output", call_id: callId, output: "lecture resumed and is now speaking. Go completely silent — do not speak until the student talks to you again." },
            });
          }
          break;
        }
        default:
          break;
      }
    },
    [resetIdleTimer, handleShowBoard, sendEvent, silence, markChatbotActive, reassessSettle, cancelSettle]
  );

  const start = useCallback(async () => {
    if (pcRef.current) return; // already connecting/live
    endedRef.current = false;
    setErrorMessage(null);
    setStatus("connecting");

    // 1+2. Mint the token AND grab the mic in parallel — they're independent, so overlapping
    // them shaves ~200-500ms off connect time. Kick both off before awaiting either.
    const tokenPromise = fetch("/api/realtime-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: optsRef.current.topic,
        beatContext: optsRef.current.getBeatContext(),
        lessonContext: optsRef.current.getLessonContext?.() ?? "",
        mood: optsRef.current.mood ?? "",
        lectureControl: optsRef.current.lectureControlTools === true,
      }),
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.client_secret) throw new Error(data.error || "Could not start the live tutor.");
      return { token: data.client_secret as string, model: data.model as string };
    });
    // Echo cancellation + noise suppression so Aria's OWN voice (played through the speakers)
    // doesn't leak into the mic and self-trigger the VAD, and so room noise doesn't cause false
    // interruptions. Auto gain keeps a quiet student audible. These are hints; the browser applies
    // what it supports.
    const micPromise = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    let token: string;
    let model: string;
    let micStream: MediaStream;
    try {
      // Await mic first so a permission denial is reported as mic-denied (not a generic error).
      micStream = await micPromise;
    } catch {
      // Don't leave the token request dangling if the mic was denied.
      tokenPromise.catch(() => {});
      setStatus("mic-denied");
      return;
    }
    try {
      ({ token, model } = await tokenPromise);
    } catch (err) {
      micStream.getTracks().forEach((t) => t.stop());
      setErrorMessage(err instanceof Error ? err.message : "Could not start the live tutor.");
      setStatus("error");
      return;
    }
    micStreamRef.current = micStream;

    // 3. Peer connection + tracks + data channel.
    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    pc.addTrack(micStream.getAudioTracks()[0], micStream);

    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    audioEl.style.display = "none";
    document.body.appendChild(audioEl);
    audioElRef.current = audioEl;
    pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
      void audioEl.play().catch(() => setStatus("blocked"));
    };

    const dc = pc.createDataChannel("oai-events");
    dcRef.current = dc;
    dc.onmessage = (e) => {
      try {
        handleServerEvent(JSON.parse(e.data));
      } catch {
        /* ignore non-JSON frames */
      }
    };
    dc.onopen = () => {
      // Push a fresh beat-context item in case the beat changed since token mint.
      const ctx = optsRef.current.getBeatContext();
      if (ctx) {
        sendEvent({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: `Context — the student is currently on: ${ctx}` }],
          },
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") {
        setStatus("live");
        // ALWAYS-ON (ADHD): no idle/max cost guards — the session stays open the whole lecture and
        // the caller ends it explicitly. Otherwise apply the idle + hard-cap timers.
        if (!optsRef.current.alwaysOn) {
          resetIdleTimer();
          maxTimerRef.current = setTimeout(() => teardown("timeout"), MAX_SESSION_MS);
        }
      } else if (st === "failed" || st === "closed") {
        // Real, unrecoverable failures only. "disconnected" is excluded on purpose — it's a
        // transient ICE state (e.g. a brief network blip) that often self-recovers back to
        // "connected" within a few seconds; tearing down on it was ending sessions that hadn't
        // actually failed, which then made a later real "End call" press a silent no-op.
        if (!endedRef.current) {
          setErrorMessage("The live connection dropped.");
          teardown("error");
        }
      }
    };

    // 4. SDP handshake.
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpRes = await fetch(`https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/sdp" },
        body: offer.sdp,
      });
      if (!sdpRes.ok) {
        const detail = await sdpRes.text().catch(() => "");
        console.error("[realtime] SDP handshake failed", sdpRes.status, detail);
        throw new Error(`SDP handshake failed (${sdpRes.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
      }
      const answer = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Connection failed.");
      teardown("error");
    }
  }, [handleServerEvent, resetIdleTimer, sendEvent, teardown]);

  const toggleMute = useCallback(() => {
    const track = micStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }, []);

  // Explicitly enable/disable the mic input. The caller mutes the mic WHILE the scripted lecture is
  // narrating so the tutor never "hears" the lecture's own TTS through the speakers and reply to it
  // (the cause of spurious tutor speech coinciding with the lecture). Idempotent + safe pre-connect.
  const setMicEnabled = useCallback((on: boolean) => {
    const track = micStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    if (track.enabled === on) return;
    track.enabled = on;
    setMuted(!on);
  }, []);

  // Make the tutor speak a specific line right now (e.g. a focus-drift nudge). The `prompt` is an
  // instruction to the model, not literal words — it phrases it naturally in its own voice.
  // No-op until the session is live.
  const say = useCallback(
    (prompt: string) => {
      if (!dcRef.current || dcRef.current.readyState !== "open") return;
      sendEvent({ type: "response.create", response: { instructions: prompt } });
    },
    [sendEvent]
  );

  /**
   * Push a fact into the live conversation WITHOUT making the tutor speak. Used to keep Aria aware
   * of things she can't hear — e.g. what the student just drew on the board — so when they ask
   * about it by voice she already has the context and answers naturally. No-op until live.
   */
  const addContext = useCallback(
    (text: string) => {
      if (!dcRef.current || dcRef.current.readyState !== "open" || !text.trim()) return;
      sendEvent({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      });
    },
    [sendEvent]
  );

  // Ensure teardown on unmount.
  useEffect(() => {
    return () => {
      if (pcRef.current) teardown("error");
    };
  }, [teardown]);

  /**
   * SYNCHRONOUS "is she making (or about to make) sound?" — read straight from refs the event
   * handler sets, with none of the one-render lag that `speaking` (React state) has. The voice
   * director uses this to decide, at the exact instant it wants to start the teacher, whether the
   * chatbot holds the channel. A render-late answer here is precisely how the two voices overlapped.
   * Covers the whole span: response.created (in flight, audio imminent) → audio playing → drained.
   */
  const isSpeaking = useCallback(() => responseInFlightRef.current || audioPlayingRef.current, []);

  return { status, speaking, muted, errorMessage, start, stop, toggleMute, setMicEnabled, say, addContext, silence, isSpeaking };
}
