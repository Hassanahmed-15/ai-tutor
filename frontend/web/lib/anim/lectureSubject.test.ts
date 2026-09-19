import test from "node:test";
import assert from "node:assert/strict";

import { lectureSubject, type LectureSubjectInput } from "../lectureSubject";

/** The common case: a student drags a box and types nothing. */
const CROP: LectureSubjectInput = {
  transcriptSubject: "",
  pointing: true,
  drewRegion: true,
  focus: "",
  topic: "",
  input: "",
  documentTitle: "Attention Is All You Need",
};

test("a crop names the document it came from instead of 'Selected region'", () => {
  // The regression: this returned a bare "Selected region", so every crop-built lecture in
  // Lecture History became the same anonymous card.
  assert.equal(lectureSubject(CROP), "Attention Is All You Need — selected region");
});

test("a usable title from the crop's own text still wins", () => {
  assert.equal(
    lectureSubject({ ...CROP, transcriptSubject: "Scaled Dot-Product Attention" }),
    "Scaled Dot-Product Attention",
  );
});

test("what the student actually typed outranks any derived name", () => {
  assert.equal(
    lectureSubject({ ...CROP, pointing: false, focus: "why does this normalise by sqrt(d_k)?" }),
    "why does this normalise by sqrt(d_k)?",
  );
});

test("a crop from an untitled document falls back to the literal", () => {
  // The case the literal was actually written for — not the case it was firing on.
  assert.equal(lectureSubject({ ...CROP, documentTitle: "" }), "Selected region");
});

test("whole-page selection is named after the document, with no region suffix", () => {
  assert.equal(
    lectureSubject({ ...CROP, drewRegion: false }),
    "Attention Is All You Need",
  );
});

test("a transcript subject is ignored when the student typed a real request", () => {
  // `pointing` false means the typed text is the request; the crop's text is not a title candidate.
  assert.equal(
    lectureSubject({ ...CROP, pointing: false, transcriptSubject: "Table 3", focus: "compare these two" }),
    "compare these two",
  );
});

test("with nothing at all to go on, it still returns something sayable", () => {
  assert.equal(
    lectureSubject({ ...CROP, drewRegion: false, pointing: false, documentTitle: "" }),
    "this document",
  );
});
