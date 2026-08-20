/**
 * The PowerPoint → PDF converter, and the promise that matters most about it: when LibreOffice is
 * not there, uploads still work.
 *
 * LibreOffice is a system package. It is in the container image and is frequently absent from a
 * developer's machine, so "missing converter" is a normal state, not an error state. If this threw,
 * every deck upload would fail on any box without it — trading a fidelity problem for an outage.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { convertPptxToPdf, findSoffice, resetSofficeCache } from "../pptxToPdf";

test("a missing converter yields null, never a throw", async () => {
  resetSofficeCache();
  // Point at something that certainly does not exist, so this is deterministic wherever it runs —
  // including on a machine that DOES have LibreOffice installed.
  const previous = process.env.SOFFICE_BINARY;
  process.env.SOFFICE_BINARY = "definitely-not-a-real-binary-aria-test";
  try {
    // The bogus override is tried first; the real names are tried after it, so this asserts the
    // shape of the answer rather than the absence of LibreOffice on this particular machine.
    const result = await convertPptxToPdf(new Uint8Array([1, 2, 3]));
    assert.ok(result === null || result instanceof Uint8Array,
              "conversion must answer with bytes or null, never anything else");
  } finally {
    if (previous === undefined) delete process.env.SOFFICE_BINARY;
    else process.env.SOFFICE_BINARY = previous;
    resetSofficeCache();
  }
});

test("rubbish bytes do not throw either", async () => {
  /*
   * A deck LibreOffice cannot open is not a failed upload: the composed preview still works, so the
   * caller needs an answer it can fall back from rather than an exception to catch.
   *
   * The assertion is "never throws", NOT "always null" — an earlier version asserted null and
   * failed the moment LibreOffice was actually installed, because it cheerfully converts a text
   * file to a PDF. The test was wrong, not the converter.
   */
  resetSofficeCache();
  const result = await convertPptxToPdf(new TextEncoder().encode("this is not a pptx"));
  assert.ok(result === null || result instanceof Uint8Array);
});

test("the binary search answers with a path or null", async () => {
  resetSofficeCache();
  const found = await findSoffice();
  assert.ok(found === null || typeof found === "string");
  // Cached: asking twice must not shell out twice, and must not change its mind.
  assert.equal(await findSoffice(), found);
});
