# Aria — Code Guide (read this before touching anything)

This file replaces the generic `create-next-app` boilerplate that used to be here. It explains,
in plain English, how this app is put together and where to go when you want to change
something specific. If you're new to React/Next.js, read [Section 1](#1-two-ideas-you-need-before-reading-any-code)
first — everything else assumes you understand those two ideas.

For the *product vision* (why this app exists, the accessibility thesis, the roadmap), see
`../../README.md` one level up. This file is about the *code*, not the pitch.

---

## 0. The one-paragraph version

This is a Next.js (React + TypeScript) web app. There is basically **one HTML page** — everything
you see (landing page, mode picker, the lesson players, the "about" page) is a React component
swapped in and out by a single state variable in `app/page.tsx`. Nothing is a separate URL/route
in the browser-address-bar sense; it's all one page pretending to be several. Lessons are either
(a) a hardcoded demo (photosynthesis) written by hand in `lib/lessonContent.ts`, or (b) generated
on the fly by asking OpenAI's GPT-4o for a full lecture script + whiteboard drawing instructions,
via a server-side API route (`app/api/generate-lecture/route.ts`). The "whiteboard" is never an
image — it's a list of drawing commands (draw this shape, add this label, draw an arrow) that gets
replayed on-screen in sync with narration audio.

---

## 1. Two ideas you need before reading any code

### `"use client"` at the top of a file
Next.js (the "App Router" flavor used here) renders components on the **server** by default. Any
component that needs to react to clicks, remember state (`useState`), or use browser-only APIs
(microphone, speech, canvas) has to opt out of that with `"use client";` as the very first line.
Almost every file in `components/` has this, because almost everything here is interactive.

### API routes (`app/api/*/route.ts`)
A file at `app/api/tts/route.ts` automatically becomes a real HTTP endpoint at `/api/tts` — no
manual router setup. You export a function named after the HTTP verb (`export async function POST(req: Request) {...}`)
and Next.js calls it whenever something does `fetch("/api/tts", { method: "POST", ... })`. Code in
these files runs **only on the server**, never in the browser, which is exactly why the OpenAI API
key can live here safely (`process.env.OPENAI_API_KEY`) without ever being visible to a user
inspecting the page.

A folder named `[id]` (e.g. `app/api/session/[id]/advance/`) is Next.js's syntax for a **dynamic
route segment** — it matches any value in that URL position (`/api/session/abc123/advance` →
`id = "abc123"`), read inside the route via `const { id } = await ctx.params;`.

---

## 2. Folder map

```
apps/web/
├── app/
│   ├── page.tsx            # THE router — one state variable decides what's on screen
│   ├── layout.tsx           # wraps every page (fonts, <html>, global CSS import)
│   ├── globals.css          # Tailwind + global styles
│   └── api/                 # server-only endpoints, see Section 6
├── components/
│   ├── pages/               # the "screens": Landing, Tracks, About, Features, Complete, Learn
│   ├── hud/                 # shared UI kit + the TRACKS data (mode names/colors/descriptions)
│   ├── sketch/               # the whiteboard drawing engine actually in use (LiveSketch)
│   ├── whiteboard/           # an OLDER whiteboard engine — not currently used, see Section 8
│   ├── lesson-chat/          # the mid-lecture "ask a follow-up" chat UI
│   ├── LessonPlayer.tsx      # the default lesson player — the one everything else builds on
│   ├── BlindLessonPlayer.tsx, AdhdLessonPlayer.tsx, DyslexiaLessonPlayer.tsx,
│   │   AutismLessonPlayer.tsx, DysgraphiaLessonPlayer.tsx   # accessibility variants
│   └── DisabilitySelect.tsx  # OLDER mode picker — not currently used, see Section 8
├── lib/                     # non-visual helper code: AI prompts, data, browser APIs
└── public/                  # static images
```

---

## 3. How a page loads: `app/page.tsx`

```tsx
const [page, setPage] = useState<PageName>("landing");

const go = useCallback((p: PageName) => {
  setPage(p);
  ...
}, []);

switch (page) {
  case "demo":         return <LessonPlayer onExit={exitToComplete} />;
  case "blind-demo":   return <BlindLessonPlayer onExit={exitToComplete} />;
  ...
  case "landing":
  default:             return <LandingPage go={go} onStart={() => go("tracks")} />;
}
```

