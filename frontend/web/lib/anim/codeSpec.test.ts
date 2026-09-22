import test from "node:test";
import assert from "node:assert/strict";

import { looksLikeCode, parseCodeSpec, validateCodeSpec } from "../codeSpec";
import { selectAnimationRenderer } from "../animationRouting";

/**
 * The code board: a listing walked through with a moving highlight.
 *
 * Asked to "explain the remove function" from a BST PDF, the lecture drew an animated tree and never
 * showed the function. These pin the two things that decide whether a student ever sees code: that
 * a PDF's code is RECOGNISED (after extraction has collapsed its line breaks), and that a spec which
 * validates is one the board can actually draw.
 */

// Exactly as parse-pdf hands it over: every newline and indent collapsed to one space.
const BST_REMOVE_FROM_PDF =
  "void BST::remove(int d, Node*& p) { if(p==NULL) return; else if(d < p->data) remove(d, p->left); " +
  "else if(d > p->data) remove(d, p->right); else { if(p->left == NULL && p->right == NULL) { delete p; p = NULL; } " +
  "else if(p->left == NULL) { Node* t = p; p = p->right; delete t; } } }";

const LISTING = [
  "void remove(int d, Node*& p) {",
  "    if (p == NULL)",
  "        return;",
  "    else if (d < p->data)",
  "        remove(d, p->left);",
  "    else if (d > p->data)",
  "        remove(d, p->right);",
  "}",
].join("\n");

const good = {
  title: "remove()",
  language: "cpp",
  code: LISTING,
  fromSource: true,
  steps: [
    { lines: [2, 3], note: "An empty subtree means the value is not in the tree." },
    { lines: [4, 7], note: "Otherwise search left or right, like any BST lookup." },
  ],
};

test("a PDF's code is recognised even with its line breaks collapsed", () => {
  assert.equal(looksLikeCode(BST_REMOVE_FROM_PDF), true);
  assert.equal(looksLikeCode(LISTING), true);
  assert.equal(looksLikeCode("def insert(self, key):\n    if self.root is None:\n        self.root = Node(key)\n    else:\n        self._insert(self.root, key)"), true);
});

test("prose about code is not mistaken for code", () => {
  assert.equal(looksLikeCode(""), false);
  assert.equal(looksLikeCode(undefined), false);
  assert.equal(
    looksLikeCode(
      "A binary search tree keeps smaller keys to the left and larger keys to the right. To remove a node, " +
        "the function first searches for it; then it handles three cases: a leaf, a node with one child, and a node with two children.",
    ),
    false,
  );
  assert.equal(looksLikeCode("The 1857 War began in Meerut; it spread quickly (within weeks) to Delhi."), false);
});

test("a valid listing survives and keeps its provenance", () => {
  const spec = validateCodeSpec(good);
  assert.ok(spec);
  assert.equal(spec.language, "cpp");
  assert.equal(spec.fromSource, true);
  assert.equal(spec.steps.length, 2);
  assert.equal(spec.code.split("\n").length, 8);
});

test("language aliases are normalised, unknown languages are refused", () => {
  assert.equal(validateCodeSpec({ ...good, language: "C++" })?.language, "cpp");
  assert.equal(validateCodeSpec({ ...good, language: "py" })?.language, "python");
  assert.equal(validateCodeSpec({ ...good, language: "brainfuck" }), null);
});

test("a highlight outside the listing is refused, with a reason", () => {
  const { spec, rejected } = parseCodeSpec({
    ...good,
    steps: [good.steps[0], { lines: [7, 40], note: "Points at nothing." }],
  });
  assert.equal(spec, null, "one surviving step is a quote, not a walkthrough");
  assert.match(rejected[0].reason, /outside the 8-line listing/);
  assert.equal(validateCodeSpec({ ...good, steps: [{ lines: [0, 2], note: "zero-based" }, good.steps[1]] }), null);
  assert.equal(validateCodeSpec({ ...good, steps: [{ lines: [5, 3], note: "backwards" }, good.steps[1]] }), null);
});

test("empty and oversized listings are refused, never truncated", () => {
  assert.equal(validateCodeSpec({ ...good, code: "   " }), null);
  const long = Array.from({ length: 61 }, (_, i) => `x${i} = ${i};`).join("\n");
  const { spec, rejected } = parseCodeSpec({ ...good, code: long });
  assert.equal(spec, null);
  assert.match(rejected[0].reason, /61 lines/);
});

