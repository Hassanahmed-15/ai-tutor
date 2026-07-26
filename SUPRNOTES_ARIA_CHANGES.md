# Aria × Suprnotes — branch `suprnotesXaria`

Everything in this document was built on the `suprnotesXaria` branch (created from `main`). It turns
the prototype into a task-folder-driven, classroom-style AI tutor: you upload a Suprnotes **task
folder**, the app extracts the notes/images/relevance itself, plans a lecture, and teaches it on a
hand-drawn board with a full-duplex voice tutor, on-device engagement sensing, and a two-way board.

---

## Features implemented

### 1. Task-folder ingestion → lecture
- Upload a **task folder** as the only input. The app extracts `generated_notes.md`, `yolo_output/`
  images, `relevant_images.json` (relevance scores), and `detected_subject.json` itself, adapts them
  into the internal `suprnotes.lesson_input.v1` schema, and generates a full lecture.
- Multi-agent generation pipeline (Director → Chalkboard engine → React-animation engine →
  Image-Explainer → grounding verifier → vision board critic), streamed to the client as NDJSON.

### 2. Real classroom board ("write-then-tell")
- Stroke-by-stroke board reveal **synced to the narration** — the teacher writes, then explains,
  sentence by sentence (ops tagged with a sentence group; the audio clock drives the reveal).
