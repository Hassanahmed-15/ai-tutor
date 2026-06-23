# Aria — An AI Tutor Built for Every Kind of Mind

> Working name: **Aria** (Adaptive Reasoning & Inclusive Academy). Rename freely — every reference to "Aria" in this repo is just a placeholder for the product name.

Aria is a personalized AI tutor that teaches the way a great human teacher does: live, adaptively, and out loud — not by handing you summaries, flashcards, or static notes. It is built from day one for **both non-disabled and disabled students**, using one shared lesson engine rendered through different "modality lenses" rather than building separate products for each audience.

This document is the single source of truth for the product's architecture, scope, and the reasoning behind every major decision. It is intentionally detailed because the goal of this repo is to *think before we build* — the MVP code will follow this spec, not the other way around.

---

## 1. Honesty clause (read this first)

The user requirement for this project is **100% accuracy** in how this product is represented. So before anything else:

- **No AI tutor — this one included — can guarantee 100% factual correctness from an LLM.** Large language models hallucinate. Anything claiming otherwise is lying to you. What this project *can* commit to is: aggressive grounding (retrieval over curricula/textbooks instead of pure model memory), explicit citations for factual claims, confidence signaling ("I'm not fully sure — let's verify together"), and a design that treats the AI as fallible by default.
- Every architecture decision below is justified with **why**, and every known limitation is stated plainly in [Section 9](#9-known-limitations--non-goals-for-mvp). If something is a placeholder or unsolved problem, it's labeled as such — nothing is dressed up as finished.
- "MVP" means MVP. Section 8 draws a hard line between what ships first and what's future-roadmap.

---

## 2. Product Thesis

Most "AI tutor" products today are really **AI note-takers**: summarize a PDF, generate flashcards, quiz you on recall. That's not teaching — it's compression.

Aria's thesis: **a tutor's value is in live, responsive explanation** — the back-and-forth of "wait, why?", the teacher noticing your face glaze over and trying a different angle, the whiteboard filling up in real time instead of being handed to you finished. So Aria explicitly **does not** do note summarization or flashcards as a primary feature. It teaches live, every time, the same lesson rendered differently depending on who's in front of it.

---

## 3. Who This Is For (MVP Scope)

### 3.1 Non-disabled learners
One target persona for MVP: a self-directed learner (e.g., a student studying a subject outside class, like a CS/math/science topic) who wants the experience of a 1:1 tutor available on demand.

### 3.2 Disabled learners — 4 tracks for MVP
We are explicitly scoping to **4 disability tracks** for the MVP (not building generic "accessibility settings" — each track has a dedicated, researched design):

| Track | Core barrier | Design response |
|---|---|---|
| **Visual impairment** (blind / low vision) | Can't rely on visual slides/whiteboard | Audio-first lesson architecture: every visual is auto-described in real time (live "verbal whiteboard"), full screen-reader semantics, sonified diagrams (non-speech audio cues for shapes/graphs), keyboard/voice-only navigation |
| **Hearing impairment** (deaf / hard of hearing) | Can't rely on narration | Visual-first lesson architecture: synced captions (not just subtitles — emphasis-aware, speaker-paced), the whiteboard becomes the *primary* channel, optional sign-language avatar track |
| **Dyslexia / reading difficulty** | Standard text rendering and pacing causes friction | Dyslexia-safe typography (adjustable font incl. OpenDyslexic, spacing, line length), word-by-word TTS highlighting synced to speech, simplified sentence structure mode |
| **ADHD / attention difficulty** | Long-form linear lectures lose engagement | Micro-lesson chunking, built-in "focus checkpoints" (brief interactive check-ins every N minutes), visible progress/pacing bar, distraction-minimized UI mode |

**Why these 4 and not others (e.g. motor/speech, autism, cognitive disabilities):** these four cover the largest distinct *modality* failure modes (visual channel, audio channel, text-processing, attention/pacing) with the most existing accessibility research and tooling (WCAG, ARIA, established TTS/STT) to build on confidently. Motor/speech and cognitive-disability tracks are real and important — they're explicitly named as **Phase 2 roadmap**, not cut, in [Section 8](#8-mvp-roadmap).

---

## 4. The Signature Feature: The Living Lecture Engine

This is the part designed to be genuinely new, not a repackaging of existing "AI slides" tools.

### 4.1 The problem with existing tools
Existing "AI presentation" tools (Gamma, Tome, etc.) generate a finished deck, then narrate it. It's a recording wearing a live costume. You can't truly interrupt it — at best you pause playback. A real teacher doesn't show you a finished diagram; they **draw it in front of you**, and when you ask "wait, why does that arrow go there?", they erase and redraw, right there, mid-explanation.

### 4.2 The Living Lecture Engine (LLE)
Aria never pre-renders a finished slide. Every lesson is represented internally as a **Lesson Graph** — a structured, ordered graph of "teaching beats" (concept → explanation strategy → visual primitive → checkpoint). The frontend renders this graph **incrementally and live**:

- The whiteboard draws strokes/diagrams progressively (like watching someone actually draw), not a static image fade-in.
- Slides assemble element-by-element in sync with the voiceover (a bullet appears exactly as it's spoken, a diagram's arrow draws as it's explained).
- **Interrupts are first-class, not pause events.** When a student interrupts ("wait, why?"), the system doesn't just stop audio — it:
  1. Freezes the current beat,
  2. Pushes a new branch onto the Lesson Graph for the side-question,
  3. **Visually annotates the existing whiteboard** (circles the confusing part, draws a side-note) rather than wiping it,
  4. Answers, then visually "rewinds" the annotation and resumes the main beat where it left off.

This makes the interrupt feel like talking to a person mid-explanation, not pausing a video.

### 4.3 Confusion Radar (the "surprise me" feature)
The second half of the signature feature, and the part that ties the accessibility tracks and the creative ask together into one mechanism instead of bolting them on separately.

Aria continuously scores a lightweight **engagement/confusion signal** from passively available signals:
- Response latency to checkpoint questions,
- Repeated or rephrased questions on the same concept,
- Explicit "I'm lost" / "slow down" voice or button input,
- *(Opt-in only, off by default)* webcam-based attention/confusion cues via on-device, lightweight expression heuristics — **never stored, never sent to a server, processed locally**, explicitly consent-gated, and trivially toggled off. This is a sensitive feature and is treated as such — see [Section 7.5](#75-privacy--consent-architecture).

When confusion is detected, Aria doesn't just say "let me explain again" — it switches **explanation strategy**: re-explains via analogy instead of definition, switches a verbal explanation into a whiteboard diagram, slows pacing, or shortens the next beat. This is the same underlying mechanism that powers the disability "modality lenses" (Section 5) — confusion-driven adaptation and disability-driven adaptation are the same system, just triggered by different signals. **This unification is the core architectural insight of the product**: accessibility isn't a special mode, it's the same adaptivity engine every learner benefits from, tuned to a different starting signal.

---

## 5. System Architecture

### 5.1 High-level diagram

```
                        ┌─────────────────────────────┐
                        │         Student Client        │
                        │   (Next.js Web App, React)    │
                        │                                │
                        │  Modality Lens Renderer:       │
                        │  - Whiteboard canvas (SVG/     │
                        │    Canvas, progressive draw)   │
                        │  - Slide layer (live-assembled) │
                        │  - Caption / sign-avatar layer  │
                        │  - Audio-description channel    │
                        │  - Dyslexia-safe text layer      │
                        │  - Focus/pacing HUD (ADHD mode)  │
                        └───────────────┬────────────────┘
                                        │ WebSocket (turn-based, low-latency)
                                        ▼
                        ┌─────────────────────────────┐
                        │       Session Orchestrator     │
                        │   (Node.js / Next.js API +     │
                        │    background workers)         │
                        │                                │
                        │  - Turn manager (speak/listen/  │
                        │    interrupt state machine)     │
                        │  - Lesson Graph store (per-      │
                        │    session, append-only)         │
                        │  - Confusion Radar scorer        │
                        │  - Modality Lens selector        │
                        └───────┬───────────┬────────────┘
                                │           │
                  ┌─────────────┘           └─────────────┐
                  ▼                                        ▼
        ┌──────────────────┐                    ┌──────────────────────┐
        │   Tutor Reasoning   │                  │   Content Grounding   │
        │   (LLM orchestration)│                  │   & Retrieval Layer   │
        │                      │                  │                       │
        │  - Socratic dialogue │ ◄──────────────► │  - Curriculum / OER    │
        │    policy             │                 │    corpus (RAG)        │
        │  - Lesson Graph         │                │  - Citation tracker   │
        │    generation            │               │  - Confidence scorer   │
        │  - Explanation-strategy   │              └──────────────────────┘
        │    switcher (analogy/      │
        │    visual/step-by-step)     │
        └──────────┬───────────────┘
                   │
        ┌──────────┴───────────────────────────────┐
        ▼                                            ▼
┌────────────────────┐                  ┌─────────────────────────┐
│   Voice I/O Layer     │                │   Visual Generation Layer │
│                        │                │                          │
│  - STT (speech-to-text)│                │  - Whiteboard stroke gen  │
│  - TTS (text-to-speech, │                │    (structured drawing     │
│    expressive, low-      │              │    commands, not images)   │
│    latency)               │             │  - Slide element gen        │
│  - Turn-detection           │            │    (structured layout JSON)  │
│    (when did the student     │          │  - Diagram/chart primitives   │
│    actually finish talking?)   │        │  - (Optional) sign-language    │
└────────────────────┘                    │    avatar renderer              │
                                           └─────────────────────────┘
```

### 5.2 Why these architectural choices

**Lesson Graph as structured data, not generated images/video.**
The whiteboard and slides are never raster images or generated video — they're rendered client-side from structured drawing/layout commands (e.g. "draw circle at (x,y), label it 'mitochondria', draw arrow to label"). This is the single most important architectural decision in the system, because it's what makes *every other feature possible*:
- It's what lets interrupts annotate instead of regenerating from scratch (Section 4.2).
- It's what lets the same lesson render as whiteboard for sighted users and as structured audio description for blind users — **one source of truth, multiple renderers** (Section 5.3).
- It's dramatically cheaper and faster than calling a video/image generation model per slide, which matters for an MVP's unit economics and latency budget.
- It's inspectable/debuggable — you can log and replay exactly what was "drawn," which generated video cannot give you.

**Turn-based voice, not full-duplex real-time streaming, for MVP.**
A true "phone call" experience (continuous bidirectional audio, interrupt-anywhere) needs a low-latency streaming STT→LLM→TTS pipeline (e.g., WebRTC-based realtime APIs) — it's the right end-state, but it's also the highest-complexity, highest-cost part of the system to get right (interruption handling, turn-taking detection, latency budgets under ~300ms). For MVP, Aria uses **fast turn-based voice**: the student holds a button or says a wake phrase to interrupt, the system treats that as a hard interrupt signal into the Lesson Graph (Section 4.2), responds, then resumes. This still feels conversational and live, but de-risks the hardest real-time-audio engineering problem until the core teaching-loop is validated. Full-duplex streaming is explicitly Phase 2 (Section 8).

**Modality Lens architecture (one Lesson Graph, many renderers), not 5 separate apps.**
Each disability track is a renderer/lens over the same Lesson Graph, not a forked product. Concretely: the Tutor Reasoning layer never says "draw a circle in blue" — it emits a modality-agnostic node like `{type: "diagram", concept: "atom structure", relations: [...]}`, and each lens decides how to express it (visual diagram vs. spoken structural description vs. captioned diagram + sign-avatar cue vs. simplified-text diagram description). This is *why* this is one product and not five, and it's also what makes the Confusion Radar and disability adaptation the same underlying mechanism (Section 4.3).

**RAG-grounded content layer, not raw LLM memory.**
Given the 100%-accuracy requirement is a hard goal of this conversation (acknowledged as unattainable in absolute terms per Section 1), the architecture's job is to get as close as honestly possible: lessons are generated by retrieving from a curated curriculum/OER (open educational res源ce) corpus per topic, with citations attached to factual claims, rather than relying on raw model knowledge. The Confidence Scorer flags low-grounding claims so the tutor can say "I'm not certain about this — let's double check" instead of asserting confidently.

**Next.js (React) full-stack, single language.**
Chosen because: (1) one language (TypeScript) across frontend/backend lowers MVP build time and solo-maintainability; (2) React has the most mature accessibility primitives available (React Aria, robust ARIA support) which matters enormously given the product's core audience; (3) Next.js API routes + edge/background workers are sufficient for the orchestration and WebSocket needs of a turn-based (not full-duplex-streaming) MVP; (4) trivial to deploy (Vercel or similar) for fast iteration.

### 5.3 The Modality Lens, in detail

```
Lesson Graph Node (modality-agnostic)
   {
     type: "diagram" | "definition" | "example" | "checkpoint" | "analogy",
     concept: string,
     content: structured (not prose-only),
     relations: [...],
     citations: [...]
   }
            │
            ▼
   ┌─────────────────────────────────────────────┐
   │              Modality Lens Selector            │
   │   (picks lens per student profile + live        │
   │    Confusion Radar signal)                       │
   └───────┬───────┬───────┬───────┬───────┬────────┘
           ▼       ▼       ▼       ▼       ▼
       Default  Visual  Hearing  Dyslexia  ADHD
       (sighted, Impair-  Impair-  Lens      Lens
       hearing)  ment     ment
       Lens      Lens     Lens
```

Each lens is a renderer module with one contract: given a Lesson Graph node, produce the modality-appropriate output. This means adding a 5th, 6th, 7th disability track later (Section 8 — motor/speech, cognitive, autism) is "write a new lens," not "rebuild the product."

---

## 6. Example End-to-End Flow

**Non-disabled student, asks: "Can you teach me how binary search works?"**

1. Student speaks (or types) the question. STT transcribes (if voice).
2. Session Orchestrator opens a new Lesson Graph for "binary search."
3. Tutor Reasoning retrieves grounded content (CS curriculum corpus), drafts a teaching sequence: hook/motivation → naive linear search → the insight → step-by-step visual walkthrough → checkpoint question → recap.
4. Visual Generation Layer emits structured drawing commands for an array + pointer diagram.
5. Default Lens renders: whiteboard draws the array live, TTS narrates in sync, bullets assemble on a side slide as spoken.
6. Mid-explanation, student interrupts: **"Wait, why do we ignore half the array?"**
7. Turn manager fires a hard interrupt → Lesson Graph pushes a branch node → Visual layer **annotates the existing diagram** (circles the discarded half, draws a small side-note) instead of redrawing from scratch → Tutor Reasoning answers the sub-question with an analogy ("like a phone book — you don't check every page") → resumes main beat, visually "clears" the annotation.
8. At a natural checkpoint, Aria asks the student to predict the next step out loud — Confusion Radar scores the response latency/correctness.
9. Lesson ends with a live worked example chosen adaptively based on how step 8 went — **not** a generated summary doc or flashcard set (explicitly against the product thesis, Section 2).

**Blind student, same topic:**
Same Lesson Graph, same step 1–4. At step 5, the **Visual Impairment Lens** instead renders: full audio-first narration where every diagram update is described structurally as part of the narration itself ("the array now has 8 elements; we check the middle one, index 3, value 12 — too high, so we discard indices 4 through 7"), sonified cues (a distinct tone marks "discarding a half" each time it happens, building intuition through sound), and full keyboard/voice control for navigation, pause, and interrupt. The interrupt mechanism (step 6–7) is identical — the annotation is just spoken instead of drawn.

---

## 7. Key Subsystems

### 7.1 Tutor Reasoning Layer
- LLM-driven, prompts engineered around a **Socratic-first policy**: prefers asking a guiding question over giving the answer outright, falls back to direct explanation if the student is stuck twice.
- Generates the Lesson Graph as structured output (not freeform prose) so the rest of the system can render it.
- Explanation-strategy switcher: maintains 3–4 "ways to explain X" (formal definition, analogy, worked example, visual-first) and picks/swaps based on Confusion Radar signal.

### 7.2 Content Grounding & Retrieval Layer
- RAG over a curated open educational resource (OER) corpus per subject (MVP: pick 1–2 subjects to seed deeply rather than shallow coverage of many — recommend starting with a CS/math topic given verifiability of correctness).
- Every factual claim in a Lesson Graph node carries a citation pointer back to source material where possible.
- Confidence Scorer flags ungrounded claims for hedged phrasing rather than confident assertion.

### 7.3 Voice I/O Layer
- STT + TTS providers chosen for low latency and expressive, natural-sounding output (a flat robotic voice undermines the entire "feels like a real teacher" thesis).
- Turn-detection: in MVP, a push-to-talk or explicit "wake" interrupt rather than always-on voice-activity-detection, to avoid false-positive interrupts breaking the lecture flow.

### 7.4 Visual Generation Layer
- Whiteboard: structured drawing-command format (think: a minimal scene-graph/DSL), rendered progressively client-side via Canvas/SVG — not server-rendered images.
- Slides: structured layout JSON (elements + positions + reveal-timing), assembled client-side in sync with TTS timestamps.
- Diagrams/charts: a small library of primitive types (graph, array, tree, timeline, comparison-table) covering common teaching patterns, rather than unconstrained generative drawing — keeps quality and accessibility-mapping consistent.

### 7.5 Privacy & Consent Architecture
- Webcam-based confusion detection (Section 4.3) is **opt-in, off by default, processed on-device only**, with a persistent visible indicator whenever active and a one-tap kill switch.
- No raw audio/video is ever sent to a server or stored; only derived, ephemeral signals (e.g., a confusion score 0–1) ever leave the client, and only when a student is signed in and has opted in.
- This section will be expanded into a full data-handling policy before any real user data is collected — flagged here as a hard requirement, not an afterthought.

---

## 8. MVP Roadmap

### Phase 0 — MVP (this repo's current scope)
- [ ] One subject seeded deeply (recommend: a CS fundamentals or algebra topic) with a real OER-grounded corpus
- [ ] Lesson Graph generation + Tutor Reasoning loop (text-first, to validate the teaching policy before adding voice complexity)
- [ ] Whiteboard + slide live-rendering from structured commands
- [ ] Turn-based voice I/O (STT/TTS), push-to-talk interrupt model
- [ ] Living Lecture Engine: interrupt-as-annotation behavior (Section 4.2)
- [ ] Confusion Radar v1: latency + repeated-question signals only (no webcam yet)
- [ ] 4 Modality Lenses: Visual impairment, Hearing impairment, Dyslexia, ADHD
- [ ] Basic auth + per-student profile (disability track preference, stored explicitly and changeable any time)

### Phase 1 — Post-MVP hardening
- [ ] Full-duplex real-time streaming voice (true interrupt-anywhere)
- [ ] Opt-in webcam-based Confusion Radar signal (on-device processing)
- [ ] Sign-language avatar track for Hearing Impairment lens
- [ ] Expand subject corpus breadth

### Phase 2 — Roadmap (not cut, deliberately sequenced)
- [ ] Motor/speech impairment track (alternative input: switch access, eye-tracking-friendly UI, voice-only full control)
- [ ] Cognitive/intellectual disability track (simplified-language lens, concrete-example-first policy)
- [ ] Autism-spectrum track (predictable structure mode, sensory-load controls, literal-explanation mode)
- [ ] Teacher/parent dashboard (progress visibility — explicitly not a "summary/notes" feature for the student themselves, per Section 2)

---

## 9. Known Limitations & Non-Goals for MVP

Stated plainly, per Section 1's honesty commitment:

- **Not 100% factually accurate.** Grounding and citations reduce hallucination risk; they do not eliminate it. The product will always be designed to communicate uncertainty rather than claim infallibility.
- **Not full-duplex real-time voice at launch.** Turn-based/push-to-talk only in MVP; this is a deliberate scope cut, not an oversight (Section 5.2).
- **Not a note-taking, summarization, or flashcard tool — by design**, not as a missing feature. If that's what's needed, other tools already do it well; Aria's entire reason to exist is the live-teaching gap.
- **Sign-language avatar is not in MVP** — listed honestly as Phase 1, not implied as already supported by "Hearing Impairment Lens."
- **Single/narrow subject depth in MVP**, not broad curriculum coverage — intentional, to validate the teaching loop and accessibility lenses on solid ground before scaling content breadth.
- **Webcam-based confusion detection is not in MVP** — text/voice-interaction signals only at first; the privacy-sensitive camera feature ships later and only with the consent architecture in Section 7.5 fully built, not bolted on after the fact.

---

## 10. Repository Structure (planned)

```
ai-tutor/
├── README.md                 # this file
├── docs/                     # architecture deep-dives, ADRs, design notes
├── apps/
│   └── web/                  # Next.js application (frontend + API routes)
├── packages/
│   ├── lesson-graph/         # Lesson Graph schema + generation logic
│   ├── modality-lenses/      # one module per lens (visual/hearing/dyslexia/adhd/default)
│   ├── voice-io/             # STT/TTS integration layer
│   ├── visual-gen/           # whiteboard/slide structured-command generation + renderers
│   └── grounding/            # RAG/retrieval + citation + confidence scoring
└── content/                  # seeded curriculum/OER corpus for MVP subject(s)
```

This structure is not yet created in full — it will be scaffolded incrementally as each subsystem above is actually built, so the repo never has empty placeholder folders pretending to be implemented features.

---

## 11. Contributing / Next Steps

This README is the architecture contract for the project. The next steps from here:
1. Pick the MVP subject (Section 8, Phase 0) and seed its corpus.
2. Define the Lesson Graph schema precisely (types, not just prose) in `packages/lesson-graph`.
3. Build the text-first Tutor Reasoning loop before adding voice — validate the teaching policy is good before adding I/O complexity.
4. Layer in the Default + one disability lens first, prove the Modality Lens contract works, then add the remaining three.
