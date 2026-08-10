# The animation pipeline

How a teaching beat becomes a picture, which engine draws it, and what stops a bad one shipping.

---

## The flow

```
beat (title + spoken script)
  │
  ├─ 1. beatVisualSpec.ts    what must this picture CONTAIN?
  │      → { subject, mustShow[], mustNotShow, isPhysical }
  │
  ├─ 2. director.ts          classify that spec into ONE visual form
  │      → plot | network | equation | transformation
  │        labelled-diagram | construction | animated-maths | text
  │
  ├─ 3. boardDirector.ts     BOARD_FOR[form] → swap in that board's placeholder
  │
  ├─ 4. fill passes          each generator fills its own placeholder's spec
  │
  └─ 5. boardFallback.ts     any beat still without a board drops down its chain
```

The model **only classifies and supplies content**. Every position, axis, tick and glyph is computed
by a renderer. That split is the single most important property of this pipeline, and most of the
bugs below are what happens when it is violated.

## The engines

| Form | Engine | Why this one | Spec it takes |
|---|---|---|---|
| `plot` | **Vega-Lite** | grammar of graphics — axes, ticks, binning and legends are *derived* from data, so the chart is exact and instant | `lib/plotSpec.ts` |
| `equation` | **KaTeX** | a derivation is read, not watched; 2-3× faster than MathJax and it can be asked to throw on bad input | `lib/equationSpec.ts` |
| `network` | **ELK** | layout is computed, so overlap and clipping are unreachable states | `lib/structureSpec.ts` |
| `transformation` | **anime.js** | the only renderer that interpolates the path itself, and it scrubs both ways | morph ops |
| `labelled-diagram` | **React sandbox** | the only engine that can draw a *specific* subject — and the only one still placing its own coordinates | component source |
| `construction`, `animated-maths` | **Manim** | measured geometry and maths that must move; where video earns its seconds | `lib/manimSceneSpec.ts` |
| `text` | **chalk board** | nothing moves — say so cleanly instead of inventing a diagram | chalk ops |

**Deliberately not used:** Mermaid (ELK gives better layout without a whitespace-fragile DSL) and
MathJax (KaTeX is faster and validates; MathJax's MathML would be the better choice if screen-reader
support ever matters — for a disability-focused product it eventually will).

## Quality controls

Every engine has an oracle that decides whether its output is real, and the oracle is the thing that
will actually render it:

- **Vega-Lite** compiles the chart spec (`compilesAsVegaLite`). A spec can be shaped perfectly and be
  semantically nonsense — `type: "sideways"` — and only the compiler knows.
- **KaTeX** compiles every `tex` line with `throwOnError`, so a step that would render as red error
  text is dropped instead.
- **ELK** computes the geometry; a test asserts no two nodes overlap and none leaves the board.
- **The React sandbox** has two critics (`reactAnimationVisionCritic.ts`): a free deterministic one
  that measures rendered text boxes for overlap and clipping, and a vision one that rasterises the
  finished frame and asks whether the subject *reads as* the real thing. The second is the only
  check that can tell a drawing of a chloroplast from three ellipses.
- **Stock photographs** are vision-verified against the beat's subject before use.

`REACT_ANIMATION_VISION_CRITIC=0` disables the vision critic; `REACT_ANIMATION_VISION_MIN_SCORE`
(default 3, 1-5 scale) is the reject threshold.

## The artwork catalogue

The React sandbox is the one engine that invents its own silhouettes, and left alone it draws
generic shapes — measured at **2.60/5** recognisability, with the critic reporting *"the
mitochondrion is a plain oval without the characteristic cristae"*.

`lib/assetCatalogue.ts` gives it real artwork to **position** instead: 710 licence-clean Bioicons
SVGs (`cc-0`, `cc-by-4.0`, `mit`, `bsd`; share-alike excluded deliberately). Keywords from the
subject retrieve a handful, those are injected into the sandbox as an `<Asset/>` component, and the
same runtime goes to the critic — a critic scoring a board without its artwork is scoring a
different picture.

