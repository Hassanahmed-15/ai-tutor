import test from "node:test";
import assert from "node:assert/strict";
import { packFromResearch, researchKey, sanitizeSourcePack, siteName, sourcesForText, uncoveredChecklist, type SourcePack } from "../webSources";
import { MAX_INTENT_ROUNDS, briefLine, curriculumInText, sanitizeIntent } from "../lessonIntent";

/* Lessons planned from web research, with sources per slide (lib/webSources.ts, lib/lessonIntent.ts), 2026-10-14. */

const pack: SourcePack = {
  query: "transport in animals",
  curriculum: "Cambridge IGCSE Biology 0610",
  checklist: ["double circulation", "pulmonary artery", "vena cava", "aorta", "atria and ventricles", "single circulation in fish"],
  points: [
    { text: "Mammals have a double circulation: blood passes through the heart twice for each circuit of the body.", sources: ["S1"] },
    { text: "The right ventricle pumps deoxygenated blood through the pulmonary artery to the lungs.", sources: ["S2"] },
    { text: "The vena cava returns deoxygenated blood from the body to the right atrium.", sources: ["S2", "S3"] },
    { text: "Fish have a single circulation with a two-chambered heart.", sources: ["S1"] },
  ],
  sources: [
    { id: "S1", title: "Double circulatory system", url: "https://en.wikipedia.org/wiki/Double_circulatory_system", site: "Wikipedia" },
    { id: "S2", title: "Circulatory systems", url: "https://www.savemyexams.com/igcse/biology/circulation/", site: "Save My Exams" },
    { id: "S3", title: "The heart", url: "https://www.bbc.co.uk/bitesize/guides/heart", site: "BBC Bitesize" },
  ],
};

test("a pack keeps only real links, ids that resolve and no duplicates", () => {
  const clean = sanitizeSourcePack({
    ...pack,
    sources: [...pack.sources, { id: "S4", url: "javascript:alert(1)", title: "x" }, { id: "S5", url: pack.sources[0].url, title: "dup" }],
    points: [...pack.points, { text: pack.points[0].text, sources: ["S1"] }, { text: "A claim with a made-up source", sources: ["S9"] }],
  });
  assert.ok(clean);
  assert.equal(clean.sources.length, 3, "the script link and the duplicate URL are dropped");
  assert.equal(clean.points.length, 5, "the repeated point is dropped");
  assert.deepEqual(clean.points[4].sources, [], "an id that resolves to no page is dropped");
  assert.equal(sanitizeSourcePack({ sources: [], points: pack.points }), null, "no pages, no pack");
  assert.equal(sanitizeSourcePack(null), null);
});

test("site names are friendly for the sites lessons cite most, the host otherwise", () => {
  assert.equal(siteName("https://en.wikipedia.org/wiki/Heart"), "Wikipedia");
  assert.equal(siteName("https://www.bbc.co.uk/bitesize/x"), "BBC Bitesize");
  assert.equal(siteName("https://www.cambridgeinternational.org/x.pdf"), "Cambridge International");
  assert.equal(siteName("https://example.edu/heart"), "example.edu");
});

test("each slide cites the pages behind what it actually says", () => {
  const vessels = sourcesForText(pack, "The vena cava brings blood back to the right atrium, and the pulmonary artery takes it to the lungs.");
  assert.deepEqual(vessels.map((s) => s.id), ["S2", "S3"], "the vessel points' pages, most-matched first");
  const fish = sourcesForText(pack, "In fish, single circulation: a two-chambered heart pumps blood once around the body.");
  assert.equal(fish[0].id, "S1");
  const opener = sourcesForText(pack, "Why does your body need a delivery system at all?");
  assert.ok(opener.length >= 1 && opener.length <= 2, "a slide matching no point still shows where the lesson's material came from");
  assert.ok(sourcesForText(pack, "x".repeat(10), 3).length <= 3);
});

test("the outline is checked against the syllabus checklist", () => {
  const outline = "The Heart's Chambers: atria and ventricles. Blood Vessels: the aorta and the pulmonary artery. Double Circulation in mammals.";
  assert.deepEqual(uncoveredChecklist(pack.checklist, outline), ["vena cava", "single circulation in fish"]);
  assert.deepEqual(uncoveredChecklist(pack.checklist, `${outline} Vena cava returns blood. Fish have a single circulation.`), []);
});

