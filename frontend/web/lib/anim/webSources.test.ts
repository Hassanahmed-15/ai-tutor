import test from "node:test";
import assert from "node:assert/strict";
import { dropOffLevelSources, groundPointsInFound, levelBandOf, packFromResearch, researchKey, sanitizeSourcePack, siteName, sourcesForText, uncoveredChecklist, type SourcePack } from "../webSources";
import { MAX_INTENT_ROUNDS, briefLine, curriculumInText, effectiveBrief, levelSearchTerms, profileAudience, sanitizeIntent } from "../lessonIntent";

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

/* ── The level from the profile's Study level (owner's direction, 2026-10-14) ───────────────────── */

const card = (over: Partial<Parameters<typeof levelSearchTerms>[0]> = {}) => ({
  level: "Intermediate (HSSC / FSc) / A-Level", subjectLevel: null, curricula: [], subjectCurricula: [], country: "Pakistan", topicSubject: "Biology", ...over,
});

test("Study level becomes the words searched: A Level, O Level, FSc, undergraduate", () => {
  assert.deepEqual(levelSearchTerms(card()), { level: "A Level", exam: "Cambridge International A Level" }, "Pakistan, no board set: Cambridge");
  assert.deepEqual(levelSearchTerms(card({ curricula: ["FSc / HSSC (Intermediate)"] })), { level: "FSc (HSSC, Pakistan)", exam: "FSc (HSSC) Pakistan" }, "the curriculum field says FSc");
  assert.equal(levelSearchTerms(card({ country: "United Kingdom", level: "A-Level / Sixth form (Years 12–13)", curricula: ["A-Level"] })).exam, "A Level", "UK A-Level, no Cambridge assumed");
  assert.deepEqual(levelSearchTerms(card({ level: "Matric (SSC) / O-Level" })), { level: "O Level", exam: "Cambridge O Level" });
  assert.equal(levelSearchTerms(card({ level: "Matric (SSC) / O-Level", curricula: ["Cambridge IGCSE"] })).exam, "Cambridge IGCSE");
  assert.deepEqual(levelSearchTerms(card({ level: "Undergraduate" })), { level: "undergraduate (university)", exam: null }, "no syllabus at university");
  assert.equal(levelSearchTerms(card({ level: "Undergraduate", subjectLevel: "Intermediate (HSSC / FSc) / A-Level" })).level, "A Level", "a subject's own level wins");
});

test("the profile's audience: a syllabus only for a school exam level and a school subject", () => {
  assert.deepEqual(profileAudience(card()), { curriculum: "Cambridge International A Level Biology", level: "A Level" });
  assert.deepEqual(profileAudience(card({ topicSubject: null })), { curriculum: null, level: "A Level" }, "transformers in AI: the level only");
  assert.deepEqual(profileAudience(card({ level: "Undergraduate" })), { curriculum: null, level: "undergraduate (university)" });
  assert.equal(profileAudience(null), null);
});

test("precedence: the course in the request, then the answers, then the profile", () => {
  const p = card();
  assert.equal(effectiveBrief(null, "explain cell biology", p)?.curriculum, "Cambridge International A Level Biology", "nothing typed: the profile");
  assert.equal(effectiveBrief({ goal: "exam", curriculum: "IB Diploma Biology" }, "cell biology", p)?.curriculum, "IB Diploma Biology", "an answer beats the profile");
  assert.equal(effectiveBrief(null, "cell biology igcse", p)?.curriculum, "Cambridge IGCSE", "a course typed in the request beats the profile");
  assert.equal(effectiveBrief(null, "cell biology a level", p)?.curriculum, "Cambridge International A Level Biology", "the request agreeing with the profile keeps the profile's detail");
  assert.equal(effectiveBrief(null, "cell biology", p)?.level, "A Level");
  assert.equal(effectiveBrief(null, "cell biology", null), null);
});

