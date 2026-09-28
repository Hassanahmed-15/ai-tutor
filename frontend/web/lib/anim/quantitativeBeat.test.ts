import test from "node:test";
import assert from "node:assert/strict";
import { looksQuantitative } from "../quantitativeBeat";

/**
 * Which beats the visual director is ASKED about as a possible chart.
 *
 * A false positive costs one director round trip (the director must still answer "plotBoard"
 * before an animation is replaced). A false negative ships a graph faked out of loose lines — a
 * stray tick, arrowheads into blank space, no axis labels — which is the board that prompted this.
 */

test("THE BOARD THAT PROMPTED THIS: two penalty curves, named nowhere in the title", () => {
  assert.equal(
    looksQuantitative({
      title: "Types of Regularization",
      points: ["Absolute-value and squared penalties"],
      script: "L1 adds the absolute value of each weight to the loss, so its penalty is V-shaped with a sharp corner at zero. L2 adds the squared weight, a smooth parabola.",
    }),
    true,
  );
});

test("a title that names a chart still asks, as before", () => {
  for (const title of ["Scatter plot of study hours", "Reading the demand curve", "The x-axis and y-axis", "Histogram of exam scores"]) {
    assert.equal(looksQuantitative({ title }), true, title);
  }
});

test("one quantity against another, or a change over a range, asks", () => {
  for (const script of [
    "Plot price against quantity demanded and the line slopes down.",
    "Training loss versus epochs falls quickly, then flattens.",
    "As the learning rate increases, the loss starts to oscillate.",
    "Compound interest grows exponentially while simple interest grows linearly with time.",
    "The error decays with every extra sample.",
    "The sigmoid squashes any input into the range zero to one.",
  ]) {
    assert.equal(looksQuantitative({ title: "Section", script }), true, script);
  }
});

test("a beat that is not a chart does not ask", () => {
  for (const beat of [
    { title: "What overfitting means", script: "A model that memorises its training data fits noise instead of signal." },
    { title: "The causes of the 1857 War", script: "Several grievances came together in the Bengal Army." },
    { title: "How photosynthesis works", script: "Chloroplasts capture light and turn it into chemical energy." },
    { title: "Binary search trees", script: "Every node's left child is smaller and its right child is larger." },
    // Mentioning a number is not a chart.
    { title: "Key facts", script: "There are 206 bones in the adult human body." },
  ]) {
    assert.equal(looksQuantitative(beat), false, beat.title);
  }
});

test("only the OPENING of the narration counts, not the whole script", () => {
  // A chart word deep in a long script is about some later aside, not what this board shows.
  const script = "Overfitting means memorising noise. It hurts generalisation. Much later we might draw a graph of it.";
  assert.equal(looksQuantitative({ title: "What overfitting means", script }), false);
});

test("nothing at all is not a chart", () => {
  assert.equal(looksQuantitative({}), false);
  assert.equal(looksQuantitative({ title: "", points: [], script: "" }), false);
});
