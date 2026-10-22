# Maths lecture benchmark

How a maths lecture is judged before it is called good. Run with
`node --import tsx scripts/bench/maths-bench.mts --batch <n> "<topic>" …`; it writes each lecture's
numbered narration and board contents (`lecture.md`), the automatic checks, and screenshots to
`~/aria-qa-images/maths-bench/batch-<n>/`. A professor then scores every lecture below.

## Hard gates (any failure = the lecture fails, whatever else it scores)

1. **Every statement is true.** No wrong number, sign, formula, theorem condition, or definition — on
   the board or in the narration. Every line of working is true for the answer reached.
2. **The board matches the voice.** What Aria says on a sentence is what is drawn or written then.
3. **Nothing is unreadable.** No writing on writing, no line through writing, nothing off the board,
   at any moment while it plays.

## Scored criteria (0–10 each)

| # | Criterion | 10 looks like |
|---|-----------|---------------|
| 1 | Mathematical precision | Exact language ("the square on the hypotenuse", not "the big side squared"); conditions stated (right-angled, a ≠ 0); notation consistent across boards. |
| 2 | Clear intention | Each board's first sentence says what it is for and how it follows from the last; the student always knows why this step comes now. |
| 3 | Structure | Idea → picture → worked example with real numbers → general rule / check. One new idea per board. Ends on what we now know. |
| 4 | Reasoning in steps | Every step of working carries its reason ("subtract 3 from both sides to get x alone"); no jump a student cannot follow. |
| 5 | Proof (where the topic has one) | Claim stated first, figure drawn, one justified step per sentence, result earned at the end. |
| 6 | Diagram accuracy | Figures are mathematically exact (angles, lengths, points on curves, right-angle marks where right angles are); labels name the right things. |
| 7 | Visual clarity | Big enough to read, uncluttered, colours carry meaning (one colour = one quantity), equation lines aligned. |
| 8 | Motion and camera | The pen draws at a teacher's pace; the camera stays on what is being written, moves rarely and smoothly; motion shows the idea (a curve shifting, a shape sliding). |
| 9 | Level and pacing | Right for the level (O/A Level); no padding, nothing rushed; worked example difficulty matches the idea. |
| 10 | Checks for understanding | Predictions and check questions test the idea taught, with a correct answer and believable wrong options. |

A lecture is **perfect** at ≥ 9 on every criterion with all three gates passed.

## Automatic measures (the harness)

- Still frames (`scripts/qa/lecture-qa.mts`): numberCheck, equationProblem (false lines, false chains,
  answers that contradict the working), narratedStructureMismatch, release audit, pixel overlap.
- Playback (`scripts/qa/playback-qa.mts`): overlaps while playing, lines through writing, camera moves
  and gaps under 4 s, pen off screen while writing, stroke speed (target ≈ 200–240 units/s).
- Structure (from the scripts): share of boards whose first sentence states the intention, share whose
  last sentence states the takeaway, reasoned steps per board.
