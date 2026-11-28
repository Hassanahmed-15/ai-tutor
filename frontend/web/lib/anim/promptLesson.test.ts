import test from "node:test";
import assert from "node:assert/strict";
import { evidenceFromSyllabus, outcomesFromOutline, promptCourseLabel, promptLessonRequest } from "../curriculum/promptLesson";

/* A typed prompt taught as a course lesson (owner 2026-11-28): the approved outline becomes the course outcomes. */

test("the outline's parts become course outcomes, known parts recapped, at most 8, no repeats", () => {
  const o = outcomesFromOutline([
    { title: "Xylem", caption: "carries water up the plant" },
    { title: "xylem", caption: "again" },
    { title: "Phloem", caption: "Phloem", status: "known" },
    ...Array.from({ length: 10 }, (_, i) => ({ title: `Part ${i}` })),
  ], "Transport in plants");
  assert.equal(o.length, 8);
  assert.equal(o[0].text, "Xylem: carries water up the plant");
  assert.equal(o[1].text, "Phloem (the student already knows this: recap it briefly)");
  assert.ok(o.every((x) => x.code === null));
  assert.deepEqual(outcomesFromOutline([], "Binary search", "how does binary search work"), [{ code: null, text: "how does binary search work" }]);
});

test("the lesson document's address and course label never pose as a real course", () => {
  assert.deepEqual(promptLessonRequest("Sets & Venn diagrams!", "IGCSE"), { courseId: "typed-prompt", version: "", grade: "IGCSE", unitId: "", topicId: "", lessonId: "sets-venn-diagrams" });
  assert.equal(promptCourseLabel("Cambridge IGCSE (0610)", "Biology"), "Cambridge IGCSE Biology");
  assert.equal(promptCourseLabel("Cambridge IGCSE Biology", "Biology"), "Cambridge IGCSE Biology");
  assert.equal(promptCourseLabel(undefined, "Computer Science"), "Computer Science");
  assert.equal(promptCourseLabel("General", ""), "General");
  assert.deepEqual(evidenceFromSyllabus(""), []);
  assert.equal(evidenceFromSyllabus("x".repeat(9000))[0].text.length, 6000);
});
