# Animation pipeline — test report (`animations-fixed`)

Branch off `main` @ `c71f84d`. Goal: run every engine hard enough to say honestly whether it works.
Pipeline behaviour was **not** changed; the one code fix here restores a quality gate that was
silently inert, and is described below with the evidence that proved it.

## Result summary

| Layer | Result |
|---|---|
| Unit tests | **86/86** |
| Vega-Lite + KaTeX browser checks | **16/16** |
| ELK + morph browser checks (new) | **13/13** |
| Sandbox fixtures rendered | **5/5**, zero page errors |
| End-to-end lectures | 1 clean, 1 with one unfilled board (open, below) |

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

## Open, not fixed

**One beat in nine came back with an unfilled `reactAnimation`** ("How the Heart Pumps Blood",
`beat5`). Reproduced once in two lectures. What the evidence says:

- The animation **succeeded**: `attempt=0 finish=stop issue=OK`, 51 primitives. No `REFUSED` line.
- **No `[fallback]` line at all.** `rescueEmptyBoards` returns early without logging when nothing is
  stranded, so `hasUsableBoard(beat5)` was **true** when the rescue ran — the code was present then.
- Therefore something clears `op.code` **after** the rescue and before the response. The passes in
  between are all `sourceDocument`-gated and this was a plain topic, so none should apply.

I stopped here rather than guess. The next step is a single log line recording `op.code` length for
each animation beat immediately before the response is serialised — that will name the pass
responsible in one run. Not fixed, because the cause is not yet proven and the standing instruction
is not to change pipeline behaviour on a hunch.

**Also noted, not acted on:** `REACT_ANIMATION_BEAT_CAP` (default 2) converts excess sandbox beats to
chalk boards inside `sanitizeDrawLecture`, which runs *before* the director re-routes beats to
`reactAnimation`. So the director can produce more sandbox beats than the cap intends. That is a
design observation, not a proven defect.

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
