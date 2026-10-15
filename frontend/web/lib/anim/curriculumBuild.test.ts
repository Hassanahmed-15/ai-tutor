import test from "node:test";
import assert from "node:assert/strict";
import { assembleTree, buildTree, codesInText, mergeRows, normalizeCode } from "../curriculum/build";
import type { ExtractedRow, RegistryEntry } from "../curriculum/types";

const row = (r: Partial<ExtractedRow>): ExtractedRow => ({ grade: "9", unit: "Forces", topic: "Speed", subtopic: "Average speed", code: null, outcome: "Define speed.", ...r });

test("codes are found in page order, once each, with the pages they sit on", () => {
  const pages = ["P-09-A-01 define speed. P-09-A-02", "page 2 again P–09–A–01 (en dash) and P-09-A-03", "12 34 2026"];
  const found = codesInText(pages, "\\b[A-Z]-\\d{2}-[A-Z]-\\d{2}\\b");
  assert.deepEqual([...found.keys()], ["P-09-A-01", "P-09-A-02", "P-09-A-03"]);
  assert.deepEqual(found.get("P-09-A-01"), [0, 1], "the en-dash spelling counts as the same code");
  assert.equal(normalizeCode(" SPQ‑1.A "), "SPQ-1.A");
});

test("one row per code; a code the source does not contain is dropped as invented", () => {
  const expected = new Set(["P-09-A-01", "P-09-A-02"]);
  const { rows, invented } = mergeRows(
    [row({ code: "P-09-A-01" }), row({ code: "P-09-A-01", outcome: "dup from the next chunk" }), row({ code: "P-09-Z-99" }), row({ code: "P-09-A-02" })],
    expected,
  );
  assert.deepEqual(rows.map((r) => r.code), ["P-09-A-01", "P-09-A-02"]);
  assert.deepEqual(invented, ["P-09-Z-99"]);
  // Without codes, identical wording in the same place is one outcome; a missing subtopic takes the topic's name.
  const plain = mergeRows([row({ outcome: "Explain inertia." }), row({ outcome: "explain  inertia." }), row({ subtopic: "", outcome: "Use F=ma." })]);
  assert.equal(plain.rows.length, 2);
  assert.equal(plain.rows[1].subtopic, "Speed");
});

test("headings that reappear after a page break join their first occurrence, and grades follow the registry order", () => {
  const grades = buildTree(
    [
      row({ grade: "10", unit: "Waves", topic: "Sound", subtopic: "Echoes", outcome: "a" }),
      row({ grade: "9", unit: "Unit 1: Forces", topic: "Speed", outcome: "b" }),
      row({ grade: "9", unit: "UNIT 1 – forces", topic: "speed", outcome: "c" }),
      row({ grade: "9", unit: "Unit 1: Forces", topic: "Speed", subtopic: "Average speed", outcome: "d" }),
    ],
    ["9", "10"],
  );
  assert.deepEqual(grades.map((g) => g.grade), ["9", "10"]);
  assert.equal(grades[0].units.length, 1, "case and punctuation differences are one unit");
  assert.equal(grades[0].units[0].topics[0].subtopics[0].outcomes.length, 3);
  assert.equal(grades[0].units[0].id, "unit-1-forces");
});

test("the report says exactly what is missing", () => {
  const entry = {
    id: "t", region: "PK", framework: "F", board: null, qualification: null, subject: "Physics", grades: ["9", "10"], gradeSystem: "grade",
    syllabusCode: null, sourceKind: "pdf", sourceUrls: ["u"], localFiles: [], publisher: "p", licence: "l", codePattern: "x", sampleCodes: [],
  } satisfies RegistryEntry;
  const tree = assembleTree(entry, [row({ code: "A" }), row({ code: "B" })], { expected: ["A", "B", "C", "D"], model: "m", usd: 0.012345, builtAt: "now" });
  assert.equal(tree.build.coverage, 0.5);
  assert.deepEqual(tree.build.missingCodes, ["C", "D"]);
  assert.equal(tree.build.usd, 0.0123);
  assert.ok(tree.build.warnings.includes("grade 10 has no content"));
});

test("rows read in separate pieces snap to one outline, by name or by their topic", async () => {
  const { snapToOutline } = await import("../curriculum/build");
  const outline = {
    units: [
      { grade: "9", title: "Domain B: Mechanics", topics: ["Kinematics", "Dynamics"] },
      { grade: "11", title: "Domain B: Mechanics", topics: ["Translatory motion"] },
    ],
  };
  const { rows, unmatched } = snapToOutline(
    [
      row({ grade: "9", unit: "DOMAIN B – MECHANICS", topic: "kinematics" }),
      row({ grade: "9", unit: "2 Kinematics", topic: "Kinematics" }),
      row({ grade: "11", unit: "Mechanics", topic: "Translatory Motion" }),
      row({ grade: "9", unit: "Cooking", topic: "Bread" }),
    ],
    outline,
  );
  assert.deepEqual(rows.slice(0, 3).map((r) => `${r.grade}|${r.unit}|${r.topic}`), [
    "9|Domain B: Mechanics|Kinematics",
    "9|Domain B: Mechanics|Kinematics",
    "11|Domain B: Mechanics|Translatory motion",
  ]);
  assert.equal(unmatched, 1);
});

