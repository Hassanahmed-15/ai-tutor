# Aria — What It Is, How It Works, and Where It Sells

**Audience:** Executive / CTO briefing
**Date:** July 2026

---

## 1. The one-line version

Every AI education product on the market **tells the student the answer**. Aria **teaches** — it talks, it draws on a board *while* it talks, and the student can cut in mid-sentence with "wait, why?" without it losing its place.

That sounds small. It is the entire difference between a search engine and a teacher.

---

## 2. The story: what actually happens in a lesson

This is the workflow, start to finish, as a student experiences it.

### Step 1 — The student says what they want to learn
They type or say it: *"Teach me photosynthesis."* No syllabus, no textbook upload, no course to enrol in. Any topic.

### Step 2 — Aria plans the whole lecture before it opens its mouth
Aria doesn't improvise sentence by sentence. It writes the **entire lecture as a sequence of teaching beats** first — the hook, the core idea, the worked example, the checkpoint question, the recap — so the lesson is coherent from beginning to end and nothing repeats or contradicts itself later.

For each beat, it decides *how that idea is best taught*: does this need a diagram drawn on the board? A real photograph? A question thrown back at the student?

**This is the first thing nobody else does.** A chatbot has no plan; it just responds. Aria has a lesson.

### Step 3 — The board draws itself, in time with the voice
Aria starts speaking — and as it speaks, **the board fills in underneath it**. The arrow appears at the exact moment it says "and this feeds into that." A label is written the instant it's mentioned.

The board is not an image it generated and pasted up. It's being **drawn, stroke by stroke, in sync with the sentence being spoken** — the way a teacher at a chalkboard actually works.

### Step 4 — The student interrupts
This is the heart of the product.

The student says *"wait — why does the arrow go there?"* Aria:

1. **Stops** where it stands.
2. **Circles the confusing thing on the board it already drew** — it does not wipe the board and start over.
3. **Answers the actual question**, often by switching tactics — if the definition didn't land, it tries an analogy.
4. **Erases the annotation and picks the lesson back up exactly where it left off.**

Compare that to what exists: a chatbot resets and answers in a wall of text. A video pauses. Neither of them can circle the thing you didn't understand, because neither of them drew it.

### Step 5 — Aria notices when the student is lost
It doesn't wait to be told. It watches for the signals a human teacher watches for — how long the student takes to answer a checkpoint, whether they ask the same thing twice, and (optionally) whether their attention has visibly drifted from the screen.

When it detects confusion, it doesn't repeat itself louder. **It changes the explanation strategy** — swaps a formal definition for an analogy, turns a verbal explanation into a drawing, slows down, or shortens the next chunk.