test("tabs and CRLF are normalised so line numbers match what the student sees", () => {
  const spec = validateCodeSpec({ ...good, code: "if (a)\r\n\treturn;\r\n\n" });
  assert.equal(spec, null, "two lines cannot hold a step on lines 4-7");
  const ok = validateCodeSpec({
    ...good,
    code: "if (a)\r\n\treturn;\r\n\n",
    steps: [{ lines: [1, 1], note: "test" }, { lines: [2, 2], note: "leave" }],
  });
  assert.equal(ok?.code, "if (a)\n    return;");
});

test("a filled code board is routed to the code renderer", () => {
  const selection = selectAnimationRenderer({
    caption: "remove()",
    durationMs: 30_000,
    ops: [{ kind: "codeBoard", codeBrief: "remove()", spec: validateCodeSpec(good) ?? undefined, at: 0, endAt: 1 }],
  });
  assert.equal(selection.renderer, "code");
  // An unfilled placeholder must not claim the board.
  const pending = selectAnimationRenderer({
    caption: "remove()",
    durationMs: 30_000,
    ops: [{ kind: "codeBoard", codeBrief: "remove()", at: 0, endAt: 1 }],
  });
  assert.notEqual(pending.renderer, "code");
});

test("a function the planner cut across beats is re-joined onto one board", async () => {
  const { mergeSplitCodeBeats, openBraces } = await import("../codeSpec");
  // The exact blocks parse-pdf produced for the BST notes' page 2, split 7 / 6 by the planner.
  const blocks: Record<string, string> = {
    b1: "remove first searches for the node holding d, then handles three cases.",
    b2: "void BST::remove(int d, Node*& p) {",
    b3: "if (p == NULL)",
    b4: "return; else if (d < p->data) remove(d, p->left); else if (d > p->data) remove(d, p->right); else {",
    b5: "if (p->left == NULL && p->right == NULL) {",
    b6: "delete p;",
    b7: "p = NULL; } else if (p->left == NULL) { Node* t = p; p = p->right;",
    b8: "delete t;",
    b9: "} else if (p->right == NULL) { Node* t = p; p = p->left;",
    b10: "delete t; } else {",
    b11: "Node* s = p->right; while (s->left != NULL) s = s->left; p->data = s->data;",
    b12: "remove(s->data, p->right); } } }",
    b13: "Two children: the node's value is replaced by its inorder successor.",
  };
  const textOf = (ids: string[]) => ids.map((id) => blocks[id]).join(" ");
  const beats = [
    { title: "Insert", sourceBlockIds: ["x"] },
    { title: "Deleting a node", sourceBlockIds: ["b1", "b2", "b3", "b4", "b5", "b6", "b7"] },
    { title: "These source blocks completely and", sourceBlockIds: ["b8", "b9", "b10", "b11", "b12", "b13"] },
  ];
  assert.equal(openBraces(textOf(beats[1].sourceBlockIds)), 3);
  const merged = mergeSplitCodeBeats(beats, (ids) => (ids[0] === "x" ? "prose only" : textOf(ids)));
  assert.equal(merged.length, 2, "the tail beat is absorbed");
  assert.equal(merged[1].title, "Deleting a node");
  assert.equal(merged[1].sourceBlockIds.length, 13);
  assert.equal(openBraces(textOf(merged[1].sourceBlockIds)), 0, "the whole function, braces balanced");
  // Beats that close their own braces are left alone.
  assert.equal(mergeSplitCodeBeats(beats.slice(0, 1), () => "void f() { return; }").length, 1);
});

test("code questions are recognised from the question and the document", async () => {
  const { isCodeQuestion } = await import("../codeSpec");
  const codeDoc = "void BST::remove(int d, Node*& p) { if (p == NULL) return; else if (d < p->data) remove(d, p->left); }";
  assert.equal(isCodeQuestion("explain me in C++ the deletion mechanism in the pdf"), true, "names a language");
  assert.equal(isCodeQuestion("show me the code"), true);
  assert.equal(isCodeQuestion("explain to me working of remove function", codeDoc), true, "asks how a function in a code document works");
  assert.equal(isCodeQuestion("explain to me working of remove function", "Prose about trees only."), false, "no code in the document");
  assert.equal(isCodeQuestion("why did the 1857 war start?", codeDoc), false);
  assert.equal(isCodeQuestion("anything", "", "code_walkthrough"), true);
});