test("research JSON keeps only the URLs the search itself cited", () => {
  const cited = [
    { url: "https://en.wikipedia.org/wiki/Double_circulatory_system?utm_source=openai", title: "Double circulatory system - Wikipedia" },
    { url: "https://www.savemyexams.com/igcse/biology/circulation/", title: "Circulation | Save My Exams" },
  ];
  const json = {
    curriculum: "Cambridge IGCSE Biology 0610",
    checklist: ["double circulation"],
    points: [
      { text: "Blood passes through the heart twice per circuit.", urls: ["https://en.wikipedia.org/wiki/Double_circulatory_system"] },
      { text: "A fact from a page the search never cited.", urls: ["https://made-up.example/page"] },
    ],
  };
  const built = packFromResearch(json, cited, "q");
  assert.ok(built);
  assert.deepEqual(built.sources.map((s) => s.site), ["Wikipedia", "Save My Exams"], "the cited pages, including one no point named");
  assert.ok(!built.sources.some((s) => s.url.includes("utm_")), "tracking parameters are removed");
  assert.deepEqual(built.points[0].sources, ["S1"]);
  assert.deepEqual(built.points[1].sources, [], "an uncited URL is never shown as a source");
  assert.equal(packFromResearch(null, cited, "q"), null);
});

test("the same topic for the same curriculum, goal and part is researched once", () => {
  assert.equal(researchKey("Transport in Animals", { curriculum: "Cambridge IGCSE", goal: "exam" }), researchKey("transport in animals ", { curriculum: "cambridge igcse", goal: "exam" }));
  assert.notEqual(researchKey("Transport in Animals", { curriculum: "Cambridge IGCSE" }), researchKey("Transport in Animals", { curriculum: "A Level" }));
  assert.ok(!/[/\\?#]/.test(researchKey("a/b?c#d", { scope: "x\\y" })), "a key is a valid Cosmos id");
});

test("intent: one question at a time, and never past the round limit", () => {
  const asking = sanitizeIntent({ brief: { curriculum: "Cambridge IGCSE Biology", goal: null }, complete: false, question: { question: "Is this for your IGCSE exam, the whole topic?", options: ["Yes, the whole topic", "Just the heart", "Yes, the whole topic"] } }, 0);
  assert.equal(asking.complete, false);
  assert.deepEqual(asking.question?.options, ["Yes, the whole topic", "Just the heart"], "duplicate chips dropped");
  assert.deepEqual(asking.brief, { curriculum: "Cambridge IGCSE Biology" });
  const capped = sanitizeIntent({ brief: { goal: "exam" }, complete: false, question: { question: "One more?", options: [] } }, MAX_INTENT_ROUNDS);
  assert.equal(capped.complete, true, "after the limit the brief is complete with what is known");
  assert.equal(capped.question, null);
  assert.equal(sanitizeIntent({ complete: false, question: { question: "", options: [] } }, 0).complete, true, "an empty question is no question");
  assert.deepEqual(sanitizeIntent({ brief: { goal: "exam", curriculum: "null", scope: "unknown" }, complete: true }, 1).brief, { goal: "exam" });
  // Measured 2026-10-14: the model asked "why is the left ventricle wall thicker?" which exam it was for.
  const direct = sanitizeIntent({ brief: {}, complete: false, question: { question: "Is this for your exam?", options: ["Yes"] } }, 0, true);
  assert.equal(direct.complete, true, "a specific question is never asked what it is for");
  assert.equal(direct.brief.goal, "question");
  // A model that fills every slot and asks anyway is not allowed to ask.
  const settled = sanitizeIntent({ brief: { goal: "understand", curriculum: "university", scope: "the whole topic" }, complete: false, question: { question: "For a course?", options: [] } }, 0);
  assert.equal(settled.complete, true);
});

test("a curriculum named in the request is read from it", () => {
  assert.equal(curriculumInText("explain transport in animals igcse biology"), "Cambridge IGCSE");
  assert.equal(curriculumInText("o level physics waves"), "O Level");
  assert.equal(curriculumInText("A-level chemistry moles"), "A Level");
  assert.equal(curriculumInText("explain transformers in AI"), null);
  assert.equal(briefLine(null), "");
  assert.match(briefLine({ goal: "exam", curriculum: "Cambridge IGCSE Biology", scope: "the whole topic" }), /syllabus topic.*Cambridge IGCSE Biology.*the whole topic/);
});
