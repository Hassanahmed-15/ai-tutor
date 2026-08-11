# Animation pipeline — test report (`animations-fixed`)

Branch off `main` @ `c71f84d`. Goal: run every engine hard enough to say honestly whether it works.
Pipeline behaviour was **not** changed; the one code fix here restores a quality gate that was
silently inert, and is described below with the evidence that proved it.

## Result summary

| Layer | Result |
|---|---|
| Unit tests | **87/87** |
| Vega-Lite + KaTeX browser checks | **16/16** |
| ELK + morph browser checks (new) | **13/13** |
| Sandbox fixtures rendered | **5/5**, zero page errors |
| End-to-end lectures | clean after the fix: 8 boards in, 8 out, 0 unfilled |

## Per engine

**Vega-Lite (`plotBoard`)** — compiles, draws 32 marks and 29 axis labels, spec's axis titles reach
the screen, real computed values on the y-axis, categories render in their true order (not
alphabetical), progress wipe goes 787px → 0px. Working.

**KaTeX (`equationBoard`)** — 4+ `.katex` nodes, TeX source absent from the text (so it typeset
rather than printed), each step keeps its justification, steps accumulate 1 → 4, nothing overflows
the frame. Working.

**ELK (`structureScene`)** — across `rock-cycle`, `tcp-handshake`, `pythagoras`: **0 overlapping node
pairs, 0 elements outside the frame** in every one. Screenshot confirms a clean pentagon cycle with
labels inside their boxes and routed edge labels. This is the guarantee ELK exists to provide and it
holds. *Previously untested — this run is the first evidence.*

**anime.js morph** — draws real path data, geometry genuinely changes between p=0 and p=1 (a morph
that does not change its paths is a static picture with a slider wired to nothing), and scrubbing
back reproduces the start state exactly. Reversibility is the one thing morph is chosen over video
for, and it works. *Previously untested.*

**React sandbox** — see distribution below.

**Manim** — no longer reachable by routing (`d58e1f2`); every lecture in this run had `manim=0`.
Not exercised, and not claimed to work.

## Sandbox quality — the honest distribution

Five fixtures, with the refine-loop trail per board:

```
r0=3 -> rejected           final 3/5    $0.073
r0=3 -> r1=4 -> rejected   final 4/5    $0.173   improved
(critic never ran)         final -1/5   $0.000   ← BUG, fixed
r0=3 -> r1=5               final 5/5    $0.074   improved
r0=5                       final 5/5    $0.003
```

**Not a uniform 5/5.** By eye: volcano and airways are excellent (layered strata / cartilage rings,
branching, clean leader-line labels); respiration and neuron are good; **heart is poor** — chambers
drawn as overlapping ellipses with eight labels colliding on top of the drawing and leader lines
crossing chaotically. The 3/5 is deserved.

**The refine loop is now measured, not assumed.** Two of five boards genuinely improved (3→4, 3→5).
That is the first real evidence it earns its cost, and it contrasts with the previously measured
regenerate-from-scratch approach that never moved off 2.60/5.

## The bug this run found and fixed

```
[anim-vision] rasterize failed: unknown namespace prefix 'xlink'
[anim-refine] beat=lab  final=-1/5 $0.000
```

Catalogue artwork contains `xlink:href`. resvg rejects the **entire document** over an undeclared
prefix, `rasterize()` returns null, the critic reports "could not look", and — by design, so a broken
rasteriser never rejects good boards — the board ships **unjudged**. Every board placing real
artwork, the ones most worth checking, went out with no quality gate and nothing said so.

The unit test missed it because it built its **own** wrapper with `xmlns:xlink` already declared,
exercising a string the critic never produces. A test that vouches for code it does not call
certifies the broken path.

Fix: `svgForRasterizer()` is now the single exported wrapper, tops up a root that declares `xmlns`
but not `xlink`, and the test calls it instead of hand-rolling one. Verified — that board went from
`-1/5 $0.000` to `r0=3 → r1=3 → rejected, final 4/5`, no rasterize failure.

## The empty board — found and fixed (`16c8655`)

This was the intermittent empty board **and** a large silent waste of what a lecture pays for.

`composePromptedSuprnotesBoards` skips beats carrying `manimScene`, `morph`, `structureScene`,
`plotBoard` and `equationBoard` — the comment above the guard even explains why ("composing a paper
board over it destroys the op"). **`reactAnimation` was never added to that list.** A finished
animation got a paper board composed straight over it, and unlike `manimScene` nothing rebuilds one
afterwards, so it was final.

Found by measurement rather than reading — reading had ruled out every candidate and still left the
evidence contradictory. Three snapshots through the real route:

```
after-fills      9 boards, 7 reactAnimation carrying 11k-17k chars each
after-rescue     identical, nothing lost
before-response  4 boards — five animations gone
```

Five boards per lecture generated, critiqued, refined and paid for, then overwritten. A beat left
holding the stripped op rendered as nothing — the empty board seen about once every nine beats.

After the fix the same lecture gives `after-rescue` and `before-response` **byte-identical**: 8
boards in, 8 out, 0 unfilled. Pinned by a test **verified to fail** with the guard removed — a
regression test nobody has watched fail is not yet a regression test.

That also disposes of the earlier "REACT_ANIMATION_BEAT_CAP" theory: the cap was never the mechanism.

## Labels on the drawing — fixed (`8ef7a92`)

The prose rule was obeyed for a board's main labels and ignored for its secondary ones; the heart
kept four valve names on the chambers. The worked example only ever showed three easy labels, so
there was no pattern for a subject with eight nameable parts.

The example now demonstrates the hard case: one row per label, 40px apart, down the right column,
with a ninth part deliberately left unlabelled rather than crammed in.

`shoot-sandbox.mjs` now **measures** it instead of trusting the picture — every rendered `<text>`
x-position is read from the board and any landing in the drawing band is reported. It had to be
queried through a *frame handle*: `iframe.contentDocument` is unreachable from `page.evaluate` and
silently returned null, printing "?" for every board. A check that cannot see is indistinguishable
from one that passes.

`heart` and `airways` both report `textOnDrawing=0`, confirmed by eye.

## The Set/Map warning — not reproducible

Zero console errors across all five routes on a cold browser. Every `Set`/`Map` in the codebase sits
*inside* a client component, and `DirectorStats` is server-only and never returned to the client.
Recorded as HMR state from a long-running dev server rather than left as a silent known-unknown.

## Still not verified

**Two full lectures after both fixes.** The empty-board defect was intermittent (~1 beat in 9), so
the single clean post-fix lecture above is suggestive, not conclusive. Before deployment, run at
least two more lectures and confirm `unfilled=0` on each.

## Cost and latency

| Lecture | Beats | Words/beat | Time | Cost |
|---|---|---|---|---|
| Mechanics of Breathing | 8 | 107 | 325s | $1.07 |
| How the Heart Pumps Blood | 9 | 101 | 202s | $0.83 |

Both inside the $1.50 ceiling and the 4-5 minute expectation. Depth gate passes on both.

## How to re-run

```bash
npm run test:anim                        # 86 unit
npm run verify:boards -- ./shots         # Vega-Lite + KaTeX, 16 checks
node scripts/verify-engines.mjs ./shots  # ELK + morph, 13 checks
node scripts/shoot-sandbox.mjs ./shots tag respiration airways neuron heart volcano
```

Screenshots are the point. Every quality claim in this project that skipped looking at them was
wrong — including the critic that scored 5/5 while its rasteriser returned null, which is the same
class of bug this run found again.
