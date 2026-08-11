# Getting this running — `animations-fixed`

Everything needed to go from a fresh clone to generating a lecture. Works on macOS, Windows and
Linux. If you only read one section, read **Step 2** — it is where people get stuck.

---

## Step 0 — Prerequisites

| Need | Version | Check |
|---|---|---|
| Node.js | **20 or newer** | `node --version` |
| npm | ships with Node | `npm --version` |
| git | any | `git --version` |
| An OpenAI API key | with GPT-5 access | see Step 3 |

Python is **not** required. It is only used by Manim, which nothing routes to any more.

## Step 1 — Clone and switch to this branch

```bash
git clone https://github.com/Hassanahmed-15/ai-tutor
cd ai-tutor
git checkout animations-fixed
cd frontend/web
```

Every command below runs from `frontend/web`, not the repo root.

## Step 2 — Install (read this one)

```bash
rm -rf node_modules          # Windows: rmdir /s /q node_modules
npm install
npx playwright install chromium
```

**Never copy or sync `node_modules` from another machine.** `@resvg/resvg-js` ships a *different
native binary per platform*, and it is the rasteriser the quality critic uses. With the wrong one the
critic cannot see the board, reports "could not look", and — deliberately, so a broken rasteriser
never rejects good work — the pipeline **ships the board unjudged with no error**. Your boards quietly
get worse and nothing tells you why. This has bitten this project twice.

`npx playwright install chromium` is separate from `npm install`: the npm package does not download
the browser, and the verification scripts need it.

## Step 3 — Create `.env.local`

This file is git-ignored, so it will **not** exist after cloning. Create `frontend/web/.env.local`:

```bash
OPENAI_API_KEY=sk-your-key-here

# The board draughtsman. WITHOUT THIS the code silently falls back to gpt-4o and every
# animation is mediocre with no error anywhere. This was the single biggest quality bug
# in the project's history.
OPENAI_ANIMATION_MODEL=gpt-5.5

REACT_ANIMATIONS_ENABLED=1
NEXT_PUBLIC_REACT_ANIMATIONS_ENABLED=1
BLACKBOARD_GEN_ENABLED=1
```

That is the minimum. Optional knobs and their defaults are documented in
[ANIMATIONS.md](./ANIMATIONS.md#2-envlocal).

## Step 4 — Run

```bash
npm run dev
```

Open <http://localhost:3000>, type a topic, and wait. **A lecture takes 3-5 minutes and costs about
$0.80-$1.50** — it is doing real model work per beat, not loading a page. If the browser says
`Failed to fetch`, the dev server is not running or is still compiling; check the terminal.

Useful dev pages, none of which call a model:

| Route | Shows |
|---|---|
| `/board-lab` | Vega-Lite charts and KaTeX derivations on fixed specs |
| `/structure-lab` | ELK structure diagrams |
| `/gsap-lab` | anime.js morphs |
| `/sandbox-lab` | one generated React board (this one *does* call a model, ~$0.10) |

## Step 5 — Verify your setup

Run these **in order** and stop at the first failure — each proves one layer, so a failure tells you
what is broken instead of "it doesn't work".

```bash
npm run test:anim                        # 1. 86 unit tests — no API key needed
npm run dev                              # 2. then open /board-lab in a browser
npm run verify:boards -- ./shots         # 3. 16 browser checks (needs dev running)
node scripts/verify-engines.mjs ./shots  # 4. 13 checks: ELK + morph
```

Steps 1-4 need **no API key at all**. If they pass, your install is sound and anything still wrong is
configuration, not setup.

Then, if you want to spend money: open `/sandbox-lab?topic=neuron&auto=1` (~$0.10) to prove the key,
the model id, the artwork catalogue and the critic all work end to end.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Failed to fetch` in the browser | Dev server not running or still compiling. Check the terminal. |
| Boards render but look poor, no errors | `OPENAI_ANIMATION_MODEL` missing → silently using gpt-4o. |
| Critic logs `score=not scored` | Wrong-arch resvg binary. `rm -rf node_modules && npm install`. |
| `verify:boards` fails right after starting the server | Turbopack still compiling. Load `/board-lab` once, then re-run. |
| `verify:boards` hangs or times out | `npx playwright install chromium` not run. |
| Every animation beat fails, `finish=length rawLen=0` | Reasoning tokens ate the output budget — handled in code; you are on an old checkout. |
| `Unsupported parameter: 'max_tokens'` | gpt-5.x call shape; handled in code. Pull latest. |
| A prompt change seems to do nothing | Bump `CACHE_VERSION` in `lib/lectureCache.ts` — a cached lecture is being served. |
| Module not found after switching machines | `node_modules` came from another OS. Reinstall. |
| Cannot find module errors on a fresh clone | You are in the repo root. `cd frontend/web`. |

## Reading the logs

The dev-server console is the real diagnostic. Tags worth knowing:

- `[director]` — which visual form a beat was classified as, and which board it got
- `[anim]` — animation generation attempts and why one was rejected
- `[anim-vision]` — the quality score out of 5
- `[anim-refine]` — the create → critique → improve trail, e.g. `r0=3 -> r1=5 final=5/5`
- `[react-assets]` — which catalogue artwork was offered
- `[fallback]` — a beat whose board failed and was re-routed

## Where to read more

- **[ANIMATIONS.md](./ANIMATIONS.md)** — how the pipeline works, every engine, and a record of the
  bugs that shaped it. The macOS section has extra platform detail.
- **[ANIMATION-TEST-REPORT.md](./ANIMATION-TEST-REPORT.md)** — what is verified on this branch, what
  the measured quality actually is, and what is still open.

## Honest notes

- **Not verified on macOS.** Written from the dependency manifest and the code, not from running it
  on a Mac. If a step fails, paste the first failing step and its console output rather than working
  around it — the interesting failures here are the quiet ones.
- Board quality is **4-5/5, not a uniform 5/5**. One known weak case (a heart diagram with labels
  overlapping the drawing) is documented in the test report.
- One open defect: roughly one beat in nine can come back with an empty board. Diagnosis and the next
  step are in the test report.
