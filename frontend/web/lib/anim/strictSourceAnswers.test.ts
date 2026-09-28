import test from "node:test";
import assert from "node:assert/strict";
import { buildGeminiLiveInstructions } from "../geminiLiveContract";
import {
  NOT_COVERED_LINE,
  PEN_TALK,
  STRICT_VOICE_RULES,
  groundTestQuestions,
  strictSourceOfQuestion,
  beatSourceGroundingFor,
  boardTextIsUngrounded,
  combinedSource,
  groundAnswer,
  lectureSourceText,
  readStrictSourceHeader,
  relevantSourceExcerpt,
  sanitizeBeatSourceGrounding,
  strictVoicePartContext,
  withStrictSourceHeader,
} from "../strictSourceAnswers";

/**
 * Strict source outside the lecture script: the ask box, the pen, the voice tutor, the summary and
 * the test. These are the deterministic pieces — building a beat's source in the browser, removing
 * the sentences of an answer the document does not support, and carrying the rule to the voice
 * tutor inside the document context it already sends.
 */

// The Cambridge Checkpoint Science page the reported strict lesson leaked on.
const ENERGY =
  "The photosynthesis reaction needs a supply of energy to make it happen. This energy comes from light. " +
  "During photosynthesis, the plant's leaves absorb the energy of light. The energy is stored in the glucose " +
  "that is made. The glucose is a store of chemical potential energy.";
const DOCUMENT = {
  contentBlocks: [
    { id: "b1", heading: "Photosynthesis", text: "Plants make glucose from carbon dioxide and water.", pageNumber: 1, role: "paragraph" },
    { id: "b2", heading: "Energy transfer", text: ENERGY, pageNumber: 1, role: "paragraph" },
    { id: "b3", text: "Diagram labels: cell wall, vacuole, chloroplast containing chlorophyll, nucleus", pageNumber: 1, role: "figure-labels" },
    { id: "b4", text: "A palisade cell from a leaf.", pageNumber: 1, role: "paragraph" },
    { id: "b5", heading: "Storing carbohydrates", text: "Plants store glucose as starch.", pageNumber: 2, role: "paragraph" },
  ],
};

test("a beat's source is its own blocks, the printed figure labels and the caption that follows them", () => {
  const source = beatSourceGroundingFor(DOCUMENT, ["b2", "b3", "b4"], true);
  assert.ok(source);
  assert.match(source.text, /\[page 1\] Energy transfer\nThe photosynthesis reaction/);
  assert.ok(!source.text.includes("starch"), "never another beat's blocks");
  assert.deepEqual(source.labels, ["cell wall", "vacuole", "chloroplast containing chlorophyll", "nucleus"]);
  assert.equal(source.caption, "A palisade cell from a leaf.");
  assert.equal(source.strict, true);

  assert.equal(beatSourceGroundingFor(DOCUMENT, [], true), null, "no provenance, no source");
  assert.equal(beatSourceGroundingFor(DOCUMENT, ["missing"], true), null);
  assert.equal(beatSourceGroundingFor(null, ["b2"], true), null);
  assert.equal(beatSourceGroundingFor(DOCUMENT, ["b2"], false)?.strict, false, "reference mode still carries the source");
});

test("the API boundary takes strictness from the server's scope, never from the payload", () => {
  const sanitized = sanitizeBeatSourceGrounding({ text: "  hello  ", labels: ["a", 3, " b ", ""], caption: "  c  ", strict: true }, false);
  assert.deepEqual(sanitized, { text: "hello", labels: ["a", "b"], caption: "c", strict: false });
  assert.equal(sanitizeBeatSourceGrounding({ text: "", labels: [] }, true), null);
  assert.equal(sanitizeBeatSourceGrounding("nope", true), null);
  assert.equal(sanitizeBeatSourceGrounding({ text: "x".repeat(10_000), labels: [] }, true)?.text.length, 6_000);
});

test("an answer the source supports is kept whole", () => {
  const answer = groundAnswer(
    "The energy comes from light. The leaves absorb the energy of light, and it is stored in the glucose that is made.",
    ENERGY,
  );
  assert.equal(answer.covered, true);
  assert.equal(answer.dropped.length, 0);
  assert.match(answer.script, /stored in the glucose/);
});

test("sentences that bring in outside material are removed, and the rest of the answer survives", () => {
  const answer = groundAnswer(
    "The energy comes from light. Chlorophyll reflects green wavelengths, which is why forests look green. " +
      "The glucose is a store of chemical potential energy.",
    ENERGY,
  );
  assert.equal(answer.covered, true);
  assert.equal(answer.dropped.length, 1);
  assert.ok(!answer.script.includes("forests"));
  assert.match(answer.script, /^The energy comes from light\. The glucose is a store/);
});

