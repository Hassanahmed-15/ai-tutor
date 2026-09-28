/**
 * STRICTLY FROM THE SOURCE, ENFORCED.
 *
 * The strict lesson that leaked was built from the Cambridge Checkpoint Science page these fixtures
 * copy: its "Energy transfer" section (five sentences, a palisade-cell figure with printed labels, a
 * caption) was taught with a solar-panel analogy, steps the page never states, and a board drawn
 * from general knowledge. These tests pin the deterministic half of the fix — the word budget, the
 * grounding gate, the repetition exemption, the adaptation filter, the checkpoint rule, the plan's
 * titles and roles, and the prompt's strict wording — so none of it can quietly regress.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  beatNeedsBoard,
  beatSourceGrounding,
  cleanSourceText,
  expandedCropRect,
  groundBeatToSource,
  isCheckpointBeat,
  isNearVerbatimSource,
  questionAnswerBlockIds,
  removeSentences,
  sourceFigureRegion,
  sourceScriptFromBlocks,
  sourceWordCount,
  strictAdaptationNotes,
  strictRepetitionFindings,
  ungroundedScriptSentences,
} from "../strictSourceScript";
import { depthBudget, strictDepthBudget } from "../lectureDepth";
import { polishBeatPlan } from "../beatPresentation";
import { buildProgressivePlan } from "../progressivePlan";
import { buildBeatScriptMessages, type BeatScriptPromptInput } from "../beatScriptPrompt";
import { lessonMapBlock, roleBriefing, scriptRoleFor } from "../lessonLadder";
import { compactSuprnotesForPrompt, type SuprnotesContentBlock, type SuprnotesLessonInput } from "../suprnotes";
import { learnerBrief } from "../learnerBrief";
import { emptyProfile } from "../learnerProfile";
import { scopedBlockText } from "../beatSourceScope";
import { sourceScopeInstruction } from "../sourceScope";
import type { RepetitionFinding } from "../lessonRepetition";
import type { ProgressiveLectureInput } from "../progressiveLectureTypes";

// Page 1 of the excerpt, as parse-pdf's text layer produced it (ligature splits included).
const BLOCKS: SuprnotesContentBlock[] = [
  { id: "p1-b2", pageNumber: 1, sourceOrder: 1, role: "paragraph", heading: "Plant organsPhotosynthesis", text: "Photosynthesis is the way that plants make food. They use carbon dioxide and water to make glucose and oxygen. Photosynthesis is a chemical reaction. We can summarise it using a word equation:" },
  { id: "p1-b3", pageNumber: 1, sourceOrder: 2, role: "formula", type: "formula", heading: "Plant organsPhotosynthesis", text: "carbon dioxide + water→glucose + oxygen" },
  { id: "p1-b4", pageNumber: 1, sourceOrder: 3, role: "paragraph", heading: "Energy transfer", text: "The photosynthesis reaction needs a supply of energy to make it happen. This energy comes from light. During photosynthesis, the plant’s leaves absorb the energy of light. The energy is stored in the glucose that is made. The glucose is a store of chemical potential energy." },
  { id: "p1-b5", pageNumber: 1, sourceOrder: 4, role: "figure-labels", heading: "Energy transfer", text: "Diagram labels: cell wall, cell surface, membrane, cytoplasm, vacuole, chloroplast containing chlorophyll, nucleus", bbox: { x: 0.124, y: 0.441, width: 0.734, height: 0.155 } },
  { id: "p1-b6", pageNumber: 1, sourceOrder: 5, role: "paragraph", heading: "Energy transfer", text: "Photosynthesis happens inside the chloroplasts in a palisade cell like this one." },
  { id: "p1-b7", pageNumber: 1, sourceOrder: 6, role: "questions", heading: "Energy transfer", text: "Questions 1 Think back to (remember) what you have already learnt about photosynthesis. a Where do plants get carbon dioxide from? b Where do plants get water from? 2 Explain why photosynthesis only takes place inside chloroplasts." },
  { id: "p1-b8", pageNumber: 1, sourceOrder: 7, role: "paragraph", heading: "Storing carbohydrates", text: "Glucose is a sugar. Plants usually make much more glucose than they need to use immediately. Glucose is soluble in water, which makes it diﬃ cult to store inside a cell. Instead, the plant changes some of the glucose into a diff erent kind of carbohydrate – starch." },
];
const ENERGY_IDS = ["p1-b4", "p1-b5", "p1-b6"];

function energySource() {
  const source = beatSourceGrounding(BLOCKS, ENERGY_IDS, true);
  assert.ok(source, "the Energy transfer beat has a source");
  return source;
}

// ─── the beat's source ────────────────────────────────────────────────────────────────────────

test("a beat's source is its own blocks, the figure's PRINTED labels, and the caption under the figure", () => {
  const source = energySource();
  assert.equal(source.strict, true);
  assert.match(source.text, /supply of energy/);
  assert.doesNotMatch(source.text, /way that plants make food/, "the Photosynthesis section leaked into Energy transfer");
  assert.deepEqual(source.labels, ["cell wall", "cell surface", "membrane", "cytoplasm", "vacuole", "chloroplast containing chlorophyll", "nucleus"]);
  assert.equal(source.caption, "Photosynthesis happens inside the chloroplasts in a palisade cell like this one.");
  assert.equal(beatSourceGrounding(BLOCKS, ENERGY_IDS, false)?.strict, false, "reference mode passes the same source with strict:false");
  assert.equal(beatSourceGrounding(BLOCKS, [], true), null, "no blocks, no source — never an empty fence");
});

test("the figure is located by its labels block, and a crop grows it 8% and stays on the page", () => {
  const figure = sourceFigureRegion(BLOCKS, ENERGY_IDS);
  assert.equal(figure?.pageNumber, 1);
  const rect = expandedCropRect(figure!.bbox, 1000, 1400, 0.08);
  assert.ok(rect.x < 124 && rect.y < 0.441 * 1400, "the crop starts before the label box");
  assert.ok(rect.x + rect.width <= 1000 && rect.y + rect.height <= 1400, "the crop stays on the page");
  assert.ok(rect.width > 0.734 * 1000, "the crop is wider than the label box");
  const edge = expandedCropRect({ x: 0.95, y: 0.95, width: 0.2, height: 0.2 }, 1000, 1000, 0.08);
  assert.ok(edge.x + edge.width <= 1000 && edge.y + edge.height <= 1000, "clamped at the page edge");
  // A single stray "label" (a numbered step) is not a figure worth cropping.
  assert.equal(sourceFigureRegion([{ id: "x", pageNumber: 2, role: "figure-labels", text: "Diagram labels: 3", bbox: { x: 0.7, y: 0.39, width: 0.2, height: 0.2 } }], ["x"]), null);
});

test("text-layer ligature splits are rejoined, so 'difficult' is a source word", () => {
  assert.equal(cleanSourceText("diﬃ cult to store, a diff erent kind"), "difficult to store, a different kind");
  assert.equal(cleanSourceText("if you turn it off then"), "if you turn it off then", "real words are left alone");
});

test("the source said aloud: no page labels, no repeated headings, labels read as labels", () => {
  const spoken = sourceScriptFromBlocks(BLOCKS, ENERGY_IDS);
  assert.match(spoken, /^The photosynthesis reaction needs a supply of energy/);
  assert.match(spoken, /The diagram is labelled: cell wall, cell surface, membrane/);
  assert.doesNotMatch(spoken, /\[page|Energy transfer\n/);
  assert.equal(sourceWordCount(BLOCKS, ENERGY_IDS) > 50 && sourceWordCount(BLOCKS, ENERGY_IDS) < 90, true);
});

test("scoped source text names each section once, not above every block", () => {
  const text = scopedBlockText(BLOCKS, ENERGY_IDS);
  assert.equal(text.match(/\[page 1\] Energy transfer/g)?.length, 1);
  const two = scopedBlockText(BLOCKS, ["p1-b2", "p1-b4"]);
  assert.match(two, /\[page 1\] Plant organsPhotosynthesis/);
  assert.match(two, /\[page 1\] Energy transfer/, "a new heading is labelled again");
});

// ─── the word budget ──────────────────────────────────────────────────────────────────────────

test("STRICT WORD BUDGET: a 75-word section gets a ~150-word board, not 260-360", () => {
  const balanced = depthBudget("balanced");
  const energy = strictDepthBudget(75, balanced);
  assert.deepEqual(energy.wordRange, [90, 150], "clamp(1.6 × 75 + 30, 60, 360) = 150");
  assert.deepEqual(energy.movements, [1, 2]);
  assert.deepEqual(strictDepthBudget(10, balanced).wordRange, [40, 60], "a one-line section still gets a real explanation");
  assert.equal(strictDepthBudget(900, balanced).wordRange[1], 360, "never beyond the depth setting's ceiling");
  assert.equal(strictDepthBudget(900, depthBudget("concise")).wordRange[1], 240);
  assert.ok(strictDepthBudget(75, balanced).wordRange[1] < balanced.wordRange[0], "strict is shorter than the slider asked");
});

// ─── the grounding gate ───────────────────────────────────────────────────────────────────────

const LEAKY_SCRIPT = [
  "The photosynthesis reaction needs a supply of energy, and that energy comes from light.",
  "Think of the leaf as a solar panel that turns sunlight into electricity for the plant.",
  "The leaves absorb the energy of light.",
  "So the energy is stored in the glucose that is made, as chemical potential energy.",
  "Later the plant burns this glucose in respiration to power growth in its roots.",
].join(" ");

test("GROUNDING GATE: sentences that bring in outside material are found, faithful ones are not", () => {
  const flagged = ungroundedScriptSentences(LEAKY_SCRIPT, energySource()).map((f) => f.sentence);
  assert.equal(flagged.length, 2, flagged.join(" | "));
  assert.match(flagged[0], /solar panel/);
  assert.match(flagged[1], /respiration/);
});

test("GROUNDING GATE: flagged sentences are deleted, and every student-facing field is fenced", () => {
  const { beat, removed } = groundBeatToSource(
    {
      script: LEAKY_SCRIPT,
      transitionIn: "Next, discover how solar panels and batteries mirror what leaves do.",
      points: ["Energy comes from light", "Leaves act like solar panels"],
      keyClaims: ["Photosynthesis needs energy from light.", "Plants burn glucose in respiration."],
      definitionTerm: "Photosynthesis",
      definitionMeaning: "The process by which autotrophs harvest photons using thylakoid membranes.",
      slideKind: "checkpoint",
      checkpoint: { prompt: "?", revealAnswer: "x" },
    },
    energySource(),
    { sourceScript: sourceScriptFromBlocks(BLOCKS, ENERGY_IDS), fallbackTransition: "That foundation leads directly into Energy Transfer." },
  );
  assert.equal(removed.length, 2);
  assert.doesNotMatch(beat.script, /solar panel|respiration/);
  assert.match(beat.script, /leaves absorb the energy of light/);
  assert.equal(beat.transitionIn, "That foundation leads directly into Energy Transfer.", "an ungrounded bridge is replaced, never shipped");
  assert.deepEqual(beat.points, ["Energy comes from light"]);
  assert.deepEqual(beat.keyClaims, ["Photosynthesis needs energy from light."], "a leaked claim would become ESTABLISHED for every later board");
  assert.equal(beat.definitionTerm, undefined);
  assert.equal(beat.definitionMeaning, undefined);
  assert.equal(beat.checkpoint, undefined, "an uploaded source carries no model-written quiz");
  assert.equal(beat.slideKind, "intro");
});

test("GROUNDING GATE: when nothing survives, the script is the source itself", () => {
  const { beat } = groundBeatToSource(
    { script: "Solar panels convert photons into electricity. Batteries store that electricity for the night.", points: [], keyClaims: [] },
    energySource(),
    { sourceScript: sourceScriptFromBlocks(BLOCKS, ENERGY_IDS) },
  );
  assert.match(beat.script, /^The photosynthesis reaction needs a supply of energy/);
  assert.ok(beat.points.length > 0, "the board still gets points — from the source");
  assert.ok((beat.keyClaims ?? []).length > 0);
});

test("GROUNDING GATE: a faithful, conversational explanation of the source survives", () => {
  const faithful = [
    "Photosynthesis is a reaction, and it needs a supply of energy to make it happen.",
    "So where does that energy come from?",
    "It comes from light.",
    "During photosynthesis, the plant's leaves absorb the energy of light.",
    "That energy doesn't disappear — it's stored in the glucose the plant makes.",
    "Now look at the diagram of the palisade cell: you can see the cell wall, the cytoplasm, the vacuole and the nucleus.",
    "And here are the chloroplasts, which contain chlorophyll.",
    "Photosynthesis happens inside these chloroplasts.",
  ].join(" ");
  assert.deepEqual(ungroundedScriptSentences(faithful, energySource()), [], "a negation is not outside material");
});

test("removing a sentence never leaves the next one hanging on a connective", () => {
  const { script, removed } = removeSentences("Light gives energy. Solar panels do too. So the leaf absorbs it. It is stored.", ["Solar panels do too."]);
  assert.deepEqual(removed, ["Solar panels do too."]);
  assert.equal(script, "Light gives energy. The leaf absorbs it. It is stored.");
});

// ─── the repetition gate, in strict mode ──────────────────────────────────────────────────────

test("REPETITION IN STRICT: the source's own sentences are never 'repetition', and whole-board overlap is not actionable", () => {
  const own = energySource().text;
  assert.equal(isNearVerbatimSource("This energy comes from light.", own), true);
  assert.equal(isNearVerbatimSource("The leaves of the plant absorb the energy of light.", own), true);
  assert.equal(isNearVerbatimSource("Plants use carbon dioxide and water to make glucose.", own), false, "another section's sentence is not this board's source");
  const findings: RepetitionFinding[] = [
    { kind: "restated-sentence", beatIndex: 2, sentence: "This energy comes from light.", score: 0.8 },
    { kind: "restated-sentence", beatIndex: 2, sentence: "Plants use carbon dioxide and water to make glucose.", score: 0.8 },
    { kind: "beat-overlap", beatIndex: 2, sentence: "whole script", score: 0.5 },
  ];
  const kept = strictRepetitionFindings(findings, own);
  assert.deepEqual(kept.map((f) => f.sentence), ["Plants use carbon dioxide and water to make glucose."], "scope bleed from another section is still caught");
});

test("the strict regeneration asks for deletion, never for new information", () => {
  const finding: RepetitionFinding = { kind: "restated-sentence", beatIndex: 1, sentence: "Plants make food.", score: 0.9 };
  const strict = buildBeatScriptMessages({ ...promptInput(true), repetitionFeedback: [{ finding }], groundingFeedback: [{ sentence: "Leaves are solar panels.", missing: ["solar", "panel"] }] });
  assert.match(strict.system, /DELETED/);
  assert.doesNotMatch(strict.system, /NEW information|concrete step, quantity or case/);
  assert.match(strict.system, /SAID THINGS THIS BOARD'S SOURCE DOES NOT SAY[\s\S]*Leaves are solar panels\.[\s\S]*\[solar, panel\]/);
  const ordinary = buildBeatScriptMessages({ ...promptInput(false), repetitionFeedback: [{ finding }] });
  assert.match(ordinary.system, /replace each with NEW information/, "typed-topic lessons keep their feedback");
});

// ─── the prompt ───────────────────────────────────────────────────────────────────────────────

function promptInput(strict: boolean): BeatScriptPromptInput {
  return {
    topic: "Photosynthesis",
    planned: { sequence: 1, title: "Energy transfer", objective: "Teach these source blocks completely and in order from page 1.", role: strict ? "source" : undefined },
    plan: [
      { sequence: 0, title: "Photosynthesis", objective: "Teach these source blocks completely and in order from page 1.", role: strict ? "source" : undefined },
      { sequence: 1, title: "Energy transfer", objective: "Teach these source blocks completely and in order from page 1.", role: strict ? "source" : undefined },
      { sequence: 2, title: "Questions: Photosynthesis", objective: "Teach these source blocks completely and in order from page 1.", role: strict ? "questions" : undefined },
    ],
    taught: [{ sequence: 0, title: "Photosynthesis", keyClaims: ["Photosynthesis is the way that plants make food."] }],
    wordRange: strict ? "90-150" : "260-360",
    movements: strict ? [1, 2] : [3, 4],
    learnerProfile: { expertise: "beginner", depth: "balanced", goal: "school", codeExamples: false, preferredExamples: "real-world" },
    isCheckpoint: false,
    sourceContext: "The photosynthesis reaction needs a supply of energy to make it happen.",
    sourceInstruction: strict ? sourceScopeInstruction({ breadth: { kind: "whole" }, fidelity: "strict", documentLabels: [] }) : "",
    strict,
  };
}

test("STRICT CONTRACT: outside examples and analogies are forbidden, and a shorter board is correct", () => {
  const rule = sourceScopeInstruction({ breadth: { kind: "whole" }, fidelity: "strict", documentLabels: [] });
  assert.doesNotMatch(rule, /clearly labelled explanatory examples or analogies/);
  assert.match(rule, /Do not add any fact, number, name, example, analogy, application, history/);
  assert.match(rule, /If the source does not say it, do not say it: a shorter board is correct/);
  const reference = sourceScopeInstruction({ breadth: { kind: "whole" }, fidelity: "reference", documentLabels: [] });
  assert.match(reference, /freely expand with outside knowledge/, "reference mode is unchanged");
});

test("STRICT PROMPT: every part that asked for outside material switches to its source-only form", () => {
  const { system, user } = buildBeatScriptMessages(promptInput(true));
  assert.match(system, /JOB: EXPLAIN ITS SOURCE/);
  assert.doesNotMatch(system, /RUNG: MECHANISM|Depth means new information/);
  assert.match(system, /The script must be 90-150 words — sized to this board's source/);
  assert.match(system, /keyClaims: 2-4 short sentences, each a statement THIS board's source makes/);
  assert.match(system, /warm, specific|source's opening idea/);
  const payload = JSON.parse(user) as { preferredExamples: unknown; lessonMap: string };
  assert.equal(payload.preferredExamples, null, "'real-world' examples are by definition not in the source");
  assert.doesNotMatch(payload.lessonMap, /adds NEW information only/);
  assert.doesNotMatch(payload.lessonMap, /will teach: Teach these source blocks/, "upcoming boards are named by title, not the pipeline instruction");

  const ordinary = buildBeatScriptMessages(promptInput(false));
  assert.match(ordinary.system, /RUNG: MECHANISM/, "an unstrict lesson is briefed exactly as before");
  assert.match(JSON.parse(ordinary.user).lessonMap, /adds NEW information only/);
});

test("a Questions board reads the printed questions and never answers beyond the source", () => {
  assert.equal(scriptRoleFor(undefined, true), "source");
  assert.equal(scriptRoleFor("example", true), "source", "a strict lesson is never briefed to invent a worked example");
  assert.equal(scriptRoleFor("questions", true), "questions");
  assert.equal(scriptRoleFor(undefined, false), "mechanism");
  const briefing = roleBriefing("questions", [1, 2]);
  assert.match(briefing, /Read each question/);
  assert.match(briefing, /Never answer a question beyond what the source states/);
  const ids = questionAnswerBlockIds(
    [
      { sequence: 0, sourceBlockIds: ["p1-b2", "p1-b3"] },
      { sequence: 1, sourceBlockIds: ENERGY_IDS },
      { sequence: 2, sourceBlockIds: ["p1-b7"] },
    ],
    2,
    BLOCKS,
  );
  assert.deepEqual(ids, ["p1-b2", "p1-b3", ...ENERGY_IDS], "the sections on the question box's page are where its answers are");
  assert.match(lessonMapBlock([{ sequence: 0, title: "A", objective: "x" }], 0, [], { strict: true }), /ONLY its own source blocks/);
});

test("strict learner brief pitches the wording and never asks for an example the source lacks", () => {
  const profile = { ...emptyProfile("photosynthesis"), misconceptions: ["plants get food from soil"] };
  const beat = { title: "Energy transfer", objective: "photosynthesis soil" };
  const strict = learnerBrief(profile, beat, "script", 1, { strict: true });
  assert.doesNotMatch(strict, /worked example BEFORE|Correct this belief/);
  assert.match(strict, /never make one up/);
  assert.doesNotMatch(learnerBrief(profile, beat, "visual", 5, { strict: true }), /comparison or a variant/);
  assert.match(learnerBrief(profile, beat, "script", 1), /worked example BEFORE/, "unstrict is unchanged");
});

// ─── adaptation and checkpoints ───────────────────────────────────────────────────────────────

test("STRICT ADAPTATION: pacing survives, requests for outside content do not", () => {
  const notes = [
    "The learner asked for more worked and concrete examples in upcoming beats.",
    "The learner struggled with the latest checkpoint; add remediation and a concrete example.",
    "The learner asked: \"is it like a solar panel?\" Infer what this reveals about their prior knowledge, confusion, desired depth, and interests. Adapt upcoming beats only where the evidence supports it, and do not repeat the immediate answer.",
    "The learner asked for deeper technical detail in upcoming beats.",
    "The learner asked for simpler language and smaller conceptual steps in upcoming beats.",
    "The learner struggled with the latest checkpoint; go more slowly, in simpler language, through the source's own statements.",
    "The learner answered the latest checkpoint correctly; avoid unnecessary repetition.",
  ];
  assert.deepEqual(strictAdaptationNotes(notes), notes.slice(4));
  assert.deepEqual(strictAdaptationNotes(undefined), []);
});

test("CHECKPOINTS: no lesson gets a model-written quiz beat (understanding is the Got it button), and a quiz slide gets no board", () => {
  assert.equal(isCheckpointBeat(3, 8, "prompt"), false, "typed topics no longer get quiz slides");
  for (const sourceType of ["pdf", "pptx", "suprnotes", "task-folder"]) {
    assert.equal(isCheckpointBeat(3, 8, sourceType), false, `${sourceType} lessons carry their own questions`);
  }
  assert.equal(isCheckpointBeat(0, 8, "prompt"), false);
  assert.equal(isCheckpointBeat(7, 8, "prompt"), false);
  assert.equal(beatNeedsBoard({ slideKind: "checkpoint" }), false);
  assert.equal(beatNeedsBoard({ slideKind: "intro" }), true);
});

// ─── the plan ─────────────────────────────────────────────────────────────────────────────────

test("TITLES: a weakly titled document section is named by its own opening words, never a generic role title", () => {
  const entries = [
    { title: "Photosynthesis", objective: "Teach these source blocks completely and in order from page 1.", ids: ["p1-b2"] },
    { title: "Page 3", objective: "Teach these source blocks completely and in order from page 3.", ids: ["p1-b8"] },
    { title: "Figure 1.2", objective: "Teach these source blocks completely and in order from page 3.", ids: ["p1-b4"] },
    { title: "Slide 4", objective: "Teach these source blocks completely and in order from page 4.", ids: ["p1-b8"] },
  ];
  const opening = (entry: { ids: string[] }) => BLOCKS.find((b) => b.id === entry.ids[0])!.text!.split(/(?<=\.)\s/)[0].replace(/\.$/, "");
  const titles = polishBeatPlan(entries, "Photosynthesis", { sourceOpening: opening }).map((e) => e.title);
  for (const title of titles) {
    assert.doesNotMatch(title, /Worked Example|Common Pitfalls|Applications|Advanced Concepts|Fundamentals|Mechanism|Concept Connections|Practice/);
  }
  assert.equal(titles[0], "Photosynthesis");
  assert.equal(titles[1], "Glucose Is a Sugar");
  assert.match(titles[2], /^The Photosynthesis Reaction/);
  assert.equal(titles[3], "Glucose Is a Sugar (Part 2)", "a duplicate is numbered, not renamed to a role");
  // Typed topics keep the default-plan behaviour.
  const typed = polishBeatPlan([{ title: "X", objective: "" }, { title: "Idea 2", objective: "" }, { title: "Idea 3", objective: "" }, { title: "Idea 4", objective: "" }], "Photosynthesis");
  assert.ok(typed.some((e) => /Mechanism|Worked Example|Fundamentals/.test(e.title)));
});

function pdfInput(fidelity: "strict" | "reference"): ProgressiveLectureInput {
  const beat = (title: string, sourceBlockIds: string[]) => ({ title, objective: "Teach these source blocks completely and in order from page 1, connecting them as one coherent explanation.", sourceBlockIds, visualMode: "paper_whiteboard" });
  const suprnotes: SuprnotesLessonInput = {
    schemaVersion: "suprnotes.lesson_input.v1",
    contentBlocks: [...BLOCKS, { id: "p2-b6", pageNumber: 2, sourceOrder: 8, role: "paragraph", heading: "Summary", text: "Photosynthesis is the production of glucose and oxygen." }],
    lessonPlan: {
      beats: [
        beat("Photosynthesis", ["p1-b2", "p1-b3"]),
        beat("Energy transfer", ENERGY_IDS),
        beat("Questions: Photosynthesis", ["p1-b7"]),
        beat("Page 1", ["p1-b8"]),
        beat("Summary", ["p2-b6"]),
      ],
    },
  };
  return {
    topic: "Photosynthesis", mood: "", sourceType: "pdf", mode: "standard", suprnotes,
    sourceScope: { breadth: { kind: "whole" }, fidelity, documentLabels: [] },
    learnerProfile: { expertise: "beginner", depth: "deep", goal: "school", codeExamples: false, preferredExamples: "mixed", rationale: "", confirmedAt: "" },
  };
}

test("STRICT PLAN: source and questions roles, one board per section, and the source's own summary kept", () => {
  const plan = buildProgressivePlan(pdfInput("strict"));
  assert.deepEqual(plan.map((b) => b.role), ["source", "source", "questions", "source", "source"]);
  assert.ok(plan.every((b) => (b.conceptPasses ?? 1) === 1), "no invented 'work an example' continuation boards");
  assert.equal(plan.length, 5, "a section headed Summary is source content in a strict lesson");
  assert.equal(plan[3].title, "Glucose Is a Sugar", "'Page 1' is named by what the section says");
  for (const b of plan) assert.doesNotMatch(b.title, /Worked Example|Common Pitfalls|Applications/);

  const reference = buildProgressivePlan(pdfInput("reference"));
  assert.ok(reference.every((b) => b.role === undefined), "reference plans keep their unassigned rungs");
  assert.ok(!reference.some((b) => /^Summary$/i.test(b.title)), "reference lessons still drop recap sections");
});

// ─── the source JSON the script writer sees ───────────────────────────────────────────────────

test("BEAT SOURCE JSON: the beat's blocks with roles and captions — no whole-document plan, directives or vision text", () => {
  const document: SuprnotesLessonInput = {
    schemaVersion: "suprnotes.lesson_input.v1",
    source: { adapter: "pdf-upload" },
    lesson: { title: "Photosynthesis" },
    generationDirectives: { imagePolicy: "use_provided_images_only", disableAiImageGeneration: true },
    contentGovernance: { groundingPolicy: "strict_provided_content_only" },
    contentBlocks: BLOCKS.filter((b) => ENERGY_IDS.includes(b.id)),
    assets: [{ id: "fig", caption: "illustration from page 1", description: "Illustration showing a green leaf in sunlight.", sourceBlockIds: ["p1-b5"], teachingUse: { focusRegions: [{ label: "stomata" }] } }],
    lessonPlan: { beats: [{ title: "Every other section" }] },
    suggestedLecturePlan: { beats: [{ title: "Every other section" }] },
  };
  const strict = compactSuprnotesForPrompt(document, { scope: "beat", strict: true });
  assert.doesNotMatch(strict, /Every other section|use_provided_images_only|strict_provided_content_only|green leaf|stomata|bbox/);
  assert.match(strict, /"role":"figure-labels"/);
  assert.match(strict, /illustration from page 1/);
  const reference = compactSuprnotesForPrompt(document, { scope: "beat" });
  assert.match(reference, /NOT source text/, "reference mode labels the vision model's account for what it is");
  assert.match(reference, /stomata/);
  const whole = compactSuprnotesForPrompt(document);
  assert.equal(whole.match(/Every other section/g)?.length, 1, "the whole-document plan is sent once, not twice");
  assert.match(whole, /green leaf/, "the document scope is otherwise unchanged");
});