*(The attention sensing runs entirely on the student's own device. No video ever leaves their browser.)*

### Step 6 — The same lesson, rendered for a different mind
Here is where it compounds.

Because Aria **composes** a lesson rather than rendering a picture, that same lesson can be delivered six different ways from one source:

| Mode | What changes |
|---|---|
| **Standard** | Board draws, voice narrates, student can interrupt |
| **Blind** | The board is **spoken aloud as it is drawn** — "the arrow now runs from light to glucose" — plus full voice control. The lesson is not reduced; it's re-rendered. |
| **Dyslexia** | Dyslexia-safe typography, re-paced narration, word-level highlighting synced to the voice |
| **Dysgraphia** | The student never has to write to participate — answering is by voice |
| **ADHD** | Chunked into short beats, with the tutor actively re-engaging when attention drifts |
| **Autism** | Predictable structure, sensory load controls, literal-explanation mode |

**A competitor whose slide is just an image cannot do this.** Once you've flattened a diagram into a picture, the meaning is gone — you cannot speak it aloud to a blind student, because there's nothing left to speak. Aria never flattens it. That is not a feature we added; it falls out of having built the thing correctly.

---

## 3. Why this is genuinely innovative — and not just another AI tutor

### The market is crowded, but it's crowded in *one corner*

There are **2,800+ AI education startups operating in 2026** — an 18x jump from 2023 — and they raised **$4.2 billion in venture capital in 2025 alone**. AI tutoring took more VC than any other education-AI category.

But look at *what* they built. Content generation is by far the most crowded category — roughly **400 startups** doing essentially the same thing: generate a worksheet, a summary, a deck, a quiz.

Almost the entire market is racing to build **better answer machines**. Nobody is building a **teacher**.

### The competitive map

| Player | What it does | What it can't do |
|---|---|---|
| **Khanmigo** (Khan Academy) | Socratic chat tutor over Khan's curriculum. The strongest player. | It's a **chat window**. It talks; it doesn't draw. Bound to Khan's existing content. |
| **ChatGPT / general chatbots** | Answers any question you can already articulate | No lesson, no board, no pacing, no plan. You must already know what to ask. |
| **MagicSchool, Diffit, and ~400 others** | Generate worksheets, summaries, reading-level-adapted text | Teacher-facing content factories. They make **materials**, not lessons. |
| **Gamma, Tome and AI deck tools** | Generate a finished slide deck and narrate it | A recording in a live costume. You can pause it — you can't *interrupt* it. |
| **Synthesia and AI video tools** | Generate a talking-head video lecture | Immutable. It cannot respond, adapt, or be asked a question. |
| **Khan Academy's classic videos** | Hand-drawn, dynamic, genuinely good teaching | **Pre-recorded.** Fixed pace, one explanation, no interruption, no adaptation, no accessibility re-rendering. |
| **Aria** | Plans a lecture, draws it live in sync with speech, is interruptible mid-sentence, adapts when the student is lost, and renders the same lesson for six different minds | — |

### The evidence that drawing-while-speaking actually teaches better

This isn't an aesthetic preference. It's the most robustly supported finding in multimedia learning research.

A University of California, Santa Barbara study had students watch the same explanation of the Doppler effect in two formats: **narration over a finished static diagram** (the PowerPoint model — and the model every AI deck tool has copied), versus **the same diagram being drawn by the instructor as they spoke** (the Khan Academy model).

**The dynamic-drawing version produced measurably better retention and transfer.** Showing the drawing being built engages both the verbal and visual channels with complementary information, instead of forcing the student to split attention between a finished picture and a voice.

Here is the punchline: **every AI education tool on the market builds the losing format.** They generate a completed slide and talk over it. That is precisely the condition the research shows is *worse*.

Aria is the only product that generates the *winning* format — and it's the only one that does it live, and interruptibly, which even Khan Academy's videos can't do.

### So the innovation, stated plainly

Three things exist separately in the market today. **Nobody has combined them:**

1. **Dynamic drawing synced to speech** — proven to teach better; only Khan Academy does it, and only pre-recorded.
2. **True conversational interruption** — chatbots have conversation but no lesson; videos have a lesson but no conversation.
3. **One lesson, many minds** — accessibility as a *rendering* of the same lesson, not a separate, lesser product.

Aria is the intersection. That intersection is empty.

---

## 4. Where it sells

Ranked by how quickly it converts.

### 1. Students with learning differences — dyslexia, ADHD, dysgraphia, autism, blindness
**The wedge. Start here.**

**Why:** These families are already paying, already frustrated, and already underserved. Specialist tutors run **$60–100/hour**, often require months on a waitlist, and frequently aren't available locally at all. And the specialist a family finally finds teaches *reading* — not chemistry, not algebra, not history.

Aria is a specialist tutor for **every subject**, available instantly, at a subscription price.

**Why it's also the smartest wedge strategically:** it's the market where our advantage is not incremental but *categorical*. A chatbot cannot serve a blind student at all. We can. There is no competition to displace, because nobody is there.

---

### 2. Self-directed learners who want to actually *understand* something
**The volume market.**

**Why:** The person teaching themselves a new subject — a career-switcher learning machine learning, a student who fell behind in calculus, a professional picking up finance — currently has two bad options: read a wall of chatbot text, or watch a fixed-pace video that can't hear their questions.

They don't want a summary. They want the thing a good teacher does: draw it, explain it, and let them ask.

**Why it matters:** this is where the market is big, and where our "it feels like a real teacher" thesis either lands or doesn't. It's also the fastest path to usage data.

---

### 3. Schools and universities — as a teaching assistant, not a replacement
**The big contracts, and the slowest.**

**Why:** One teacher cannot deliver thirty simultaneous 1:1 explanations at thirty different paces. That's not a failing of teachers — it's arithmetic. Aria gives every student in the room a tutor who will re-explain the same concept a fifth time without impatience, in whatever way that particular student needs it.

Institutions also badly need to serve students with learning differences and mostly cannot staff for it. We serve those students by default rather than as an add-on.

**Reality check:** institutional sales cycles run 9–18 months. Run this motion *behind* the consumer motion, funded by it.

---

### 4. Corporate training
**Big budgets, fast decisions, low friction.**

**Why:** Corporate training today is a video and a quiz, completed by clicking "next" without watching. It's a compliance ritual, not learning, and every L&D leader knows it. Aria turns it into a live, interruptible lesson where an employee can ask the question they're too embarrassed to ask a room.

Enterprise budgets are large, procurement is fast, and there's none of the political friction of selling into schools.

---

### 5. Test prep and exam coaching
**Later, but obvious.**

The board *is* the product here — a maths or physics problem worked out live, step by step, where the student can stop it at the exact line they lost the thread. Static explanations are terrible at this. Drawing is what it demands.

---

## 5. Honest status

**Working today:** Live lessons with a board that draws itself in sync with the voice; true mid-lesson interruption with annotate-and-resume; six delivery modes shipped (standard, blind, dyslexia, dysgraphia, ADHD, autism); voice interaction; on-device attention sensing; lecture generation for any topic a student types in.

**Not built yet:** Full source-grounding and citations; accounts and saved progress; any efficacy evidence of our own.

It's a working product, not a mockup. But the gap between "working" and "sellable" is real, and it's what the next phase is for.

---

## 6. The ask

1. **Two engineers, twelve weeks** — grounding and citations, accounts, and hardening.
2. **A small efficacy study** — the research says dynamic drawing teaches better; we should be the ones who prove *our* version does. That evidence is the single most valuable sales asset we could own.
3. **Ship the consumer motion first** — dyslexia/ADHD families and self-directed learners. It earns revenue and usage data while the institutional deals mature.

---

## Sources

- [Grand View Research — AI Tutors Market Size, Share & Trends, 2026–2033](https://www.grandviewresearch.com/industry-analysis/ai-tutors-market-report)
- [EduGenius — Education AI Startup Landscape 2026](https://www.edugenius.app/blog/education-ai-startup-landscape-2026)
- [Fiorella & Mayer (UC Santa Barbara) — dynamic drawing vs. static diagrams, Journal of Educational Psychology](https://psycnet.apa.org/manuscript/2018-58542-001.pdf)
- [CBE—Life Sciences Education — Effective Educational Videos: Principles and Guidelines](https://www.lifescied.org/doi/10.1187/cbe.16-03-0125)
- [The Learning Scientists — Multimedia Learning: Back to the Drawing Board?](https://www.learningscientists.org/blog/2017/1/24-1)