- Handwriting look, real math rendering (KaTeX), single-column layout that never overlaps text.
- Animations rendered as **React in a sandbox**; provided task-folder images are explained by a
  grounded image-explainer (labels/callouts describe what's actually in the image).

### 3. Full-duplex voice tutor (OpenAI Realtime, WebRTC)
- Always-on mic; the student can interrupt and cross-talk at any time (server VAD + barge-in).
- **Single-speaker voice pipeline** rebuilt around one arbiter and one state machine so the teacher
  narration and the chatbot voice can **never overlap**:
  - `useVoiceDirector` owns every sound; the teacher only starts/resumes while the chatbot is silent
    (checked via a synchronous "is she speaking" signal, not laggy React state).
  - `lessonMachine` is the single lesson state (`idle | teaching | chatting | quizzing | paused`);
    `requestResume()` is the only door back to `teaching`.
  - Turn-completion is a **debounced "chatbot settled" detector** driven by real audio-playback
    events, so the lecture resumes only after her audio has truly drained (no talking over her tail),
    and silent tool calls (e.g. `resume_lecture`) never leave the lecture stuck paused.
- Ask → chatbot activates, lecture **pauses**, and stays paused until you press Resume or say so.

### 4. Engagement sensing + adaptive check-ins (standard AND ADHD tracks)
- Camera permission is asked up front (consent-gated, **on-device only**, never uploaded).
- **Multi-factor engagement rate**, always shown at the top: blends the on-device MediaPipe attention
  signal (when granted) with behavioural signals (idle time, questions asked, checkpoint misses,
  drift), so it degrades gracefully with the camera off.
- Bands: **below 30 →** the lecture pauses automatically; **30–50 →** the *teacher* gives a short
  **non-blocking spoken nudge** and the lecture keeps going (it never stalls). A periodic
  "is this landing?" nudge fires every few sections.
- Sustained attention drift → focus-pause overlay (manual Resume only).

### 5. Two-way board — draw & highlight
- **Draw:** sketch on the board; Aria reads the sketch (GPT-4o vision) and has it in context.
- **Highlight & explain (new):** sweep a translucent marker over any board text; the exact text under
  the marker is read from the DOM (`document.elementsFromPoint`, no vision guesswork), handed to the
  chatbot as context, and — on "Explain this in detail" — the chatbot explains **that** by voice
  (no new animation drawn). The marker is light and never obscures the highlighted text.

### 6. Retention & cost features
- **Lesson caching** keyed by content hash — replaying the same task folder is instant and free
  instead of re-running the ~$0.25 / ~90 s pipeline (`CACHE_VERSION` bump invalidates on engine
  changes).
- **PDF export** of the board + transcript (per-beat board image via SVG→PNG with `@resvg/resvg-js`
  and `pdf-lib`).
- **Confusion Radar** — per-beat confusion score (checkpoint misses, repeats, questions, optional
  camera) that eases the pace and offers a re-explanation.
- Accessibility: deaf/caption-first mode retained; comprehension checkpoints.

### 7. Business docs
- `docs/USE-CASES.md` + `docs/Aria-Use-Cases.docx` / `.pdf` — US-market use-cases / USP pitch.

---

## Files changed on this branch

### New files
**Voice pipeline & lesson state**
- `frontend/web/lib/useVoiceDirector.ts` — single audio arbiter (teacher vs chatbot, never both).
- `frontend/web/lib/lessonMachine.ts` — single lesson state machine + `requestResume` chokepoint.
- `frontend/web/lib/useTeacherQuiz.ts` — teacher-asks-and-waits flow (mic-muted answer capture).

**Engagement / adaptivity**
- `frontend/web/lib/useEngagementScore.ts` — multi-factor engagement rate (camera + behaviour).
- `frontend/web/lib/useConfusionRadar.ts` — per-beat confusion score.
- `frontend/web/components/EngagementMeter.tsx` — always-visible engagement badge.
- `frontend/web/components/FocusPauseOverlay.tsx` — drift pause overlay.
- `frontend/web/components/QuizPrompt.tsx` — on-board question card.

**Two-way board**
- `frontend/web/components/sketch/DrawOverlay.tsx` — freehand sketch surface.
- `frontend/web/components/sketch/HighlightOverlay.tsx` — highlighter + DOM-text extraction.

**Task-folder ingestion & board rendering helpers**
- `frontend/web/lib/markdownSource.ts` — task-folder → `suprnotes.lesson_input.v1` adapter.
- `frontend/web/lib/imageVision.ts`, `frontend/web/lib/imageCalloutGen.ts` — grounded image explain.
- `frontend/web/lib/boardSvgSerializer.ts`, `frontend/web/lib/boardVisionCritic.ts` — board→SVG + critic.
- `frontend/web/lib/lectureCache.ts` — filesystem lesson cache.
- `backend/suprnotes-adapter/folder-to-lesson-input.mjs` — folder adapter script.

**API routes**
- `frontend/web/app/api/ask-drawing/route.ts` — read the student's sketch (vision).
- `frontend/web/app/api/grade-answer/route.ts` — grade a spoken answer (gpt-4o-mini).
- `frontend/web/app/api/export-pdf/route.ts` — board + transcript → PDF.

**Docs**
- `docs/USE-CASES.md`, `docs/Aria-Use-Cases.docx`, `docs/Aria-Use-Cases.pdf`.

### Modified files
- `frontend/web/components/LessonPlayer.tsx` — standard player rewired onto the director + machine;
  engagement bands, nudges, draw + **highlight** modes, caching/PDF/radar wiring, header controls.
- `frontend/web/components/AdhdLessonPlayer.tsx` — ADHD track on the same director + machine; draw/
  highlight, engagement parity.
- `frontend/web/lib/useRealtimeTutor.ts` — expose `silence()` / `isSpeaking()`; debounced settle
  turn-completion; lecture-control tools; board-chain handling.
- `frontend/web/lib/voice.ts` — `NarrationHandle` pause/resume-in-place; `preserveActive` utterances.
- `frontend/web/lib/suprnotes.ts`, `frontend/web/lib/blackboardGen.ts`,
  `frontend/web/lib/reactAnimationGen.ts`, `frontend/web/lib/drawPrompt.ts`,
  `frontend/web/lib/drawSanitize.ts`, `frontend/web/components/sketch/LiveSketch.tsx` — board quality
  (overlap fixes, chalk fallbacks, animation reliability, prompts).
- `frontend/web/app/api/generate-lecture/route.ts` — cache hit/write, vision pass, specialist fills.
- `frontend/web/app/api/realtime-session/route.ts` — realtime ephemeral session + lecture-control tools.
- `frontend/web/app/api/tts/route.ts`, `frontend/web/app/layout.tsx`,
  `frontend/web/components/pages/LearnPage.tsx` — TTS, handwriting fonts, upload entry.
- `frontend/web/package.json`, `package-lock.json` — deps: `@resvg/resvg-js`, `katex`, `pdf-lib`.
- `frontend/web/next.config.ts`, `frontend/web/.gitignore` — config + ignore `.lecture-cache/`.
- `apps/web/next-env.d.ts` — workspace scaffolding.

---

## Notes
- Secrets stay local: `frontend/web/.env.local` (OpenAI key + feature flags) and `.lecture-cache/`
  are gitignored and are **not** part of this branch.
- Requires `OPENAI_API_KEY` and the realtime/animation/blackboard feature flags in `.env.local`.
