# Arya full-duplex voice architecture

Every Gemini Live surface uses `useGeminiLiveTutor`: normal and PDF lectures, ADHD lessons,
planning, lesson design, voice-first chat, check-ins, and oral exams. Callers provide context and a
surface label; they do not own microphone admission, turn state, playback cancellation, or socket
recovery.

## One shared runtime

The model adapter and the voice gate are separate modules. The production path is:

1. `getUserMedia` requests browser echo cancellation, noise suppression, and automatic gain.
2. `public/voice/capture-worklet.js` resamples off the main thread to 16 kHz mono, 20 ms frames.
3. `lib/voice/sileroVad.ts` runs Silero v6 in WASM. If it is loading or unavailable, the same
   interface falls back to the acoustic detector in `lib/voice/runtime/speechDetector.ts`.
4. `runtime/endpointer.ts` confirms onset, preserves 500 ms pre-roll, tolerates natural pauses,
   extends the grace period for unfinished clauses, and has max-utterance and mic-stall watchdogs.
5. `runtime/speakerProfile.ts` incrementally learns pitch distribution and level-independent
   timbre from accepted turns. It is a replaceable verifier, not biometric authentication.
6. Browser speech recognition supplies interim words to `runtime/addressing.ts`. Wake names,
   lesson commands, board references, topic vocabulary, current question state, third-person name
   use, and side-conversation patterns all contribute an explainable verdict.
7. `runtime/arbiter.ts` combines the acoustic, speaker, semantic, endpoint, and tutor streams.
   Candidate speech may duck playback after 240 ms; it cannot stop Arya without positive evidence.
8. `sharedVoiceGate.ts` is the stable adapter used by the hook. Gemini sees only audio belonging to
   an opened turn, beginning with pre-roll.

Gemini automatic activity detection is disabled and client `activityStart` / `activityEnd` events
are authoritative. In Chromium-class browsers the semantic prefilter holds PCM locally until words
establish that the utterance is for Arya. Where browser speech recognition is unavailable, Gemini
input transcription is the compatibility path and `NO_INTERRUPTION` prevents server VAD from
cancelling Arya by itself.

## Authoritative session and playback state

`sessionMachine.ts` is the single public lifecycle. Its explicit states are `IDLE`, `LISTENING`,
`USER_SPEAKING`, `PROCESSING`, `TUTOR_SPEAKING`, `POSSIBLE_INTERRUPTION`,
`CONFIRMED_INTERRUPTION`, `FALSE_INTERRUPTION`, `PAUSED`, `ERROR`, and `RECONNECTING`.
Transitions are reasoned, timestamped, deduplicated, bounded, and exposed to diagnostics.

`playbackGeneration.ts` assigns every response a session/generation token. Barge-in invalidates the
generation before fading and stopping sources. Late chunks and stale `onended` callbacks are then
ignored, so cancelled speech cannot restart, mark a newer response complete, or corrupt state.

Dropped active sessions reconnect with bounded exponential backoff. Deliberate stop/idle/timeout
teardowns cannot resurrect because they invalidate the session before closing the socket. A reconnect resets active
audio and gate episodes but retains the learned speaker profile. Mic stalls, response timeouts,
maximum utterance duration, and illegal session transitions all recover to explicit states.

## Timing policy

- Capture: 20 ms frames.
- Speech onset confirmation: 180 ms.
- Reversible duck: 240 ms of sustained candidate speech.
- Pre-roll: 500 ms.
- Normal endpoint grace: 700 ms; unfinished phrase: 1,100 ms.
- Verified barge-in without words: 1,000 ms. Positive words (name, command, question) still commit
  immediately; the longer acoustic-only safety path prevents a side sentence from winning a race
  against its transcript.
- Unverified no-transcript barge-in: disabled for lectures; 1,500 ms only over a conversational
  reply when no speaker profile exists.
- Refractory hysteresis: 400 ms.
- Mic-stall watchdog: 1,500 ms; reply watchdog: 8 s; max utterance: 20 s.

## Model and diagnostics

The default model is `gemini-3.8-live`, configurable with `GEMINI_LIVE_MODEL`. Thinking config is
omitted for this model because the Live endpoint rejects it and extra reasoning latency is a poor
trade for spoken turn-taking.

`/voice-lab` is an internal production-path dashboard with start/stop/reconnect/simulated-interrupt
controls; session, connection, microphone, VAD, endpoint, transcript, playback-generation, reason,
latency, and event-stream views. `voiceArchitecture.test.ts` drives 40 deterministic room scenarios
through the same runtime, including environmental noise, nearby people, direct address, genuine
barge-in, overlap, whispers, short commands, natural pauses, microphone drops, response timeouts,
and all voice surface policies.
