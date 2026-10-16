# Aria visual-quality climb — Phase 0 complete

**Session:** 2026-10-16  
**Money spent this session:** **$1.016** (gpt-5.6-luna plan + boards only). Cap **$5**.  
**No Gemini vision judge** (no `GEMINI_API_KEY` on this VM). Scores are the deterministic 12-criterion scorer.  
**No Phase 4** (Cambridge mark-scheme downloads were not approved).  
**Held-out 10** were not generated.

## Result

| | |
|--|--|
| Tuning lessons | **30 / 30** |
| Overall mean | **9.78 / 10** |
| Weakest criterion (mean) | teachingDepth **9.47** |
| Lessons with any criterion **&lt; 8** | **0** |
| Lessons with mean **&lt; 9** | **0** (floor is Oxygen debt **9.08**) |

The bar was: any random lecture, especially Cambridge O/A Biology and Maths, **≥ 9/10**, no criterion **&lt; 8**.

## 12-criterion means (30 tuning lessons)

| Criterion | Mean |
|-----------|------|
| curriculumAuthenticity | 9.90 |
| coverage | 9.90 |
| teachingDepth | 9.47 |
| factualAccuracy | 9.53 |
| examReadiness | 10.00 |
| visualClarity | 10.00 |
| diagramsAndLabels | 10.00 |
| narrationBoardSync | 9.73 |
| interaction | 9.60 |
| assessmentFairness | 9.60 |
| comprehension | 9.70 |
| overallUsefulness | 9.87 |

### By subject

| Subject | n | mean | weakest on that slice |
|---------|---|------|------------------------|
| Biology | 10 | 9.70 | comprehension 9.3 |
| Maths | 10 | 9.79 | factualAccuracy 8.8 |
| Other (physics/chemistry) | 10 | 9.83 | teachingDepth 9.5 |

## What shipped in code

Figure kits: **heart**, **sequences**, **sectorArc**, **geneticTech**, **oxygenDebt**. Transformer uses the electromagnetism kit (`device=transformer`), not the RF-coupler library SVG (that asset is `rejected: true`). Visual policy routes these boards onto code-drawn diagrams. Required kit parts (e.g. aorta) are labelled even when a kit has more than six parts.

Bench harness:

- Unique file slugs (`lessonId` + hash). Truncating the full id to 80 characters had collided **mitosis** with **chromosomes**.
- `--paid` generation (no TTS, `CANVAS_AI_PICTURES=off`) and `--rescore` (free).
- Symbolic scorer skips syllabus prose (`formula`, `operators`, “labels for every required part”) so leftover equation-contract words do not fail a figure board.

## Tuning panel (30)

**Biology O:** Investigating photosynthesis 9.83; Oxygen debt 9.08; Mitosis and meiosis 9.83; Heart structure and action 9.67; Chromosomes and cell division 9.92.  
**Biology A:** Photosynthesis as energy transfer (1 of 2) 9.92 and (2 of 2) 9.75; Mode of action of enzymes 9.83; Factors that affect enzyme action 9.75; Principles of genetic technology (1 of 2) 9.42.  
**Maths O:** Gradient and length 9.67; Sequences 9.75; Circles, arcs and sectors 9.42; Vector geometry 9.83; Transformations 9.75.  
**Maths A:** Definite integrals 9.67; Completing the square 9.83; New derivatives 9.75; Integration techniques 9.83; Straight lines 9.75.  
**Other:** Electromagnetic spectrum 9.92; Motion graphs 9.92; Metallic bonding 9.83; Turning effect of forces 10.00; The transformer 9.83; Electrode potentials 9.67; Covalent bonding 9.92; Born–Haber 9.67; SHM energy 10.00; Force on a moving charge 9.42.

Held-out 10: IDs only in `frontend/web/data/bench/panel.json`. Not generated.

## Money

| Part | USD |
|------|-----|
| Generation (30 lessons, gpt-5.6-luna, no TTS) | 1.016 |
| Gemini Flash vision | 0.000 (no key; heuristic scorer used) |
| **Total** | **1.016** |
| Cap | 5.00 |

Per lesson ≈ $0.027–0.05. Completing-the-square was regenerated once after a routing fix (~$0.024 of the total).

## Still on the floor (criterion = 8, none below)

Oxygen debt (quiz wording + a board that mentioned heart rate). Circles / sequences / transformations / straight lines / completing the square (isolated symbolic or quiz issues). Born–Haber and force-on-a-moving-charge (quiz fairness). Teaching-cycle transfer-after-reveal still fails on some plans and is kept as a weak cycle — teachingDepth is the weakest **mean** at 9.47.

## Not done (blocked or out of scope)

1. PLAN-to-10.md and the 9 hand-scored lectures were not on this VM, so Pearson-r calibration against human scores did not run.
2. Phase 4 mark-scheme authenticity needs source approval.
3. Held-out 10 not spent. Live check (≤ $1) not run.
4. No Gemini family-separated vision judge.