```bash
node scripts/build-asset-catalogue.mjs   # rebuild assets/ from upstream Bioicons
```

**Coverage is the honest limit.** Bioicons has 5 mitochondria and one nephron; it has no
chloroplast, thylakoid or granum. Retrieval returns *nothing* rather than something irrelevant,
because a shortlist of noise teaches the model that the catalogue is useless.

## Running and testing

```bash
npm run test:anim                  # 84 unit tests (validators, geometry, repairs, fallback)
npm run verify:boards -- ./shots   # browser: Vega-Lite + KaTeX render, 16 checks
npm run verify:lecture             # 5 adversarial ML lectures, end to end
npm run dev                        # /board-lab, /structure-lab, /anime-lab, /gsap-lab
```

`/board-lab` renders both spec boards on fixed specs with no model call — what you see is the
renderer, which is what makes a Playwright run meaningful.

`BOARD_DIRECTOR=1` enables the classify-and-route pass. It is **off by default**: it changes how
every lecture picks its boards, and none of the measured quality gain came from it.

## Failures worth remembering

Every one of these failed **silently**. That is the pattern: nothing in the product complained about
any of them, and each was found only by looking at rendered pixels.

**A photograph of a stamp vending machine, in a lecture on Support Vector Machines.** The photo gate
was a keyword regex containing the word `machine`; "Support Vector **Machine**" matched, an Openverse
search for "SVM" returned the vending machine, and the callout pass labelled its coin return slot. A
regex cannot tell a support vector machine from a machine, a Random Forest from a forest, or a
Decision Tree from a tree — and machine learning is full of names borrowed from physical objects. The
gate is now the director's own judgement plus vision verification.

**A critic that scored every board 5/5 while looking at nothing.** `@resvg/resvg-js` could not
resolve under Turbopack, the rasteriser returned null, and the "no opinion" fallback happened to
*be* 5. A quality gate whose failure mode is "everything passes" is worse than no gate. Unscored is
now `null` and says so loudly. (Fixed by `serverExternalPackages` in `next.config.ts`.)

**Regenerating with the critic's exact complaint does not work.** Measured across the standard
prompt set: mean stayed at 2.60/5, four of five boards still failed, cost and latency doubled. Being
told precisely what is wrong does not make a model able to draw an organelle — which matches
SVGenius's finding that SVG quality degrades with complexity regardless of prompting. Real artwork
is the fix; `REACT_CRITIC_RETRY=1` re-enables the retry if you want to re-measure.

**A bare `<` in JSX text killed the whole board.** `<text>Left < Root</text>` is a hard Babel syntax
error. The repair is position-guided (`lib/jsxRepair.ts`): Babel names the offending character, so
one `<` is fixed per attempt — a blanket regex would also rewrite `{progress < 0.5}`, which is in
almost every generated component and is perfectly valid.

**Labels hung outside their boxes.** ELK boxes were sized by a character estimate clamped to 230px
while the board drew every label at a constant 20px, and the layout scaled boxes to fit the frame
without scaling the type. Now measured, wrapped, and shrunk to fit — enclosure is a guarantee.

**Two beats served each other's video.** `manimCacheKey` used
`JSON.stringify(script, Object.keys(script).sort())`, believing it sorted keys. That argument is a
replacer *allow-list applied at every depth*: every op serialised to `{}` and the scene never
entered the key.

**A blank board with no error.** `root.render()` is asynchronous, so on a single
`requestAnimationFrame` the teaching timeline styled nodes React had not committed yet, and the new
ones kept the stylesheet default of `opacity: 0`. Worse on bigger boards, which is why detailed ones
never appeared. Double rAF.

**LaTeX does not survive JSON.** `"\frac"` is *valid* JSON — `\f` is a legal escape — so it parses
to a form feed and KaTeX rejects a character nobody typed. Every command starting `\f \b \n \r \t`
is exposed, which is most of real derivation TeX. `repairTex` restores them, and the order matters:
stripping delimiters first lets `String.trim()` eat the form feed, turning `\frac{a}{b}` into
`rac{a}{b}` — which KaTeX compiles happily, because `rac` is three perfectly good variables.

