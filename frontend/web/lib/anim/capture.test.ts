import test from "node:test";
import assert from "node:assert/strict";
import { assembleCapturedPages, pageId, pageLabels, type CapturedPage } from "../capture/assemble";
import { hashToken, imageKind, isExpired, photoProblem, slotsInOrder, tokenMatches, validSlot, type SlotRecord } from "../capture/rules";
import type { SuprnotesLessonInput } from "../suprnotes";

/*
 * THE PHONE CAPTURE (2026-11-25): photos are read one at a time as one-page PDFs, then assembled into ONE document
 * with pages 1..N in the student's order; the phone's secret is checked without leaking timing.
 */

const onePage = (heading: string, words: string, figure = false): CapturedPage => ({
  sourceDocument: {
    schemaVersion: "suprnotes.lesson_input.v1",
    lesson: { title: heading },
    source: { adapter: "pdf-upload", fileName: "photo-1.pdf" },
    contentBlocks: [
      { id: "ocr-p1-0-0", type: "paragraph", heading, text: `${words} first paragraph.`, pageNumber: 1, sourceOrder: 0, role: "paragraph", ...(figure ? { assetIds: ["p1-figure-1"] } : {}) },
      { id: "ocr-p1-0-1", type: "paragraph", heading, text: `${words} second paragraph.`, pageNumber: 1, sourceOrder: 1, role: "paragraph" },
    ],
    assets: figure ? [{ id: "p1-figure-1", pageNumber: 1, caption: "Figure 1", url: "data:image/png;base64,iVBORw0KGgo=", sourceBlockIds: ["ocr-p1-0-0"] }] : [],
  } as SuprnotesLessonInput,
  title: heading,
  fullDocumentText: `[page 1] ${words}`,
  ocrTranscript: `--- page 1 ---\n${words}`,
  costUsd: 0.002,
});

test("each photo's 'page 1' becomes its own page, with every id and reference renumbered", () => {
  assert.equal(pageId("ocr-p1-0-3", 4), "ocr-p4-0-3");
  assert.equal(pageId("p1-figure-2", 2), "p2-figure-2");
  assert.equal(pageId("p1-b7", 3), "p3-b7");
  assert.equal(pageId("weird-id", 5), "pg5-weird-id");
  const out = assembleCapturedPages([onePage("How sound travels", "Waves"), onePage("The ear", "Eardrum", true)]);
  const doc = out.sourceDocument;
  const ids = (doc.contentBlocks ?? []).map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "no two blocks share an id");
  assert.deepEqual((doc.contentBlocks ?? []).map((b) => b.pageNumber), [1, 1, 2, 2]);
  assert.equal(doc.assets?.[0].id, "p2-figure-1");
  assert.equal(doc.assets?.[0].pageNumber, 2);
  assert.deepEqual(doc.assets?.[0].sourceBlockIds, ["ocr-p2-0-0"], "a figure still points at its own paragraph");
  assert.deepEqual(doc.contentBlocks?.[2].assetIds, ["p2-figure-1"]);
  assert.equal(out.pageCount, 2);
  assert.deepEqual(out.pagesUsed, [1, 2]);
  assert.equal(out.title, "How sound travels");
  assert.match(out.fullDocumentText, /\[page 2\] Eardrum/);
  assert.match(out.ocrTranscript, /--- page 2 ---\nEardrum/);
  assert.ok(Math.abs(out.costUsd - 0.004) < 1e-9);
  assert.equal((doc.source as { adapter?: string }).adapter, "phone-capture");
  assert.ok(doc.lessonPlan, "the lesson plan is built again over the whole");
  assert.equal(pageLabels("[page 1 formulas, as printed] x", 3), "[page 3 formulas, as printed] x");
});

test("the phone's secret: matched exactly, in constant time; codes expire; only real photos", () => {
  const hash = hashToken("AbCdEfGhIjKlMnOpQrStUv");
  assert.equal(tokenMatches("AbCdEfGhIjKlMnOpQrStUv", hash), true);
  assert.equal(tokenMatches("AbCdEfGhIjKlMnOpQrStUw", hash), false);
  assert.equal(tokenMatches(null, hash), false);
  assert.equal(tokenMatches("short", hash), false);
  assert.equal(isExpired({ expiresAt: 1000 }, 2000), true);
  assert.equal(isExpired({ expiresAt: 3000 }, 2000), false);
  assert.equal(validSlot(1) && validSlot(6), true);
  assert.equal(validSlot(0) || validSlot(7) || validSlot(1.5), false);
  assert.equal(imageKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "jpeg");
  assert.equal(imageKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "png");
  assert.equal(imageKind(new Uint8Array([0x25, 0x50, 0x44, 0x46])), null, "a PDF is not a photo");
});

test("a bad shot is named, and the student's page order is kept", () => {
  assert.equal(photoProblem({ sharpness: 900, brightness: 160, pageFound: true }), null);
  assert.equal(photoProblem({ sharpness: 900, brightness: 30, pageFound: true }), "dark");
  assert.equal(photoProblem({ sharpness: 20, brightness: 160, pageFound: true }), "blurry");
  assert.equal(photoProblem({ sharpness: 80, brightness: 160, pageFound: false }), "no-page");
  const slot = (n: number, state: SlotRecord["state"] = "ready"): SlotRecord => ({ n, version: 1, state, startedAt: 0 });
  assert.deepEqual(slotsInOrder([slot(1), slot(2), slot(3, "deleted"), slot(4)], [4, 1]).map((s) => s.n), [4, 1, 2]);
});
