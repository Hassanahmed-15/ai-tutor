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