**Ops deleted between generation and the player.** ~20 guard sites list the board kinds explicitly;
an op not named in every one of them is silently dropped. Adding a board type means updating all of
them — `drawSanitize.ts` and `suprnotes.ts`.

## Known limits

- **Monotony.** The director classifies each beat independently, so a topic whose beats are all
  "how parts relate" produces eight consecutive ELK diagrams. Nothing reasons about variety across
  a lecture yet.
- **`transformation` does not route.** Rewriting a morph board from a brief means inventing its
  before and after states, which is authoring rather than routing, so those beats keep whatever the
  lecture prompt gave them.
- **The React sandbox still places its own coordinates.** Artwork raised the floor; label placement
  and composition are still its weak point, and the vision critic only *rejects* — it does not teach
  the model to draw.
- **Vision scores are noisy** run to run (4.4, 3.5, 3.2 on identical prompts), because the model
  does not reliably use the asset it is offered. Expect improvement on average, not per board.

---

# Running this on macOS

The pipeline has been developed and measured on Windows. Nothing here is Mac-hostile, but three of
its dependencies are **native or platform-shaped**, and each fails quietly rather than loudly — which
matters, because on this pipeline a silent failure looks like bad quality, not like a broken install.

**Manim is optional.** It is a last resort now — no visual form routes to it — so skip that section
entirely unless you are specifically working on Manim.

## 1. Install

```bash
git clone https://github.com/Hassanahmed-15/ai-tutor && cd ai-tutor
node --version          # 20+ (Next 16 / React 19)
cd frontend/web

# Install from THIS machine. Never copy node_modules between machines — see below.
rm -rf node_modules
npm install

npx playwright install chromium   # the npm package does not download browsers
```

**Why `rm -rf node_modules` is not boilerplate here.** `@resvg/resvg-js` ships a per-platform native
binary (`darwin-arm64` on Apple Silicon, `darwin-x64` on Intel). A `node_modules` copied, zipped or
cloud-synced from a Windows machine carries the wrong one.

That single dependency is the vision critic's rasteriser, and when it fails to load
`critiqueShapeRecognizability` returns `{ score: null }` — "could not look". The pipeline treats that
as *do not block*, by design, because a broken rasteriser must never reject good boards. The
consequence on a bad install is that **the critic stops judging and nothing says so**: no error, no
crash, just boards quietly getting worse. This exact failure already happened once on Windows and
took a full investigation to find.

Confirm it loaded: `npm run test:anim` includes a test that rasterises real catalogue artwork through
resvg. If that passes, resvg is fine.

## 2. `.env.local`

Git-ignored, so it will not exist on a fresh clone. Create `frontend/web/.env.local`:

```bash
OPENAI_API_KEY=sk-...

# Animation engine. WITHOUT THIS the code silently falls back to gpt-4o, and every board is
# mediocre with no error anywhere — this was the single biggest quality bug in the pipeline.
OPENAI_ANIMATION_MODEL=gpt-5.5

REACT_ANIMATIONS_ENABLED=1
NEXT_PUBLIC_REACT_ANIMATIONS_ENABLED=1
BLACKBOARD_GEN_ENABLED=1
```

Everything the animation path actually reads, with its default:

