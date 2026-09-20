# Arya full-duplex voice architecture

All full-duplex Arya voice modes use `useGeminiLiveTutor`: standard and ADHD lecture narration and
questions, planning, lesson generation/design, the voice-first tutor, check-ins, and oral exams. The hook owns
one shared microphone pipeline and delegates turn admission to `lib/voice/voiceGate.ts`; callers
only supply mode context and whether Arya is audibly narrating outside the Live audio bus.

## Runtime path

1. `getUserMedia` enables browser echo cancellation, noise suppression, and automatic gain control.
2. `public/voice/capture-worklet.js` resamples on the audio thread to 16 kHz mono and emits exact
   20 ms frames. A same-size `ScriptProcessor` fallback is retained for older audio contexts.
3. Acoustic features reject silence, impulsive noise, hum, and steady tones using RMS, speech-band
   energy, flatness, zero crossings, pitch, voicing, centroid, and time-varying pitch/level.
4. `speakerProfile.ts` incrementally enrolls only semantically accepted student turns and compares
   pitch distribution plus level-independent timbre. It is a replaceable `SpeakerVerifier`, not a
   claim of biometric identity.
5. On browsers with Web Speech recognition, `localTranscriber.ts` supplies interim words to
   `addressing.ts` while PCM remains buffered in the browser. Web Speech may use the browser
   vendor's service; it is a browser-side prefilter, not guaranteed on-device recognition.
6. The addressing classifier combines Arya/teacher wake names, commands, board references, lesson
   vocabulary, pending-question state, side-conversation patterns, and speaker evidence.
7. On the primary browser-prefilter path, only an accepted turn opens Gemini activity. Buffered
   onset/pre-roll is replayed, then live frames flow. A genuine interruption stops local playback
   immediately; unrelated candidates do not stop or switch Arya.

Gemini automatic activity detection is disabled. On browsers without Web Speech, the compatibility
path can use Gemini input transcription, but configures `NO_INTERRUPTION` so an unconfirmed
candidate cannot cancel Arya's active server turn. This fallback is intentionally conservative;
the replaceable transcriber boundary is where an on-device WASM ASR should be installed for equal
semantics across Firefox and Safari.

## Timing and hysteresis

- Capture frame: 20 ms.
- Acoustic confirmation: 180 ms.
- Pre-roll: 500 ms, with candidate audio buffered until acceptance.
- End-of-turn silence / final-transcript confirmation: 700 ms.
- Post-episode refractory window: 500 ms.
- Verified-speaker no-transcript safety barge-in: 2 s.

The gate may classify and buffer continuously, but it only ducks after an admitted turn. Accepted
wake-name or command transcripts barge in on the same callback; no extra debounce is applied after
positive semantic evidence.

Muting the microphone stops both the Web Audio track and the browser speech-recognition adapter;
`startMuted` therefore remains a privacy boundary even though the two capture APIs are independent.

## Model

The default is `gemini-3.8-live`, configurable with `GEMINI_LIVE_MODEL`. It is the general Gemini
Live model optimized for low-latency dialogue. The extended-thinking variant is deliberately not
the default because its additional reasoning latency is the wrong tradeoff for natural duplex
speech. Gemini thinking configuration is omitted for the 3.8 Live line.

## Tests and observability

`lib/anim/voiceGateScenarios.test.ts` contains 30 synthesized room scenarios: fan/AC, keyboard,
TV, music, traffic, cough, laugh, notifications, multiple kinds of nearby conversation, explicit
addressing, wake name, overlap, whispering, commands, pauses, background speech during Arya's turn,
speaker mismatch, missing transcription, planning answers, and echo-guard timing. Regression tests
also assert that semantic candidates do not open Gemini activity before acceptance.

Every state transition carries a reason and detail string. The hook retains the latest 3,000 gate
decisions and exposes them through `onInterruptionDecision` for production diagnostics.