test("asking for code is recognised, and refusing it is too", async () => {
  const { asksForCode } = await import("../codeSpec");
  for (const yes of ["explain me deletion code", "explain me in C++ the deletion mechanism in the pdf", "show the implementation", "BST insert in python"]) {
    assert.equal(asksForCode(yes), true, yes);
  }
  for (const no of ["explain BST deletion", "no code please", "explain it without code", "the 1857 war", ""]) {
    assert.equal(asksForCode(no), false, no);
  }
});

test("a lecture the student asked code for gets code boards, even when its pages have none", async () => {
  const { pickCodeBeats } = await import("../codeSpec");
  // The plan the real "tree del.pdf" run produced — two beats, neither titled like code.
  const treeDel = [
    { sequence: 0, title: "In C++ the Deletion Mechanism", objective: "How a node is deleted from a binary search tree.", visualKind: "react-animation" },
    { sequence: 1, title: "Page 2", objective: "Deleting a node with two children; the C++ implementation.", visualKind: "react-animation" },
  ];
  const picked = pickCodeBeats(treeDel, "explain me deletion code", true);
  assert.equal(picked.filter((b) => b.visualKind === "code").length, 1, "one of two beats — never the whole lecture");

  const five = [
    { sequence: 0, title: "Binary Search Trees", objective: "Open with a puzzle.", visualKind: "react-animation" },
    { sequence: 1, title: "Searching a BST", objective: "Walk left or right.", visualKind: "react-animation" },
    { sequence: 2, title: "Deleting a leaf", objective: "The simplest delete case.", visualKind: "react-animation" },
    { sequence: 3, title: "Deleting a node with two children", objective: "Replace with the smallest item in the right subtree.", visualKind: "react-animation" },
    { sequence: 4, title: "Big-O of Tree Operations", objective: "Time complexity of search.", visualKind: "blackboard" },
  ];
  const out = pickCodeBeats(five, "explain me deletion code", true);
  const code = out.filter((b) => b.visualKind === "code").map((b) => b.sequence);
  assert.ok(code.length >= 1 && code.length <= 2, `1-2 code beats, got ${code}`);
  assert.ok(code.every((s) => s === 2 || s === 3), `the deletion beats are the ones converted, got ${code}`);
  assert.equal(out[0].visualKind, "react-animation", "the opening beat is left alone");
  assert.equal(out[4].visualKind, "blackboard", "an unrelated beat is left alone");

  // Nothing asked → nothing changes; a plan already showing code is left as it is.
  assert.deepEqual(pickCodeBeats(five, "explain BST deletion", false), five);
  const already = five.map((b) => (b.sequence === 1 ? { ...b, visualKind: "code" } : b));
  assert.deepEqual(pickCodeBeats(already, "explain me deletion code", true), already);
});

test("a stubbed listing is refused, a real comment is not", async () => {
  const { findStubLine } = await import("../codeSpec");
  // The board the real "tree del.pdf" run produced: the two-children case left as a comment.
  const stub = ["} else {", "    // Handle two children case, if needed", "}"].join("\n");
  assert.match(findStubLine(stub) ?? "", /two children/);
  assert.equal(validateCodeSpec({ ...good, code: `${LISTING}\n// TODO: rotate` }), null);
  // A genuine heading comment followed by the code it describes is left alone.
  const real = ["} else {", "    // handle the two-children case", "    Node* s = p->right;", "}"].join("\n");
  assert.equal(findStubLine(real), undefined);
  assert.equal(findStubLine("// insert the new node here\np = new Node(d);"), undefined);
});

test("'From your document' is only claimed for code that is in the document", async () => {
  const { verifyFromSource } = await import("../codeSpec");
  assert.equal(verifyFromSource(LISTING, BST_REMOVE_FROM_PDF), true, "quoted from the notes");
  assert.equal(verifyFromSource(LISTING, ""), false, "no document at all");
  assert.equal(
    verifyFromSource(LISTING, "The complicated case deals with a node having two children: replace it with the smallest item in the right subtree."),
    false,
    "a scanned chapter's prose has no listing to quote",
  );
  assert.equal(verifyFromSource("TreeNode* deleteNode(TreeNode* root, int key) { if (!root) return root; }", BST_REMOVE_FROM_PDF), false, "different code");
});
