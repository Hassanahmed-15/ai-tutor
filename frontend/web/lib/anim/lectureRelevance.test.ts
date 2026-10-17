import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SUBJECTS, subjectForTopic } from "../education";
import { profileAudience } from "../lessonIntent";
import { checklistFitsTopic } from "../webSources";
import { checkDiagram, numberedNouns } from "../diagrams/check";
import { compileDiagram } from "../diagrams/render";
import type { DiagramSpec } from "../diagrams/spec";

/* "4 Operations in AES" (2026-10-17): six boards of IGCSE arithmetic, and "14 rounds" missing. */

const AES = "4 Operations in AES explain me 4 operations in AES like in detail there mathematical valuation as well";
const all = SUBJECTS.map((s) => ({ id: s.id, label: s.label }));

test("an AES request is Computer Science: 'mathematical' is not the subject Mathematics", () => {
  const mine = [{ id: "programming", label: "Programming" }, { id: "computer-science", label: "Computer Science" }];
  assert.equal(subjectForTopic(AES, mine)?.label, "Computer Science");
  assert.equal(subjectForTopic(AES, all)?.label, "Computer Science");
  assert.equal(subjectForTopic("Maths: simultaneous equations", all)?.label, "Mathematics", "the name still counts as a word");
  assert.equal(subjectForTopic("electricity and magnetism", all)?.label, "Physics", "keywords still match a word's start");
});

test("a syllabus only for a subject they study", () => {
  const card = { level: "IGCSE", levelId: "igcse", topicSubject: "Mathematics", inSubject: null, subjects: ["Programming", "Computer Science"] };
  assert.equal(profileAudience(card)?.curriculum ?? null, null, "no IGCSE Mathematics syllabus for a CS student's AES lecture");
  assert.match(profileAudience({ ...card, topicSubject: "Computer Science", inSubject: "Computer Science" })?.curriculum ?? "", /Computer Science/);
  assert.match(profileAudience({ ...card, subjects: [] })?.curriculum ?? "", /Mathematics/, "a student who listed no subjects keeps the guess");
});

test("a syllabus section must be about the topic", () => {
  const maths = ["Use the four operations for calculations with integers, fractions and decimals", "Understand the order of operations, including brackets", "Use and interpret positive, negative and zero indices", "Use the rules of indices", "Use the standard form A × 10^n", "Convert numbers into and out of standard form", "Calculate with values in standard form"];
  const aes = ["Describe the AES SubBytes step using the S-box", "Explain ShiftRows in AES", "Explain MixColumns in AES over GF(2^8)", "Explain AddRoundKey", "State the number of AES rounds for each key length"];
  assert.equal(checklistFitsTopic(maths, "4 Operations in AES"), false);
  assert.equal(checklistFitsTopic(aes, "4 Operations in AES"), true);
  assert.equal(checklistFitsTopic(maths, "Basic operations"), true, "a topic with no distinctive word cannot be judged");
});

const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), "lib", "anim", "fixtures-aes-keylengths.json"), "utf8")) as { narration: string; spec: DiagramSpec };

test("the board that lost '14 rounds' is sent back with the box and the number named", () => {
  assert.deepEqual(numberedNouns("AES uses 128-bit, 192-bit, or 256-bit keys, giving 10, 12, or 14 rounds respectively.").filter((x) => x.noun === "round").map((x) => x.n), [10, 12, 14]);
  const checked = checkDiagram(fixture.spec, fixture.narration);
  assert.ok(checked.factIssues.some((i) => /box "round-14"/.test(i)), checked.factIssues.join(" | "));
  assert.ok(checked.factIssues.some((i) => /14 round/.test(i)), checked.factIssues.join(" | "));
});

test("box names are not cut by the label cap, and are written inside their boxes", () => {
  const spec = structuredClone(fixture.spec);
  spec.elements.push({ t: "label", id: "label-14", s: 2, text: "14 rounds", at: { id: "round-14" }, leader: true } as DiagramSpec["elements"][number]);
  const checked = checkDiagram(spec, fixture.narration);
  assert.ok(checked.spec.elements.some((e) => e.id === "label-14"), "the ninth label is kept");
  assert.ok(!checked.factIssues.some((i) => /round-14|14 round/.test(i)), checked.factIssues.join(" | "));
  const drawing = compileDiagram(checked.spec);
  const text = drawing.shapes.filter((s) => s.t === "text") as Array<{ text: string; x: number; y: number }>;
  const fourteen = text.find((t) => t.text === "14 rounds");
  assert.ok(fourteen && fourteen.x > 375 && fourteen.x < 580 && fourteen.y > 255 && fourteen.y < 310, `written inside its box: ${JSON.stringify(fourteen)}`);
  assert.ok(drawing.parts.find((p) => p.id === "label-14")?.inline, "a pen target, not a margin label");
  assert.ok(!drawing.parts.some((p) => p.name === "Diagram"), "no placeholder label");
});

test("a label may name a box listed after it", () => {
  const spec = { v: 1, w: 400, h: 200, base: "none", elements: [
    { t: "label", id: "l", s: 0, text: "Cipher key", at: { id: "box" }, leader: true },
    { t: "region", id: "box", s: 0, shape: "rect", x: 100, y: 60, w: 160, h: 60, fill: "#e2e8f0" },
  ] } as unknown as DiagramSpec;
  const drawing = compileDiagram(spec);
  assert.ok(drawing.shapes.some((s) => s.t === "text" && s.text === "Cipher key"));
  assert.equal(drawing.shapes[0].t, "path", "the filled box is drawn before its words");
});