test("when nothing survives, or the model says so, the student is told plainly — once, by code", () => {
  const outside = groundAnswer("Mitochondria release energy through respiration using oxygen in every cell.", ENERGY);
  assert.equal(outside.covered, false);
  assert.equal(outside.script, NOT_COVERED_LINE);

  const hedged = groundAnswer(
    "Your notes don't mention what happens at night. But in general plants respire in darkness. The energy comes from light.",
    ENERGY,
    { modelCovered: false },
  );
  assert.equal(hedged.covered, false);
  assert.equal(hedged.script, `${NOT_COVERED_LINE} The energy comes from light.`, "the hedge and the general knowledge are both gone");

  const exact = groundAnswer(`${NOT_COVERED_LINE} This energy comes from light.`, ENERGY, { modelCovered: false });
  assert.equal(exact.script, `${NOT_COVERED_LINE} This energy comes from light.`, "the line is never doubled");
});

test("finding one's way around the lesson is still answered in strict mode", () => {
  const answer = groundAnswer("After this, the lesson moves on to storing carbohydrates.", `${ENERGY} Storing carbohydrates.`);
  assert.equal(answer.covered, true);
});

test("a fact the source states in the negative is not mistaken for a coverage denial", () => {
  const source = "Glucose is not made in the dark. Light energy is needed for photosynthesis.";
  const answer = groundAnswer("Glucose is not made in the dark, because light energy is needed.", source);
  assert.equal(answer.covered, true);
  assert.match(answer.script, /not made in the dark/);
});

test("the pen may describe the student's own marks back without that counting as outside material", () => {
  const withoutPenTalk = groundAnswer("You circled and underlined the glucose.", ENERGY);
  const withPenTalk = groundAnswer("You circled and underlined the glucose.", ENERGY, { extraAllowed: PEN_TALK });
  assert.equal(withoutPenTalk.covered, false);
  assert.equal(withPenTalk.covered, true);
});

test("an answer may quote another part of the student's document", () => {
  const beat = beatSourceGroundingFor(DOCUMENT, ["b2"], true);
  const everything = combinedSource(beat, "Starch turns blue-black with iodine solution.");
  assert.equal(groundAnswer("Starch turns blue-black with iodine.", everything).covered, true);
  assert.equal(groundAnswer("Starch turns blue-black with iodine.", beat!).covered, false);
});

test("board text is checked against the same vocabulary", () => {
  assert.equal(boardTextIsUngrounded("stored as glucose", ENERGY), false);
  assert.equal(boardTextIsUngrounded("ATP synthase enzyme", ENERGY), true);
});

test("the answer board's excerpt is the few document sentences the answer is about, in order", () => {
  const documentText = [
    "Plants make glucose from carbon dioxide and water.",
    ENERGY,
    "Plants store glucose as starch. Starch is tested with iodine solution.",
  ].join("\n");
  const excerpt = relevantSourceExcerpt(documentText, "How is starch tested with iodine?", 2_500);
  assert.match(excerpt, /Starch is tested with iodine solution\./);
  assert.ok(!excerpt.includes("chemical potential"), "unrelated sentences stay out");

  const tight = relevantSourceExcerpt(documentText, "glucose energy light starch", 60);
  assert.ok(tight.length <= 60);

  const withoutBeat = relevantSourceExcerpt(documentText, "starch glucose", 2_500, "Plants store glucose as starch.");
  assert.ok(!withoutBeat.includes("Plants store glucose as starch."), "the beat's own text is not sent twice");
  assert.equal(relevantSourceExcerpt("", "anything"), "");
  assert.equal(relevantSourceExcerpt(documentText, "the and of"), "", "no content words, nothing relevant");
});

test("the voice tutor's strict header round-trips through the document context it already sends", () => {
  const beat = beatSourceGroundingFor(DOCUMENT, ["b2", "b3", "b4"], true);
  const context = withStrictSourceHeader("[page 1] the whole document", beat);
  assert.match(context, /^SOURCE FIDELITY: STRICT/);
  const read = readStrictSourceHeader(context);
  assert.equal(read.strict, true);
  assert.equal(read.document, "[page 1] the whole document");
  assert.equal(read.beatSource?.text, beat!.text);
  assert.deepEqual(read.beatSource?.labels, beat!.labels);
  assert.equal(read.beatSource?.caption, beat!.caption);

  const noPart = readStrictSourceHeader(withStrictSourceHeader("doc", null));
  assert.deepEqual(noPart, { strict: true, beatSource: null, document: "doc" });

  const plain = readStrictSourceHeader("an ordinary document context");
  assert.deepEqual(plain, { strict: false, beatSource: null, document: "an ordinary document context" });
});

test("the header survives the routes' 30k cut: the document yields, not the rule", () => {
  const beat = beatSourceGroundingFor(DOCUMENT, ["b2"], true);
  const context = withStrictSourceHeader("x".repeat(40_000), beat);
  assert.equal(context.length, 30_000);
  assert.equal(readStrictSourceHeader(context.slice(0, 30_000)).beatSource?.text, beat!.text);
});

