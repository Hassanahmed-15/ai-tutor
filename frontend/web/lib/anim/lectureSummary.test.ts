import test from "node:test";
import assert from "node:assert/strict";

import { groundLectureSummary, parseLectureSummary, summaryTranscript } from "../lectureSummary";
import { isRecapTitle } from "../beatPresentation";

/**
 * The one-slide summary that replaced recap beats: a crux, a few points, and a snippet only when it
 * is complete. And the rule that no recap beat survives into a lecture plan.
 */

test("a good summary survives; a snippet is kept only when it is complete and short", () => {
  const { summary } = parseLectureSummary({
    title: "BST Deletion",
    crux: "Deleting a node keeps the BST ordered by splicing out leaves and one-child nodes, and replacing two-child nodes with their inorder successor.",
    points: ["Search left or right until the value is found.", "A leaf is simply removed.", "One child takes its parent's place.", "Two children: copy the smallest right-subtree value, then delete it."],
    code: "if (p->left && p->right) {\n    Node* s = p->right;\n    while (s->left) s = s->left;\n    p->data = s->data;\n    remove(s->data, p->right);\n}",
    language: "C++",
  });
  assert.ok(summary);
  assert.equal(summary.points.length, 4);
  assert.equal(summary.language, "cpp");
  assert.ok(summary.code?.includes("remove(s->data"));

  const stubbed = parseLectureSummary({ crux: "x", points: ["a", "b"], code: "} else {\n    // handle two children case\n}", language: "cpp" });
  assert.equal(stubbed.summary?.code, undefined, "a stubbed snippet is dropped, the summary kept");
});

test("a summary with no crux or too few points is refused with a reason", () => {
  assert.match(parseLectureSummary({ points: ["a", "b", "c"] }).issue ?? "", /crux/);
  assert.match(parseLectureSummary({ crux: "The idea.", points: ["only one"] }).issue ?? "", /points/);
  assert.equal(parseLectureSummary(null).summary, null);
});

test("the transcript carries every beat, so the end of a lecture is never crowded out", () => {
  const beats = Array.from({ length: 6 }, (_, i) => ({ title: `Beat ${i + 1}`, script: "word ".repeat(2000), points: [`point ${i + 1}`] }));
  const text = summaryTranscript(beats, 6000);
  assert.ok(text.length <= 6000);
  for (let i = 1; i <= 6; i++) assert.ok(text.includes(`## Slide ${i}. Beat ${i}`), `beat ${i} present`);
  assert.equal(summaryTranscript([]), "");
});

test("an empty beat is skipped without renumbering the slides after it", () => {
  const text = summaryTranscript([{ title: "Intro", script: "Hello." }, { title: "", script: "" }, { title: "Anode", script: "Oxidation." }]);
  assert.match(text, /## Slide 1\. Intro/);
  assert.match(text, /## Slide 3\. Anode/);
  assert.doesNotMatch(text, /## Slide 2\./);
});

test("points tagged with slides keep them, 1-based in and 0-based out, aligned with the text", () => {
  const { summary } = parseLectureSummary({
    crux: "The idea.",
    points: [{ text: "First point.", slide: 1 }, { text: "No slide." }, { text: "Too far.", slide: 9 }, { text: "Third slide.", slide: "3" }, "A plain string."],
  }, "Lecture", 4);
  assert.deepEqual(summary?.points, ["First point.", "No slide.", "Too far.", "Third slide.", "A plain string."]);
  assert.deepEqual(summary?.pointSlides, [0, null, null, 2, null]);

  const plain = parseLectureSummary({ crux: "The idea.", points: ["a", "b", "c"] }, "Lecture", 4).summary;
  assert.equal(plain && "pointSlides" in plain, false, "plain string points carry no slides at all");
});

test("strict grounding keeps each kept point's slide, and drops the promoted point's", () => {
  const source = "The energy comes from light. The leaves absorb the energy of light. Glucose is a store of chemical potential energy.";
  const tagged = {
    title: "Energy",
    crux: "The energy comes from light.",
    points: ["The leaves absorb the energy of light.", "Mitochondria release it through cellular respiration.", "Glucose is a store of chemical potential energy."],
    pointSlides: [0, 1, 2],
  };
  assert.deepEqual(groundLectureSummary(tagged, source).summary?.pointSlides, [0, 2], "the dropped point's slide goes with it");

  const promoted = groundLectureSummary({ ...tagged, crux: "Plants are Earth's primary producers, feeding every food web.", points: [...tagged.points, "The energy comes from light."], pointSlides: [0, 1, 2, 3] }, source);
  assert.equal(promoted.summary?.crux, "The leaves absorb the energy of light.");
  assert.deepEqual(promoted.summary?.points, ["Glucose is a store of chemical potential energy.", "The energy comes from light."]);
  assert.deepEqual(promoted.summary?.pointSlides, [2, 3]);
});

test("recap beats are recognised so plan builders can drop them", () => {
  for (const title of ["Cryptography Recap", "Mathematics of Cryptography Recap", "Summary", "Key Takeaways", "Putting It All Together", "Wrap-up"]) {
    assert.equal(isRecapTitle(title), true, title);
  }
  for (const title of ["RSA Algorithm Explained", "Role of Prime Numbers", "Modular Arithmetic in Cryptography"]) {
    assert.equal(isRecapTitle(title), false, title);
  }
});

test("a strict summary is held to the document, not to the scripts", () => {
  // As scopedBlockText sends it: the section heading, then its text.
  const source =
    "Energy transfer\n" +
    "The photosynthesis reaction needs a supply of energy. This energy comes from light. The leaves absorb the energy of light. " +
    "The energy is stored in the glucose that is made. The glucose is a store of chemical potential energy.";
  const faithful = {
    title: "Energy transfer",
    crux: "The energy of light is stored in glucose as chemical potential energy.",
    points: ["The energy comes from light.", "The leaves absorb the energy of light.", "Glucose is a store of chemical potential energy."],
  };
  assert.deepEqual(groundLectureSummary(faithful, source), { summary: faithful });

  const leaky = { ...faithful, points: [...faithful.points, "Mitochondria later release it through cellular respiration."] };
  const trimmed = groundLectureSummary(leaky, source);
  assert.equal(trimmed.issue, undefined, "dropping a point costs no second call");
  assert.equal(trimmed.summary?.points.length, 3);

  const outsideCrux = groundLectureSummary({ ...faithful, crux: "Plants are Earth's primary producers, feeding every food web." }, source);
  assert.match(outsideCrux.issue ?? "", /crux/);
  assert.equal(outsideCrux.summary?.crux, "The energy comes from light.", "a second miss still leaves a faithful slide");

  const outsideTitle = groundLectureSummary({ ...faithful, title: "Mitochondrial respiration pathways" }, source, "Photosynthesis");
  assert.equal(outsideTitle.summary?.title, "Photosynthesis");

  const hollow = groundLectureSummary({ ...faithful, points: ["Forests absorb carbon worldwide.", "Oceans hold phytoplankton blooms."] }, source);
  assert.equal(hollow.summary, null);
  assert.match(hollow.issue ?? "", /points/);
});