| Variable | Default | What it does |
|---|---|---|
| `OPENAI_API_KEY` | — | Required. |
| `OPENAI_ANIMATION_MODEL` | `gpt-4o` | The board draughtsman. **Set it.** |
| `OPENAI_ANIMATION_REASONING_EFFORT` | `low` | gpt-5.x only. Do not raise without reading §4. |
| `OPENAI_ANIMATION_MAX_TOKENS` | `12000` | Output cap (3k-20k). |
| `OPENAI_ANIMATION_ATTEMPTS` | `2` | Independent generation attempts (max 3). |
| `REACT_REFINE_ROUNDS` | `3` | create → critique → improve rounds (0 disables). |
| `REACT_REFINE_BUDGET_USD` | `0.60` | Hard spend cap for refinement, per beat. |
| `REACT_ANIMATION_VISION_CRITIC` | on | `0` disables the critic entirely. |
| `REACT_ANIMATION_VISION_MIN_SCORE` | `3` | Below this a board is refused, not shipped. |
| `OPENAI_VISION_MODEL` | `gpt-4o` | Used by the critics. |
| `BOARD_DIRECTOR` | off | `1` enables classify-and-route per beat. |
| `MANIM_RENDER_ENABLED` | off | Leave off unless working on Manim. |
| `MANIM_PYTHON_BINARY` | venv path | Overrides the interpreter. |
| `SVG_DEBUG_SAVE` | off | `1` writes rejected boards to disk for inspection. |

A lecture costs roughly **$0.5-1.5** depending on refinement, and takes **4-5 minutes**.

## 3. Verify, in this order

Each step proves one layer. Run them in sequence and stop at the first failure — that tells you which
layer is broken instead of "animations don't work".

| # | Command | Proves | Cost |
|---|---|---|---|
| 1 | `npm run test:anim` | install + resvg loads | free |
| 2 | `npm run dev`, open `/board-lab` | Vega-Lite + KaTeX render, no model call | free |
| 3 | `npm run verify:boards` | Playwright + browser rendering (16 checks) | free |
| 4 | open `/sandbox-lab?topic=neuron&auto=1` | API key, model id, artwork, critic | ~$0.10 |
| 5 | `npm run verify:lecture` | full lectures end to end | several $ |

Steps 1-3 need no API key at all. If they pass, the install is sound and anything still wrong is
configuration, not platform.

## 4. When it breaks

Read the dev-server console — this pipeline logs `[anim]`, `[anim-vision]`, `[anim-refine]`,
`[react-assets]`, `[director]` and `[fallback]` lines that say exactly what happened.

| Symptom | Cause |
|---|---|
| Boards render, quality is poor, no errors anywhere | `OPENAI_ANIMATION_MODEL` unset → silently `gpt-4o` |
| `[anim-vision] score=not scored` | resvg did not load — wrong-arch binary, reinstall (§1) |
| Every animation beat fails, `finish=length rawLen=0` | gpt-5.x reasoning tokens consumed the whole budget; needs `reasoning_effort` (already set to `low` in code) |
| `Unsupported parameter: 'max_tokens'` | gpt-5.x call shape — `modelCallParams` handles it; you are on an older code path |
| `Unsupported value: 'temperature'` | same family; gpt-5.x accepts only its default |
| A prompt change appears to do nothing | bump `CACHE_VERSION` in `lib/lectureCache.ts` — a stale lecture is being served |
| `verify:boards` hangs or times out | `npx playwright install chromium` was not run |
| `npm run dev` cannot find a module after switching machines | `node_modules` came from another OS; `rm -rf` and reinstall |

## 5. Manim (optional — skip unless you need it)

```bash
brew install ffmpeg cairo pango pkg-config
cd frontend/web/scripts/manim
python3 -m venv .venv && ./.venv/bin/pip install manim
```

Then set `MANIM_RENDER_ENABLED=1`. The interpreter path is chosen by platform
(`.venv/bin/python` on macOS, `.venv/Scripts/python.exe` on Windows) — this used to be hard-coded to
the Windows layout, so Manim could never start on a Mac however correctly the venv was built.

## Not verified on macOS

This guide was written by reading the dependency manifest, `next.config.ts` and every `process.env.*`
the pipeline touches — not by running it on a Mac, which I do not have access to. The env-var table
lists only flags the code actually reads.

If a step in §3 fails, paste the first failing step and its console output rather than working
around it: on this pipeline the interesting failures are the quiet ones, and a workaround usually
hides the thing worth fixing.