test("lesson groups are accepted only when every outcome is used exactly once", async () => {
  const { applyLessonGroups } = await import("../curriculum/build");
  const rows = [row({ outcome: "a" }), row({ outcome: "b" }), row({ outcome: "c" })];
  const ok = applyLessonGroups(rows, [{ title: "Speed", items: [0, 1] }, { title: "Velocity", items: [2] }]);
  assert.deepEqual(ok?.map((r) => r.subtopic), ["Speed", "Speed", "Velocity"]);
  assert.equal(applyLessonGroups(rows, [{ title: "Speed", items: [0, 1] }]), null, "an outcome left out");
  assert.equal(applyLessonGroups(rows, [{ title: "Speed", items: [0, 1, 1, 2] }]), null, "an outcome twice");
  assert.equal(applyLessonGroups(rows, [{ title: "", items: [0, 1, 2] }]), null, "a lesson without a name");
});

test("heading candidates keep headings and drop prose", async () => {
  const { headingCandidates } = await import("../curriculum/build");
  const text = headingCandidates(["Domain B: Mechanics\nStudents will learn about the motion of bodies in detail here.\nKinematics:          Translatory motion:\n12"]);
  assert.ok(text.includes("Domain B: Mechanics"));
  assert.ok(text.includes("Translatory motion:"), "each column of a two-column page is a candidate");
  assert.ok(!text.includes("Students will learn"));
});

test("the code decides the grade when the registry says how to read it", async () => {
  const { gradesFromCodes } = await import("../curriculum/build");
  const rows = [row({ grade: "9", code: "P-12-F-01" }), row({ grade: "9", code: "P-09-A-01" }), row({ grade: "11", code: "X-1" })];
  assert.equal(gradesFromCodes(rows, "^P-(\\d{2})", ["9", "10", "11", "12"]), 1);
  assert.deepEqual(rows.map((r) => r.grade), ["12", "9", "11"]);
  const cc = [row({ grade: "3", code: "K.CC.A.1" })];
  gradesFromCodes(cc, "^(K|\\d{1,2})\\.", ["K", "1", "2", "3"]);
  assert.equal(cc[0].grade, "K");
});

test("a heading map is applied only when it renames every place", async () => {
  const { distinctPlaces, renamePlaces } = await import("../curriculum/build");
  const rows = [row({ unit: "3 Dynamics", topic: "Weight" }), row({ unit: "Domain B: Mechanics", topic: "Kinematics" }), row({ unit: "3 Dynamics", topic: "Weight" })];
  const places = distinctPlaces(rows);
  assert.equal(places.length, 2);
  assert.equal(places[0].count, 2);
  const renamed = renamePlaces(rows, places, [{ i: 0, unit: "Domain B: Mechanics", topic: "Weight and Gravity" }, { i: 1, unit: "Domain B: Mechanics", topic: "Kinematics" }]);
  assert.deepEqual(renamed?.map((r) => r.unit), ["Domain B: Mechanics", "Domain B: Mechanics", "Domain B: Mechanics"]);
  assert.equal(renamePlaces(rows, places, [{ i: 0, unit: "U", topic: "T" }]), null);
});

test("printed codes with stray spaces or brackets are one code; the grade pattern is inferred from samples", async () => {
  const { inferGradeFromCode, normalizeCode } = await import("../curriculum/build");
  assert.equal(normalizeCode("M- 9-A- 01"), "M-9-A-01");
  assert.equal(normalizeCode("U-01-A-[02"), "U-01-A-02");
  assert.equal(inferGradeFromCode(["E-03-A1-01", "E-06-A1-01"], ["1", "2", "3", "4", "5", "6"]), "^[A-Z]{1,4}-(\\d{1,2})-");
  assert.equal(inferGradeFromCode(["K.CC.A.1", "3.NF.A.1"], ["K", "1", "2", "3"]), "^(K|\\d{1,2})\\.");
  assert.equal(inferGradeFromCode(["AC9M7N01", "AC9MFN01"], ["F", "7"]), "^AC9[A-Z]+?(F|10|\\d)[A-Z]");
  assert.equal(inferGradeFromCode(["7Bp.01", "8Cc.02"], ["7", "8", "9"]), "^(\\d{1,2})[A-Z][A-Za-z]{0,3}\\.");
  assert.equal(inferGradeFromCode(["1.1", "1.2"], ["11", "12"]), null, "section numbers are not grades");
});

test("a code wrapped over two lines in the source still counts as printed there", async () => {
  const { codeInSource, mergeRows } = await import("../curriculum/build");
  const printed = codeInSource(["… ECE-00-\nA1-01 Recognise shapes", "U-01-A-[02]"]);
  assert.ok(printed("ECE-00-A1-01"));
  assert.ok(printed("U-01-A-02"));
  assert.ok(!printed("ECE-00-A1-99"));
  const { rows, invented } = mergeRows([row({ code: "ECE-00-A1-01" }), row({ code: "ECE-00-A1-99" })], printed);
  assert.deepEqual(rows.map((r) => r.code), ["ECE-00-A1-01"]);
  assert.deepEqual(invented, ["ECE-00-A1-99"]);
});

test("a section number counts as covered when its numbered statements are in the course", async () => {
  const { assembleTree } = await import("../curriculum/build");
  const entry = {
    id: "s", region: "INTL", framework: "F", board: "Cambridge", qualification: "O Level", subject: "Sociology", grades: ["O Level"], gradeSystem: "course",
    syllabusCode: "2251", sourceKind: "pdf", sourceUrls: ["u"], localFiles: [], publisher: "p", licence: "l", codePattern: "x", sampleCodes: [],
  } satisfies RegistryEntry;
  const tree = assembleTree(entry, [row({ grade: "O Level", code: "1.1.1" }), row({ grade: "O Level", code: "1.1.2" })], { expected: ["1.1", "1.1.1", "1.1.2", "1.2"], model: "m", usd: 0, builtAt: "now" });
  assert.deepEqual(tree.build.missingCodes, ["1.2"], "1.1 is covered by its statements; 1.2 has none");
  assert.equal(tree.build.coverage, 0.75);
});
