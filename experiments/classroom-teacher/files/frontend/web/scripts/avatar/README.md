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
- `node scripts/avatar/places.mjs` — walks Aria through her places in `/player-preview` (centre
  stage before Play, the section card at a transition, her column beside the board, the top of
  the questions sheet) and saves `/tmp/aria-place-*.png`. Launches Chromium on the real GPU
  (`--use-angle=metal`): on SwiftShader a masked WebGL canvas never composites, so the head
  looks blank over the board there — that is the software renderer, not the page.
- `node scripts/avatar/classroom-tour.mjs` — plays the classroom demo (`/classroom`) on the real GPU
  for 40 s, printing each second what the teacher's brain is doing (place, activity, clip, pen,
  marker) and saving frames while she writes to `/tmp/classroom-write-*.png`.
- `node scripts/avatar/record-classroom.mjs [seconds] [out.mp4]` — records the classroom demo as a
  shareable MP4 (H.264 + AAC, 1440×900) with Aria's narration: frames from Chrome's screencast on
  the GPU, each narration clip captured when its blob is created and laid onto the timeline by
  ffmpeg. Default 180 s to `~/Downloads/aria-classroom-demo.mp4`.
