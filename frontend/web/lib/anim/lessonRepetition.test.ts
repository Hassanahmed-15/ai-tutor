/**
 * THE DETECTOR: repetition is caught deterministically, and a well-built lesson is left alone.
 *
 * These calibrate the thresholds. If a test here changes, the auditor's behaviour on every real
 * lecture changes with it.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  auditBeat,
  auditLesson,
  claimsAllowedFor,
  isAnalogyFor,
  isDefinitionOf,
  isFiller,
  noveltyRatio,
  repairScript,
  sentenceSimilarity,
  subjectTerms,
} from "../lessonRepetition";

const subject = subjectTerms("What is overfitting?");

test("the subject of a question is the noun phrase, stemmed", () => {
  assert.deepEqual(subjectTerms("What is overfitting?"), ["overfit"]);
  assert.deepEqual(subjectTerms("how linear regression works"), ["linear", "regress"]);
  assert.deepEqual(subjectTerms("explain photosynthesis to me"), ["photosynthesis"]);
  assert.deepEqual(subjectTerms("the Krebs cycle"), ["krebs", "cycle"]);
});

test("THE BUG: the same claim reworded is a restated sentence", () => {
  const a = "Overfitting is when a model memorises the training data instead of learning the pattern.";
  const b = "Overfitting happens when the model memorises training data rather than learning the underlying pattern.";
  assert.ok(sentenceSimilarity(a, b) >= 0.5, `similarity ${sentenceSimilarity(a, b).toFixed(2)}`);
  const findings = auditBeat({ title: "Again", script: b }, [{ title: "Core", script: a, role: "core" }], subject, 1);
  assert.equal(findings[0]?.kind, "restated-sentence");
  assert.equal(findings[0]?.matchBeatIndex, 0);
});

test("a genuinely new claim about the same subject is NOT a restatement", () => {
  const a = "Overfitting is when a model memorises the training data instead of learning the pattern.";
  const b = "Regularisation adds a penalty on large weights, which makes memorising noise expensive.";
  assert.ok(sentenceSimilarity(a, b) < 0.3, `similarity ${sentenceSimilarity(a, b).toFixed(2)}`);
  const findings = auditBeat({ title: "Fix", script: b, role: "application" }, [{ title: "Core", script: a, role: "core" }], subject, 1);
  assert.deepEqual(findings, []);
});

test("defining the subject a second time is a re-definition; the first definition is allowed", () => {
  const core = "Overfitting is a model fitting noise in its training data as if it were signal.";
  assert.equal(isDefinitionOf(core, subject), true);
  assert.deepEqual(auditBeat({ title: "Core", script: core, role: "core" }, [], subject, 0), [], "the first definition passes");
  const later = "Remember, overfitting means the model has learned the noise rather than the trend. Now we tune the penalty.";
  const findings = auditBeat({ title: "Tuning", script: later, role: "application" }, [{ title: "Core", script: core, role: "core" }], subject, 1);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "re-definition");
  assert.match(findings[0].sentence, /^Remember, overfitting means/);
});

test("'in other words' about the subject after it was defined is a re-definition", () => {
  const core = "Overfitting is a model fitting noise in its training data as if it were signal.";
  const later = "In other words, overfitting is the model getting too attached to its training set. The validation curve turns upward here.";
  const findings = auditBeat({ title: "Curves", script: later, role: "mechanism" }, [{ title: "Core", script: core, role: "core" }], subject, 1);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "re-definition");
});

test("a second analogy for the subject is a re-analogy; an analogy for a NEW term is allowed", () => {
  const core = "Think of overfitting as a student who memorises last year's exam answers. Overfitting is fitting noise as signal.";
  assert.equal(isAnalogyFor(core, subject), true);
  const again = "Imagine overfitting as a tailor cutting a suit so tight it only fits one pose. The gap between curves widens.";
  const f1 = auditBeat({ title: "B", script: again, role: "mechanism" }, [{ title: "Core", script: core, role: "core" }], subject, 1);
  assert.equal(f1.length, 1);
  assert.equal(f1[0].kind, "re-analogy");
  const newTerm = "Think of regularisation as a leash that keeps the weights from running off. The penalty grows with the square of each weight.";
  const f2 = auditBeat({ title: "C", script: newTerm, role: "application" }, [{ title: "Core", script: core, role: "core" }], subject, 1);
  assert.deepEqual(f2, [], "an analogy for regularisation, not for the subject, is new information");
});

test("NEVER GO DEEP THEN BACK TO BASICS: a first definition after a mechanism board is flagged", () => {
  const mechanism = "Each extra parameter lets the curve bend to pass through one more training point. The training error falls while validation error rises.";
  const late = "So, overfitting is when the model fits noise instead of signal. Let us look at the curves.";
  const findings = auditBeat({ title: "Late", script: late, role: "example" }, [{ title: "Mech", script: mechanism, role: "mechanism" }], subject, 1);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "returns-to-basics");
});

test("two boards that share most of their vocabulary are a beat overlap, even with no sentence copied verbatim", () => {
  const a = "A model with too many parameters bends its curve through every training point. Training error falls to zero while validation error rises. The gap between the two curves is the signature of the problem.";
  const b = "When the curve bends through every training point the parameters are too many. Validation error rises as training error falls to zero. That widening gap between curves is the signature.";
  const findings = auditBeat({ title: "B", script: b, role: "example" }, [{ title: "A", script: a, role: "mechanism" }], subject, 1);
  assert.ok(findings.some((f) => f.kind === "beat-overlap"), JSON.stringify(findings.map((f) => f.kind)));
});

test("repair removes the repeated sentences and keeps the new ones, never below three sentences", () => {
  const core = "Overfitting is a model fitting noise in its training data as if it were signal.";
  const script = "Remember, overfitting means the model has learned the noise rather than the trend. The penalty term is lambda times the sum of squared weights. Larger lambda shrinks the weights toward zero. A validation set tells you where to set it. So the fix is a knob, not a rewrite.";
  const findings = auditBeat({ title: "Fix", script, role: "application" }, [{ title: "Core", script: core, role: "core" }], subject, 1);
  const repaired = repairScript(script, findings);
  assert.equal(repaired.repaired, true);
  assert.deepEqual(repaired.removed, ["Remember, overfitting means the model has learned the noise rather than the trend."]);
  assert.match(repaired.script, /^The penalty term is lambda/);
  assert.ok(!/Remember, overfitting/.test(repaired.script));

  // Too short to survive a cut: left alone and reported as not repaired.
  const tiny = "Remember, overfitting means the model has learned the noise rather than the trend. That is it. Done.";
  const tinyFindings = auditBeat({ title: "Tiny", script: tiny, role: "application" }, [{ title: "Core", script: core, role: "core" }], subject, 1);
  assert.equal(repairScript(tiny, tinyFindings).repaired, false);
});

test("novelty ratio counts how much of a board is new", () => {
  const core = "Overfitting is a model fitting noise in its training data as if it were signal.";
  const script = "Remember, overfitting means the model has learned the noise rather than the trend. The penalty term is lambda times the sum of squared weights. Larger lambda shrinks the weights toward zero. A validation set tells you where to set it.";
  const findings = auditBeat({ title: "Fix", script, role: "application" }, [{ title: "Core", script: core, role: "core" }], subject, 1);
  assert.equal(noveltyRatio({ title: "Fix", script }, findings), 0.75);
});

test("FALSE-POSITIVE GUARD: a well-built four-board lesson produces zero findings", () => {
  const lesson = [
    { title: "Why a perfect score can be bad news", role: "hook" as const, script: "A model scores one hundred percent on the data it trained on and forty percent on new data. Something went wrong even though the training score looks ideal. This lesson is about what that something is and how to stop it." },
    { title: "What overfitting is", role: "core" as const, script: "Overfitting is a model fitting the noise in its training data as if it were signal. The model has memorised particular points instead of learning the rule that produced them. Think of it as a student who memorised last year's answers instead of the method." },
    { title: "How a model comes to memorise", role: "mechanism" as const, script: "Each extra parameter lets the curve bend to pass through one more training point. With enough parameters the curve threads every point exactly, including the ones that are only there by chance. Training error drops toward zero while error on held-out data starts to climb, because the extra bends fit chance, not structure." },
    { title: "Regularisation as the fix", role: "application" as const, script: "Regularisation adds a penalty proportional to the size of the weights, so every bend has to earn its place. A larger penalty produces a smoother curve that ignores the chance points. You choose the penalty by watching the held-out error and stopping where it is lowest." },
  ];
  const findings = auditLesson(lesson, "What is overfitting?");
  assert.deepEqual(findings, []);
});

test("A HOOK MAY NOT DEFINE THE SUBJECT: the first board's definition is a role violation, not free", () => {
  // On the first board nothing is 'prior', so this could never be caught as repetition — yet it is
  // what made every later board's definition a repeat.
  const hook = "A model scores perfectly on training data and badly on new data. Overfitting is when a model learns the noise instead of the pattern. Think of overfitting as memorising last year's exam. Why does that happen?";
  const findings = auditBeat({ title: "Hook", script: hook, role: "hook" }, [], subject, 0);
  assert.deepEqual(findings.map((f) => f.kind), ["role-violation", "role-violation"]);
  assert.match(findings[0].sentence, /^Overfitting is when/);
  assert.match(findings[1].sentence, /^Think of overfitting/);
});

test("FILLER: sentences that carry no information are flagged wherever they appear", () => {
  for (const s of [
    "Understanding overfitting is crucial for anyone looking to build robust machine learning models.",
    "As we delve deeper into this topic, we will explore the mechanisms behind overfitting.",
    "This will be foundational as we delve into the next topic.",
    "Recognizing these implications is essential for anyone developing machine learning models.",
    "In our exploration of overfitting, we established that it occurs when a model learns noise.",
  ]) {
    assert.equal(isFiller(s), true, s);
  }
  for (const s of [
    "Regularisation adds a penalty on large weights.",
    "Training error falls to zero while validation error rises.",
    "This lesson is about what that something is and how to stop it.",
  ]) {
    assert.equal(isFiller(s), false, s);
  }
  const findings = auditBeat({ title: "M", script: "Each extra parameter lets the curve bend through one more point. Understanding this mechanism is vital for developing strategies to prevent overfitting.", role: "mechanism" }, [], subject, 1);
  assert.deepEqual(findings.map((f) => f.kind), ["filler"]);
});

test("repair does not leave the board opening on a dangling connective", () => {
  const core = "Overfitting is a model fitting noise in its training data as if it were signal.";
  const script = "Remember, overfitting means the model has learned the noise rather than the trend. For instance, if you predict customer behaviour the model does well on history and badly on next month. A simpler model generalises better. Regularisation constrains complexity. Watch the held-out error to choose the penalty.";
  const findings = auditBeat({ title: "Fix", script, role: "application" }, [{ title: "Core", script: core, role: "core" }], subject, 1);
  const repaired = repairScript(script, findings);
  assert.equal(repaired.repaired, true);
  assert.match(repaired.script, /^If you predict customer behaviour/);
});

test("an ATTRIBUTE of the subject is not a definition of it", () => {
  const lr = subjectTerms("how linear regression works");
  assert.equal(isDefinitionOf("Additionally, linear regression is sensitive to outliers.", lr), false);
  assert.equal(isDefinitionOf("At this point the handshake is complete.", subjectTerms("the TCP three-way handshake")), false);
  assert.equal(isDefinitionOf("Linear regression is a method that fits a straight line through the points.", lr), true);
  assert.equal(isDefinitionOf("Linear regression is when you fit a straight line through points.", lr), true);
  assert.equal(isDefinitionOf("Linear regression refers to fitting a straight line.", lr), true);
});

test("definitions by naming or by 'becomes' are definitions too", () => {
  assert.equal(isDefinitionOf("This scenario mirrors a common issue in machine learning known as overfitting.", subject), true);
  assert.equal(isDefinitionOf("In overfitting, a model becomes so tailored to the training data that it cannot generalize.", subject), true);
  assert.equal(isDefinitionOf("The model becomes slower as it grows, and overfitting is one risk among several.", subject), false, "'becomes' about something else is not a definition of the subject");
});

test("the SAME analogy retold on a later board is a re-analogy even when it never names the subject", () => {
  const hook = "Imagine you're a student preparing for a big exam who has memorized every detail from the textbook. On test day the questions need application, not recall. What went wrong?";
  const core = "Overfitting is a model fitting noise as if it were signal. To visualize this, think of a student who memorizes every detail of their study material and falters on new questions.";
  const findings = auditBeat({ title: "Core", script: core, role: "core" }, [{ title: "Hook", script: hook, role: "hook" }], subject, 1);
  assert.deepEqual(findings.map((f) => f.kind), ["re-analogy"]);
  assert.equal(findings[0].matchBeatIndex, 0);
});

test("more filler shapes: 'understanding X helps', 'this balance is crucial', 'the key takeaway' off the recap", () => {
  assert.equal(isFiller("Understanding these implications helps us appreciate the critical balance needed in model development."), true);
  assert.equal(isFiller("This balance is crucial for developing robust models that can handle real-world data."), true);
  assert.equal(isFiller("Finally, the key takeaway is that finding the right balance is essential.", "mechanism"), true);
  assert.equal(isFiller("Therefore, the single most usable takeaway is that balance is vital.", "recap"), false, "the recap's job is the takeaway");
  assert.equal(isFiller("The balance shifts when lambda exceeds one.", "mechanism"), false);
});

test("filler: 'as we explore further', 'it's crucial to understand', and past-tense narration of the lesson", () => {
  assert.equal(isFiller("As we explore further, we will delve into how overfitting works and the mechanisms behind it."), true);
  assert.equal(isFiller("For now, it's crucial to understand this foundational definition."), true);
  assert.equal(isFiller("Next, we explored how overfitting works, noting that complexity raises training accuracy.", "recap"), true);
  assert.equal(isFiller("A larger penalty produces a smoother curve.", "recap"), false);
});

test("a hook cannot hand a definition forward as an established claim; the core can", () => {
  const claims = ["A model can score 95% on training data and 50% on new data.", "Overfitting occurs when a model learns noise and peculiarities of the training set."];
  assert.deepEqual(claimsAllowedFor(claims, subject, "hook"), [claims[0]]);
  assert.deepEqual(claimsAllowedFor(claims, subject, "core"), claims);
  assert.deepEqual(claimsAllowedFor(claims, subject, undefined), claims, "no rung known: nothing filtered");
});

test("repair strips a dangling 'Next,' when the sentence it followed was removed", () => {
  const core = "Overfitting is a model fitting noise in its training data as if it were signal.";
  const script = "Overfitting is a phenomenon where a model learns the noise as well as the pattern. Next, the mechanism ties complexity to memorisation. The example showed a degree-four curve through five points. The implications reach healthcare and finance.";
  const findings = auditBeat({ title: "Recap", script, role: "recap" }, [{ title: "Core", script: core, role: "core" }], subject, 1);
  const repaired = repairScript(script, findings);
  assert.equal(repaired.repaired, true);
  assert.match(repaired.script, /^The mechanism ties complexity/);
});
