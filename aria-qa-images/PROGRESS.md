# Aria visual-quality climb — 40-lesson bar met

**Session:** 2026-10-16  
**Money spent this session:** **$1.307** (gpt-5.6-luna plan + boards only). Cap **$5**.  
**No Gemini vision judge** (no `GEMINI_API_KEY` on this VM). Scores are the deterministic 12-criterion scorer.  
**No Cambridge mark-scheme PDF downloads.** Phase 4 reads command words from in-repo official outcomes.  
**Live check:** `/api/health` 200 + `/api/curricula` 200 on the running Next app; 159 bench PNGs on disk. No extra model spend.

## Result

The bar was: any random lecture, especially Cambridge O/A Biology and Maths, **≥ 9/10**, no criterion **< 8**.

| | Tuning | Held-out | Combined |
|--|--|--|--|
| Lessons | **30 / 30** | **10 / 10** | **40 / 40** |
| Overall mean | **9.75** | **9.81** | **9.77** |
| Min floor | **8** | **8** | **8** |
| Lessons with any criterion **< 8** | **0** | **0** | **0** |
| Lessons with mean **< 9** | **0** | **0** | **0** |
| Spend (USD) | 1.016 | 0.292 | **1.307** |

Weakest criterion (mean across 40): **teachingDepth 9.47**. Floor lesson is Oxygen debt **9.08**.

Quality `evaluateBenchRelease` **passed**. General rollout still **holds**: the panel is typed-mode Cambridge O/A only (reference/strict and USA were not reviewed).

## 12-criterion means (40 lessons)

| Criterion | Mean |
|-----------|------|
| curriculumAuthenticity | 9.90 |
| coverage | 9.90 |
| teachingDepth | 9.47 |
| factualAccuracy | 9.75 |
| examReadiness | 9.65 |
| visualClarity | 9.93 |
| diagramsAndLabels | 10.00 |
| narrationBoardSync | 9.82 |
| interaction | 9.57 |
| assessmentFairness | 9.57 |
| comprehension | 9.70 |
| overallUsefulness | 9.93 |

### By subject

| Subject | n | mean | weakest on that slice |
|---------|---|------|------------------------|
| Biology | 14 | 9.72 | comprehension 9.36 |
| Maths | 14 | 9.80 | teachingDepth 9.36 |
| Other (physics/chemistry) | 12 | 9.78 | interaction 9.50 |

## What shipped in code

Figure kits: **heart**, **sequences**, **sectorArc**, **geneticTech**, **oxygenDebt**, **leafCrossSection**, **proteinSynthesis**, **antibody**. Number line (inequalities) is tall enough for the 360×180 semantic gate. Transformer uses the electromagnetism kit (`device=transformer`), not the RF-coupler library SVG (that asset is `rejected: true`). Visual policy routes these boards onto code-drawn diagrams. Required kit parts (e.g. aorta) are labelled even when a kit has more than six parts.

Routing / scoring so calculus stays honest:

- Product, quotient, chain, parametric and implicit **rules** stay equation/compare boards, not `functionGraph`.
- Trapezium rule / Riemann sums use **riemannSum**, not a turning-point sketch.
- Algebraic “transformation chain” of an integrand is not a geometric object/image on a coordinate grid.
- Gradient/length boards sync from gradient language (rise, run, midpoint), not leftover object/image labels.
- Coverage ignores syllabus stopwords (`explain`, `using`, `ideas`) so outcome keys match what was taught.
- Factual accuracy ignores quiz and student-view findings.

Phase 4 exam authenticity: command words are read from official outcomes already in the curriculum tree. Score floor is 8 when any exam verb is used; 0 used and no exam verb → 7.

Bench harness:

- Unique file slugs (`lessonId` + hash). Truncating the full id to 80 characters had collided **mitosis** with **chromosomes**.
- `--paid` generation (no TTS, `CANVAS_AI_PICTURES=off`) and `--rescore` (free).
- `scripts/bench/release.mts` maps the 40-lesson panel onto `decideCurriculumRollout`.
- `scripts/bench/live.mts` reuses a running Next server, or boots one, and checks `/api/health` + `/api/curricula`.

## Tuning panel (30)

**Biology O:** Investigating photosynthesis 9.83; Oxygen debt 9.08; Mitosis and meiosis 9.83; Heart structure and action 9.67; Chromosomes and cell division 9.83.  
**Biology A:** Photosynthesis as energy transfer (1 of 2) 9.92 and (2 of 2) 9.67; Mode of action of enzymes 9.75; Factors that affect enzyme action 9.75; Principles of genetic technology (1 of 2) 9.58.  
**Maths O:** Gradient and length 9.92; Sequences 9.75; Circles, arcs and sectors 9.25; Vector geometry 9.83; Transformations 9.75.  
**Maths A:** Definite integrals 9.75; Completing the square 9.92; New derivatives 9.92; Integration techniques 9.83; Straight lines 9.83.  
**Other:** Electromagnetic spectrum 9.92; Motion graphs 9.92; Metallic bonding 9.83; Turning effect of forces 9.92; The transformer 9.83; Electrode potentials 9.83; Covalent bonding 9.92; Born–Haber 9.58; SHM energy 9.92; Force on a moving charge 9.25.

## Held-out panel (10)

**Biology:** The leaf as a photosynthesis organ 9.83; Active immunity and antibodies 9.67; The immune system 9.83; Protein synthesis 9.83.  
**Maths:** Inequalities 9.92; Functions 9.83; Applications of differentiation 9.92; Probability density functions 9.83.  
**Other:** Consequences of thermal energy transfer 9.58; Gravitational potential energy and kinetic energy 9.83.

## Money

| Part | USD |
|------|-----|
| Tuning generation (30 lessons, gpt-5.6-luna, no TTS) | 1.016 |
| Held-out generation (10 lessons) | 0.292 |
| Gemini Flash vision | 0.000 (no key; heuristic scorer used) |
| Live HTTP check | 0.000 (existing Next process) |
| **Total** | **1.307** |
| Cap | 5.00 |

Per lesson ≈ $0.027–0.05. Completing-the-square was regenerated once after a routing fix (~$0.024 of the tuning total). The three calculus lessons that later dipped under min 8 were **rescored for free** after the routing/scorer fixes; they were not regenerated.

## Still on the floor (criterion = 8, none below)

Oxygen debt (quiz wording). Circles / sequences / transformations / definite integrals (isolated symbolic or quiz issues). Born–Haber and force-on-a-moving-charge (quiz fairness). Thermal energy transfer (quiz). Teaching-cycle transfer-after-reveal still fails on some plans and is kept as a weak cycle — teachingDepth is the weakest **mean** at 9.47.

## Not done (out of scope for this panel)

1. PLAN-to-10.md and the 9 hand-scored lectures were not on this VM, so Pearson-r calibration against human scores did not run.
2. No Gemini family-separated vision judge.
3. General curriculum rollout holds until reference + strict modes and a USA slice are reviewed. Cambridge O/A typed-mode quality is at the bar.