`useState` lets the component "remember" a value (`page`) across re-renders; calling `setPage`
changes it and React re-renders with the new value. `PageName` (a union of allowed strings, e.g.
`"landing" | "tracks" | "demo" | ...`) is defined in `components/hud/HudKit.tsx`. The `go` function
is handed down as a prop to every page component, so a button three levels deep can still change
what's on screen by calling `go("tracks")`.

**To add a brand-new page:** add its name to the `PageName` union in `HudKit.tsx`, add a `case` to
this switch, and give your new component a `go` prop so it can navigate onward.

---

## 4. The "screens" (`components/pages/*.tsx`)

| File | What it shows | Notable state | Edit here to change... |
|---|---|---|---|
| `LandingPage.tsx` | Hero headline, mode row, stats, CTA | none (pure props/JSX) | headline/body copy directly |
| `TracksPage.tsx` | The 6-mode gallery + "teach me anything" panel | `active` = hovered mode, drives the detail panel | which mode is highlighted first — but **not** mode text/color, see `tracks.ts` below |
| `AboutPage.tsx` | Mission statement, static | none | mission paragraphs, the 3 value cards |
| `FeaturesPage.tsx` | "How it works" | none — content lives in a `FEATURES` array at the top of the file | edit objects in that array, not the render logic |
| `CompletePage.tsx` | End-of-lesson screen | looks up `lastTrack` in `TRACKS` to theme itself | the `RECAP` bullet array near the top |
| `LearnPage.tsx` | "Teach me anything" builder | `topic`, `mode`, `phase` (`"ask"→"building"→"teaching"`), `beats` | see Section 7 — this is what calls the AI lecture generator |

**`components/hud/tracks.ts`** is the single most important file if you want to rename a mode,
change its tagline/description, or change its accent color — `TRACKS` is one array of objects,
and `LandingPage`, `TracksPage`, `CompletePage`, and `LearnPage` all read from it instead of
hardcoding their own copies. Change it once, it changes everywhere.

**`components/hud/HudKit.tsx`** holds the shared visual shell every page uses: `HudPage` (page
frame), `HudNav` (top bar), `HudButton`, `HudPanel` (the glass card look), plus the `PageName` type.

---

## 5. The Lesson Player family

`components/LessonPlayer.tsx` is the default player and the one every other accessibility variant
either extends or diverges from.

**What it does:** shows one "beat" (a lesson chunk) at a time. Each beat starts on a static
**slide** (`SlideStage`), then flips to the **board** (an animated whiteboard, via `LiveSketch`)
while narration audio plays. When narration finishes it auto-advances to the next beat — unless
the beat is a checkpoint question, in which case it waits for a typed answer.

Key state to know about (all near the top of the file):
- `index` — which beat we're on
- `stage: "slide" | "board"` — which visual is showing
- `sentenceCue` / `drawProgress` — updated as each sentence of narration plays, this is what
  syncs the whiteboard drawing to the voice
- `waitingOnCheckpoint`, `checkpointAttempts` — checkpoint Q&A

Two constants worth knowing if you want to tweak pacing:
- `SLIDE_MS = 1500` — how long the intro slide shows before flipping to the board
- `MAX_ATTEMPTS = 2` — how many wrong checkpoint answers before it reveals the answer

**The variants**, and what each actually changes:
- **`BlindLessonPlayer.tsx`** — no visual board at all. Uses `lib/blindLectureContent.ts` for a
  spoken audio description per beat plus a non-speech "sonic cue" (`lib/sonicCues.ts`). Its own
  state machine (`Phase`) instead of `stage`. Always-on voice control with a wake-word system
  (`"hey nova"`) — simple commands handled locally, fuzzier ones sent to `/api/voice-command`.
- **`AdhdLessonPlayer.tsx`** — literally imports and reuses `Board`, `checkAnswer`, `MAX_ATTEMPTS`
  from `LessonPlayer.tsx`. The only addition is a webcam-based attention monitor
  (`lib/useAttentionMonitor.ts`, MediaPipe face tracking, fully on-device) that hard-pauses the
  lecture when focus drifts and requires a manual "Resume" click.
- **`DyslexiaLessonPlayer.tsx`** — adjustable typography (OpenDyslexic font option), simplified
  text.
- **`DysgraphiaLessonPlayer.tsx`** — replaces typed checkpoint answers with speech input, then
  sends the raw rambling transcript to `/api/restructure` (the "AI scribe") to clean it into
  a tidy paragraph.
- **`AutismLessonPlayer.tsx`** — adds a literal "Explain Simply" rewrite mode and a visible
  Now/Next/Later schedule strip.

---

## 6. The lesson content data — `lib/lessonContent.ts`

