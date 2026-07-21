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
  const audioElRef = useRef<HTMLAudioElement | null>(null);
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
    idleTimerRef.current = null;
    maxTimerRef.current = null;
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
          // BARGE-IN FIX: the server stops generating on interrupt, but audio already streamed to
          // the browser is buffered in the <audio> element and keeps playing (~1-2s of Aria talking
          // over you). WebRTC has no buffer flush, so cut it hard: mute + jump the element to its
          // live edge so the buffered tail is dropped and only fresh post-truncation audio plays.
          const el = audioElRef.current;
          if (el) {
            el.muted = true;
            try {
              if (Number.isFinite(el.duration) && el.duration > 0) el.currentTime = el.duration;
            } catch {
              /* seeking a live MediaStream can throw — ignore */
            }
            // Unmute shortly after so the next (fresh) response is audible again.
            setTimeout(() => {
              if (audioElRef.current) audioElRef.current.muted = false;
            }, 250);
          }
          // Tell the server to truncate/cancel the in-flight response immediately.
          sendEvent({ type: "response.cancel" });
          break;
        }
        case "input_audio_buffer.speech_stopped":
          resetIdleTimer();
          optsRef.current.onStudentSpeechStopped?.();
          break;
        case "response.created":
          // A tutor turn has begun (may contain several audio segments). Mark speaking now and let
          // it stay true until response.done — so brief gaps BETWEEN segments don't read as "done".
          setSpeaking(true);
          break;
        case "response.audio_transcript.delta":
          setSpeaking(true);
          if (typeof evt.delta === "string") optsRef.current.onTranscript?.("tutor", evt.delta, false);
          break;
        case "response.audio_transcript.done":
          // Do NOT clear `speaking` here — this fires per audio segment and would flicker false
          // mid-turn. The turn ends on response.done.
          if (typeof evt.transcript === "string") optsRef.current.onTranscript?.("tutor", evt.transcript, true);
          break;
        case "response.done":
          // The ENTIRE tutor turn is complete — this is the only reliable "finished speaking"
          // signal. Clear speaking and notify the caller so it can safely resume the lecture.
          setSpeaking(false);
          optsRef.current.onTutorTurnComplete?.();
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
            if (concept) void handleShowBoard(callId, concept);
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
    [resetIdleTimer, handleShowBoard, sendEvent]
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
        mood: optsRef.current.mood ?? "",
        lectureControl: optsRef.current.lectureControlTools === true,
      }),
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.client_secret) throw new Error(data.error || "Could not start the live tutor.");
      return { token: data.client_secret as string, model: data.model as string };
    });
    const micPromise = navigator.mediaDevices.getUserMedia({ audio: true });

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

  // Ensure teardown on unmount.
  useEffect(() => {
    return () => {
      if (pcRef.current) teardown("error");
    };
  }, [teardown]);

  return { status, speaking, muted, errorMessage, start, stop, toggleMute, say };
}
