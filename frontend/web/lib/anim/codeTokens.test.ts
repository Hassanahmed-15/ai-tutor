import { test } from "node:test";
import assert from "node:assert/strict";
import { codeTokens, commentMarker } from "../canvas/codeTokens";

const comments = (line: string, marker: ReturnType<typeof commentMarker>) => codeTokens(line, marker).filter((t) => t.italic).map((t) => t.text);
const text = (line: string, marker: ReturnType<typeof commentMarker>) => codeTokens(line, marker).map((t) => t.text).join("");

test("Python's // is floor division, not a comment (QA report 2026-11-27)", () => {
  const code = ["def binary_search(a, target):", "    mid = (low + high) // 2  # the middle index", "    return mid"];
  const marker = commentMarker(code);
  assert.equal(marker, "hash");
  assert.deepEqual(comments(code[1], marker), ["# the middle index"]);
  assert.equal(text(code[1], marker), code[1]);
});

test("a C-style listing keeps // as its comment, and a # line is shown whole", () => {
  const code = ["int half(int a) {", "  return a / 2; // half of a", "}"];
  const marker = commentMarker(code);
  assert.equal(marker, "slash");
  assert.deepEqual(comments(code[1], marker), ["// half of a"]);
  assert.equal(text("#include <stdio.h>", marker), "#include <stdio.h>");
});

test("a listing with no clue keeps both markers, as before", () => {
  assert.equal(commentMarker(["x = 1", "y = 2"]), "both");
});