This is the actual script and drawing data that drives the hardcoded demo lesson (photosynthesis).
The shape:

```ts
export interface Beat {
  id: string;
  title: string;
  slideKind: SlideKind;      // "intro" | "definition" | "checkpoint" | "compare" | "recap"
  points: string[];
  checkpoint?: CheckpointSpec;
  script: string;            // what the teacher's voice says, word for word
  draw?: DrawScript;         // the whiteboard animation for this beat
}
```

A real example (a checkpoint beat):

```ts
{
  id: "checkpoint-1",
  title: "Quick check",
  slideKind: "checkpoint",
  script: "Let's pause right here before moving on. ...",
  checkpoint: {
    prompt: "What are the three ingredients a leaf needs for photosynthesis?",
    acceptableKeywords: [["sun","water","carbon"], ["light","water","co2"], ...],
    correctFeedback: "Exactly right — sunlight, water, and carbon dioxide.",
    revealAnswer: "The three ingredients are sunlight, water, and carbon dioxide.",
  },
},
```

**To edit the demo lesson's wording, add a beat, or change what's drawn:** edit the `beats` array
in this file directly. `checkAnswer` matching is just "does the typed answer contain any of these
keyword groups" — no AI involved for the hardcoded demo.

### The whiteboard drawing format

Each beat's `draw` is a timeline of typed operations, each with an `at` (0→1) timestamp saying
when during the narration it should appear:

```ts
type DrawOp =
  | { kind: "shape"; shape: DrawShape; x; y; w?; h?; color?; at: number }
  | { kind: "label"; text; x; y; size?; color?; at: number }
  | { kind: "arrow"; x1; y1; x2; y2; curved?; color?; at: number }
  | { kind: "scene"; scene: DrawScene; at: number; endAt?: number }
  | { kind: "motion"; motion: "flow"|"beam"|"orbit"|"collapse"|"pulse"|"reveal"; ... };
```

`components/sketch/LiveSketch.tsx` takes the current `drawProgress` (driven by how far narration
has gotten) and reveals only the ops whose `at` has already passed — that's what makes the board
"draw itself" in sync with the voice instead of popping in all at once.

---

## 7. The AI backend — API routes

These files live under `app/api/` and are called with `fetch(...)` from the components above.
None of this code ever reaches the browser; the `OPENAI_API_KEY` stays server-side.

| Route | Called from | What it does |
|---|---|---|
| `POST /api/generate-lecture` | `LearnPage.tsx` (`build()`) | The big one: GPT-4o writes a full lecture — script, beat structure, whiteboard drawing ops, and image placeholders — as one JSON response, then fills each image placeholder with a real generated picture. Returns real token/image cost. |
| `POST /api/explain` | `components/lesson-chat/LessonChat.tsx` | Mid-lecture "explain this further" — GPT-4o answers a follow-up question and returns one fresh script + whiteboard. |
| `POST /api/restructure` | `DysgraphiaLessonPlayer.tsx` | The "AI scribe" — takes messy speech-to-text and asks GPT-4o-mini to rewrite it as one clean paragraph, no new facts added. |
| `POST /api/tts` | `lib/voice.ts` (`playNarration`) | Text-to-speech. Streams back an mp3 using OpenAI's TTS model with a "warm classroom teacher" instruction. Falls back to the browser's free built-in voice if this fails. |
| `POST /api/voice-command` | `BlindLessonPlayer.tsx` | Interprets what the student said after the wake word — is it a command (stop/next/repeat/...) or an actual question. |
| `app/api/session/*` | *(nothing currently)* | An older, separate lesson-graph engine (create/advance/checkpoint/interrupt). A repo-wide search found no component calling it anymore — it looks orphaned in favor of the `generate-lecture` pipeline above. Don't be surprised if you can't find a button that uses it. |

### Supporting files behind the AI pipeline (`lib/`)

- **`imageGen.ts`** (`fillImageOps`) — turns `{kind:"image", prompt}` placeholders into real
  pictures via OpenAI's image model, in parallel, with a text-only fallback if image generation
  fails so the student never sees a blank board.
- **`drawPrompt.ts`** — the actual instructions given to the AI (a long system prompt) describing
  how to structure a lecture into beats and pick between three board styles (plain text, image +
  callouts, or abstract animation). **This is the file to edit if you want the AI to teach
  differently** — e.g. shorter lectures, different tone, more/fewer checkpoints.
