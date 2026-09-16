/**
 * How large a document the standalone viewer accepts.
 *
 * The one rule worth pinning is that this ceiling is genuinely separate from
 * lib/documentLimits.ts's 20-page lesson-generation limit — the viewer has no model call to fit a
 * document into, so it should tolerate documents an order of magnitude larger. A regression that
 * accidentally imported the lesson limit here would silently refuse a 30-page PDF a student just
 * wants to read, with no model involved at all.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  VIEWER_DOCUMENT_LIMITS,
  viewerDocumentTooLarge,
  viewerDocumentTooManyPages,
  viewerTooLargeMessage,
  viewerTooManyPagesMessage,
} from "../viewerDocumentLimits";

test("the viewer's page ceiling is well above the lesson-generation limit", () => {
  // Not a specific number — just that this is genuinely a different, larger world than the
  // 20-page lesson limit, which is the whole reason this file exists separately.
  assert.ok(VIEWER_DOCUMENT_LIMITS.MAX_PAGES > 100);
});

test("a document within both limits is accepted", () => {
  assert.equal(viewerDocumentTooLarge(10 * 1024 * 1024), false);
  assert.equal(viewerDocumentTooManyPages(50), false);
});

test("a document over either limit is refused", () => {
  assert.equal(viewerDocumentTooLarge(VIEWER_DOCUMENT_LIMITS.MAX_BYTES + 1), true);
  assert.equal(viewerDocumentTooManyPages(VIEWER_DOCUMENT_LIMITS.MAX_PAGES + 1), true);
});

test("the boundary itself is accepted, not refused", () => {
  // An off-by-one here would reject a document exactly at the stated ceiling, which is the one
  // case the limit message explicitly promises works ("up to N pages").
  assert.equal(viewerDocumentTooLarge(VIEWER_DOCUMENT_LIMITS.MAX_BYTES), false);
  assert.equal(viewerDocumentTooManyPages(VIEWER_DOCUMENT_LIMITS.MAX_PAGES), false);
});

test("a non-finite page count is never treated as over the limit", () => {
  // NaN/Infinity should fail closed elsewhere (the caller already refused a non-numeric count
  // upstream), not be silently waved through by a comparison that is vacuously false either way.
  assert.equal(viewerDocumentTooManyPages(NaN), false);
});

test("the error messages state the actual numbers, not just 'too large'", () => {
  const bytesMsg = viewerTooLargeMessage(150 * 1024 * 1024);
  assert.match(bytesMsg, /150\.0 MB/);
  assert.match(bytesMsg, new RegExp(String(VIEWER_DOCUMENT_LIMITS.MAX_BYTES / (1024 * 1024))));

  const pagesMsg = viewerTooManyPagesMessage(999);
  assert.match(pagesMsg, /999/);
  assert.match(pagesMsg, new RegExp(String(VIEWER_DOCUMENT_LIMITS.MAX_PAGES)));
});
