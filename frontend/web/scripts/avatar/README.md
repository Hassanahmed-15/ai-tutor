# Lip-sync measurements

Run against the dev server (`npm run dev`) from `frontend/web`:

- `node scripts/avatar/offset2.mjs` — plays the fixture sentence through the lab's file path
  (`/avatar-lab?head=none`) and cross-correlates the jaw with the recording's envelope, in
  ear time (after `outputLatency`). Expect the best lag around −40 ms (jaw just before the
  sound) with r ≈ 0.9. Before the timeline (2026-10-08) it was +120 ms at r 0.41.
- `node scripts/avatar/align-check.mjs` — prints the aligned viseme segments for the fixture
  sentence ("Peter and Mary bought fresh figs. The moon was full, so we sat by the sea and
  talked about photosynthesis.") with each segment's mean energy, then the live viseme
  stream. Closures (PP) should sit on p/b/m, pauses on the full stop and comma.
- `node scripts/avatar/gemini-probe.mjs` — a real Gemini Live reply through the lab's probe
  (needs the API key the dev server uses); shows the track growing as chunks and words arrive.

The fixture is OpenAI TTS at 24 kHz, Gemini's output rate.