- **`drawSanitize.ts`** — never trusts the AI's raw JSON. Clamps coordinates, maps color names to
  real hex codes, drops unrecognized operation types, and patches obviously broken output (e.g. an
  empty board) so a slightly-wrong AI response can't crash the whiteboard renderer.
- **`speech.ts`** — wraps the browser's built-in speech *recognition* (listening to the student).
- **`voice.ts`** — wraps narration *playback*; calls `/api/tts` by default and silently falls back
  to the browser's own `speechSynthesis` if that fails.
- **`sessionStore.ts`** — a plain in-memory `Map`, used only by the orphaned `/api/session/*`
  flow. Sessions vanish on server restart; this is explicitly MVP-only, not production storage.

---

## 8. Files that look important but aren't currently used

Worth knowing about so you don't waste time editing dead code:

- **`components/Whiteboard.tsx`** and **`components/whiteboard/SketchBoard.tsx`** — an earlier
  whiteboard engine. A repo-wide search found zero `<Whiteboard` usages anywhere. The board that's
  actually rendered today is `components/sketch/LiveSketch.tsx` (Section 6).
- **`components/DisabilitySelect.tsx`** — an earlier mode-picker. `app/page.tsx` renders
  `TracksPage.tsx` instead; this file isn't imported anywhere in the live navigation flow.
- **`app/api/session/*`** and `lib/sessionStore.ts` — see Section 7, no current caller.

---

## 9. Environment variables

The app needs exactly one required secret: **`OPENAI_API_KEY`**, read from
`apps/web/.env.local` (already set up in this project — see the root of the repo for the older,
unused `.env`, which is not read by Next.js and can be ignored/deleted). Every API route checks
for it and returns a clean error instead of crashing if it's missing.

Optional tuning knobs (all have defaults if unset): `OPENAI_LECTURE_MODEL`, `OPENAI_EXPLAIN_MODEL`,
`OPENAI_RESTRUCTURE_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`, `OPENAI_VOICE_MODEL`,
`OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_SIZE`, `OPENAI_IMAGE_QUALITY`, `OPENAI_LECTURE_ATTEMPTS`,
`OPENAI_LECTURE_MAX_TOKENS`, `OPENAI_LECTURE_DEEPEN_ATTEMPTS`.

No extra credentials needed for the mid-lecture "explain this further" question flow's images:
`app/api/explain/route.ts` (via `lib/imageSearch.ts`) looks up a real photo for the question
through an unofficial DuckDuckGo image-search scrape — no API key, no signup. If DuckDuckGo
changes that internal endpoint and the scrape breaks, or no qualifying result comes back, it
falls back to the existing AI image generation automatically — no crash either way. Optional
`IMAGE_SEARCH_KEYWORD_MODEL` overrides the model used to turn the question into a search query
(defaults to `gpt-4o-mini`).

---

## 10. Cookbook — "I want to change X"

| I want to... | Edit this |
|---|---|
| Change the landing page headline/copy | `components/pages/LandingPage.tsx` |
| Rename a mode, change its description/color everywhere | `components/hud/tracks.ts` |
| Change the "How it works" feature text | the `FEATURES` array in `components/pages/FeaturesPage.tsx` |
| Edit the demo (photosynthesis) lesson script/questions | `lib/lessonContent.ts` |
| Change what the AI-generated lectures sound like / how long they are | the system prompt in `lib/drawPrompt.ts` |
| Change the narration voice or tone | `app/api/tts/route.ts` (`VOICE`/`TEACHER_TONE`) or `OPENAI_TTS_VOICE` env var |
| Turn off paid TTS and use only the free browser voice | `CLOUD_TTS_DEFAULT` in `lib/voice.ts` |
| Change how long the intro slide shows, or checkpoint retry limit | `SLIDE_MS` / `MAX_ATTEMPTS` in `components/LessonPlayer.tsx` |
| Add a brand-new page/screen | add a `PageName` in `components/hud/HudKit.tsx`, a `case` in `app/page.tsx`, a new file in `components/pages/` |
| Change which AI model is used, or add cost limits | `.env.local` values, or the `MODEL`/`*_ATTEMPTS`/`*_MAX_TOKENS` constants at the top of each `app/api/*/route.ts` |

---

## 11. Running it

```bash
npm install       # from the ai-tutor/ repo root (npm workspaces)
npm run dev       # starts apps/web on http://localhost:3000
```

Opening pages/clicking through the demo lesson is free. Anything that hits an `app/api/*` route
that calls OpenAI (generating a new lecture, TTS narration, "explain this further", voice
commands) makes a real, billed API call using the key in `.env.local`.
