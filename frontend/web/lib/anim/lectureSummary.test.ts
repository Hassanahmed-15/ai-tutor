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
  for (let i = 1; i <= 6; i++) assert.ok(text.includes(`## ${i}. Beat ${i}`), `beat ${i} present`);
  assert.equal(summaryTranscript([]), "");
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
