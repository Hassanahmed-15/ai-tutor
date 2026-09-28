import test from "node:test";
import assert from "node:assert/strict";
import {
  figureLabelsFromBlocks,
  groundingRatio,
  labelIsGrounded,
  sourceVocabulary,
  ungroundedSentences,
} from "../sourceGrounding";

// The "Energy transfer" section of the Cambridge Checkpoint Science page a strict lesson leaked on.
const ENERGY =
  "The photosynthesis reaction needs a supply of energy to make it happen. This energy comes from light. " +
  "During photosynthesis, the plant's leaves absorb the energy of light. The energy is stored in the glucose " +
  "that is made. The glucose is a store of chemical potential energy.";
const LABELS = ["cell wall", "cell surface", "membrane", "cytoplasm", "vacuole", "chloroplast containing chlorophyll", "nucleus"];
const SOURCE = { text: ENERGY, labels: LABELS, caption: "Photosynthesis happens inside the chloroplasts in a palisade cell like this one.", strict: true };

test("a faithful explanation of the source is grounded", () => {
  const script =
    "Photosynthesis needs a supply of energy. That energy comes from light. The leaves absorb the light's energy, " +
    "and it is stored in the glucose that is made. So glucose is a store of chemical potential energy.";
  assert.deepEqual(ungroundedSentences(script, SOURCE), []);
  assert.ok(groundingRatio(script, SOURCE) > 0.9);
});

test("outside material is flagged sentence by sentence", () => {
  const script =
    "This energy comes from light. Solar panels also convert sunlight, turning photons into electricity for our homes.";
  const flagged = ungroundedSentences(script, SOURCE);
  assert.equal(flagged.length, 1);
  assert.match(flagged[0].sentence, /Solar panels/);
});

test("the invented board labels from the reported lesson are not grounded, the figure's own are", () => {
  const vocab = sourceVocabulary(SOURCE);
  assert.equal(labelIsGrounded("Light starts the process", vocab), false);
  assert.equal(labelIsGrounded("Leaf cells", vocab), true, "leaf and cell are both source words");
  assert.equal(labelIsGrounded("chloroplast containing chlorophyll", vocab), true);
  assert.equal(labelIsGrounded("Stomata", vocab), false);
});

test("a spoken negation is two words, not the non-word 'doesn'", () => {
  // "doesn't" used to survive as "doesn", one ungrounded content term in every negated line.
  const vocab = sourceVocabulary(SOURCE);
  assert.equal(labelIsGrounded("light doesn't store energy", vocab), true);
  assert.equal(labelIsGrounded("the glucose isn't made", vocab), true);
  assert.equal(labelIsGrounded("leaves can't absorb light", vocab), true);
  assert.equal(labelIsGrounded("light won't store energy", vocab), true);
  // A source that itself says "doesn't" still licenses "does not".
  assert.equal(labelIsGrounded("water does not move", sourceVocabulary("Water doesn't move.")), true);
});

test("formula spellings count as the words they stand for", () => {
  const vocab = sourceVocabulary("They use carbon dioxide and water to make glucose and oxygen.");
  assert.equal(labelIsGrounded("CO2 + water", vocab), true);
  assert.equal(labelIsGrounded("O2", vocab), true);
  assert.equal(labelIsGrounded("N2", vocab), false);
});

test("figure labels come from the text layer block, never model text", () => {
  const labels = figureLabelsFromBlocks([
    { role: "paragraph", text: "The photosynthesis reaction…" },
    { role: "figure-labels", text: "Diagram labels: cell wall, cell surface, membrane, cytoplasm" },
  ]);
  assert.deepEqual(labels, ["cell wall", "cell surface", "membrane", "cytoplasm"]);
});

test("strict keeps plain-word explanation of the source and removes outside content", async () => {
  const { sentenceIsGrounded } = await import("../sourceGrounding");
  const vocab = sourceVocabulary(`Energy transfer\n${ENERGY}`);
  for (const keep of [
    "In other words, the leaves take in light, and that light is the energy the reaction needs.",
    "So the energy from light ends up stored inside the glucose the plant makes.",
    "Starch turns blue-black".replace("Starch turns blue-black", "The glucose is a store of chemical energy."),
  ]) assert.equal(sentenceIsGrounded(keep, vocab), true, keep);
  for (const drop of [
    "This happens inside chloroplasts using chlorophyll pigments.",
    "About 1% of sunlight is captured by the leaf.",
    "Mitochondria later release this energy through cellular respiration.",
    "Solar panels do the same thing for our homes.",
  ]) assert.equal(sentenceIsGrounded(drop, vocab), false, drop);
});