test("pages for another level are dropped, the syllabus and unlabelled pages are kept", () => {
  assert.equal(levelBandOf("Cambridge International A Level Biology"), "senior");
  assert.equal(levelBandOf("https://www.savemyexams.com/gcse/biology/cells/"), "secondary");
  assert.equal(levelBandOf("https://openstax.org/books/biology-2e/pages/4-1"), "university");
  assert.equal(levelBandOf("https://en.wikipedia.org/wiki/Cell_biology"), null);
  const p: SourcePack = {
    query: "q",
    checklist: [],
    points: [
      { text: "Cells have organelles.", sources: ["S1", "S2"] },
      { text: "A GCSE-only fact.", sources: ["S3"] },
      { text: "Mitochondria make ATP.", sources: ["S4"] },
    ],
    sources: [
      { id: "S1", title: "Cell biology", url: "https://en.wikipedia.org/wiki/Cell_biology", site: "Wikipedia" },
      { id: "S2", title: "Syllabus", url: "https://www.cambridgeinternational.org/Images/9700-syllabus.pdf", site: "Cambridge International" },
      { id: "S3", title: "Cells", url: "https://www.savemyexams.com/gcse/biology/cells/", site: "Save My Exams" },
      { id: "S4", title: "Cell structure", url: "https://www.savemyexams.com/a-level/biology/cie/cell-structure/", site: "Save My Exams" },
    ],
  };
  const { pack: kept, dropped } = dropOffLevelSources(p, "Cambridge International A Level Biology");
  assert.deepEqual(dropped.map((s) => s.id), ["S3"]);
  assert.deepEqual(kept.sources.map((s) => s.id), ["S1", "S2", "S4"]);
  assert.ok(!kept.points.some((pt) => pt.text.startsWith("A GCSE-only")), "a fact only the off-level page stated goes with it");
  assert.equal(dropOffLevelSources(p, null).dropped.length, 0, "no level, nothing dropped");
  const thin = { ...p, sources: [p.sources[2], p.sources[3]] };
  assert.equal(dropOffLevelSources(thin, "A Level").dropped.length, 0, "never below two sources");
});

test("links the model wrote itself become the real page the search saw on that site", () => {
  const found = [
    { url: "https://www.savemyexams.com/a-level/biology/cie/cell-structure/", title: "", cited: false },
    { url: "https://en.wikipedia.org/wiki/Cell_(biology)", title: "Cell (biology)", cited: false },
  ];
  const json = {
    audience: "Cambridge International A Level Biology",
    points: [
      { text: "Ribosomes are 80S in the cytoplasm.", urls: ["https://www.savemyexams.com/a-level/biology/made-up-path/"] },
      { text: "A fact from a site the search never saw.", urls: ["https://unknown.example/x"] },
    ],
  };
  const built = packFromResearch(json, found, "q");
  assert.ok(built);
  assert.equal(built.audience, "Cambridge International A Level Biology", "the audience survives");
  assert.deepEqual(built.sources.map((s) => s.url), ["https://www.savemyexams.com/a-level/biology/cie/cell-structure/"], "the real page on that site, never the made-up path or an unseen site");
  assert.deepEqual(built.points[1].sources, []);
  // Nothing matched at all: the facts are credited to the pages the search returned.
  const none = packFromResearch({ points: [{ text: "A fact.", urls: ["https://other.example/a"] }] }, found, "q");
  assert.ok(none && none.sources.length === 2 && none.points[0].sources.length === 2);
});

test("a fact linked from memory is credited to the page its own search read that matches it", () => {
  const pages = [
    { url: "https://marlbridge.com/resources/a-level-biology-9700-the-mitotic-cell-cycle-revision-notes/", title: "" },
    { url: "https://marlbridge.com/resources/a-level-biology-cell-structure-revision-notes/", title: "" },
  ];
  const json = { points: [
    { text: "The mitotic cell cycle has interphase, mitosis and cytokinesis.", urls: ["https://www.cambridgeinternational.org/syllabus.pdf"] },
    { text: "Ribosomes and the Golgi body are parts of cell structure.", urls: [] },
    { text: "Already linked to a page the search read.", urls: [pages[1].url] },
  ] };
  const grounded = groundPointsInFound(json, pages) as { points: Array<{ urls: string[] }> };
  assert.equal(grounded.points[0].urls[0], pages[0].url, "the cell-cycle page for the cell-cycle fact");
  assert.equal(grounded.points[1].urls[0], pages[1].url, "the cell-structure page for the structure fact");
  assert.deepEqual(grounded.points[2].urls, [pages[1].url], "a link the search saw is kept as it is");
  assert.equal(groundPointsInFound(json, []), json, "no pages read, nothing changed");
});