test("the per-part voice update carries the part's own text, and nothing when there is none", () => {
  const beat = beatSourceGroundingFor(DOCUMENT, ["b2", "b3", "b4"], true);
  const update = strictVoicePartContext(beat);
  assert.match(update, /ONLY from the document/);
  assert.match(update, /Figure labels, as printed: cell wall · vacuole/);
  assert.equal(strictVoicePartContext(null), "");
});

test("the lecture's source is the blocks its beats taught, in document order", () => {
  const taught = lectureSourceText(DOCUMENT, [{ sourceBlockIds: ["b5"] }, { sourceBlockIds: ["b2"] }]);
  assert.ok(taught.indexOf("Energy transfer") < taught.indexOf("Storing carbohydrates"));
  assert.ok(!taught.includes("carbon dioxide"), "an untaught block is not the lecture's source");
  const everything = lectureSourceText(DOCUMENT, [{}, {}]);
  assert.match(everything, /carbon dioxide/, "no provenance at all: the selected pages stand in");
  assert.equal(lectureSourceText(null, [{ sourceBlockIds: ["b1"] }]), "");
});

test("the voice tutor's instruction carries the strict rule and the part's source only when the header does", () => {
  const beat = beatSourceGroundingFor(DOCUMENT, ["b2", "b3", "b4"], true);
  const base = { topic: "Photosynthesis", beatContext: "Energy transfer: the script", lessonContext: "1. Energy transfer", mood: "", adhdMode: false, checkinMode: false, examQuestions: [] };

  const strict = buildGeminiLiveInstructions({ ...base, documentContext: withStrictSourceHeader("[page 1] the document", beat) });
  assert.ok(strict.includes(STRICT_VOICE_RULES));
  assert.ok(strict.indexOf(STRICT_VOICE_RULES) < strict.indexOf("Lesson topic"), "the rule sits straight after the persona");
  assert.match(strict, /ONLY material you may teach or answer from:\n\[page 1\] the document/);
  assert.match(strict, /Figure labels, as printed: cell wall/);
  assert.match(strict, /Current lecture position \(the lesson's wording/);
  assert.ok(!strict.includes("SOURCE FIDELITY: STRICT"), "the header is parsed, not pasted");

  const reference = buildGeminiLiveInstructions({ ...base, documentContext: "[page 1] the document" });
  assert.ok(!reference.includes(STRICT_VOICE_RULES));
  assert.match(reference, /Answer from THIS whenever the question is about their material/);
  assert.match(reference, /Current lecture position:\n/);

  const checkin = buildGeminiLiveInstructions({ ...base, checkinMode: true, documentContext: withStrictSourceHeader("UNIQUE-DOCUMENT-TEXT", beat) });
  assert.ok(!checkin.includes("UNIQUE-DOCUMENT-TEXT") && !checkin.includes(STRICT_VOICE_RULES), "a check-in still carries no lesson at all");
});

test("a strict test keeps only the questions the source can answer, each with the sentences it is about", () => {
  const source = [ENERGY, "Plants store glucose as starch. Starch is tested with iodine solution."].join("\n");
  const questions = [
    { id: "q1", prompt: "Explain where the energy stored in glucose comes from.", rubric: { keyPoints: ["The energy comes from light", "Leaves absorb light energy"], modelAnswer: "The energy comes from light. The leaves absorb the energy of light and it is stored in the glucose." } },
    { id: "q2", prompt: "Predict what would happen to a plant kept in darkness for a week.", rubric: { keyPoints: ["No light energy"], modelAnswer: "It would use up its starch." } },
    { id: "q3", prompt: "Why is glucose described as a store of energy?", rubric: { keyPoints: ["chemical potential energy", "mitochondria release it through respiration"], modelAnswer: "The glucose is a store of chemical potential energy." } },
    { id: "q4", prompt: "How is starch tested?", rubric: { keyPoints: ["iodine solution"], modelAnswer: "Starch is tested with iodine solution. The ATP synthase enzyme then phosphorylates it." } },
  ];
  const { kept, dropped } = groundTestQuestions(questions, source);
  assert.deepEqual(kept.map((q) => q.id), ["q1", "q3"]);
  assert.equal(dropped, 2);
  assert.deepEqual(kept[1].rubric.keyPoints, ["chemical potential energy"], "an outside key point is removed, not graded against");
  assert.match(kept[0].strictSource, /energy comes from light/);
  assert.equal(strictSourceOfQuestion(kept[0]), kept[0].strictSource);
  assert.equal(strictSourceOfQuestion({ id: "q9" }), "", "a reference-mode question carries no source");
  assert.equal(strictSourceOfQuestion(null), "");
});
