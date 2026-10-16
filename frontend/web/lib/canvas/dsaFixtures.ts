/**
 * Hand-written DSA boards, as the board model would write them — for looking at the structure boards
 * in the canvas lab without generating a lecture (`/canvas-lab?scrub=1&fixture=dsa`, development
 * only), and for the tests (lib/anim/dsaBoards.test.ts), which check every one validates and runs.
 */
export const DSA_FIXTURES: Array<{ id: string; script: string; raw: Record<string, unknown> }> = [
  {
    id: "b1",
    script:
      "Here is our binary search tree, with three at the root. " +
      "To delete two, we start at the root and compare: two is smaller than three, so we go left. " +
      "Now we have found two, and it has exactly one child, the node one. " +
      "So three's left link skips over two and points straight at one, and two is gone. " +
      "The tree is still in order: one, three, four, five, six.",
    raw: {
      heading: "Delete a node with one child",
      notes: [],
      stage: {
        kind: "code",
        language: "pseudocode",
        reveal: "all",
        lines: [
          "function delete(root, key)",
          "  if root = null: return null",
          "  if key < root.value",
          "    root.left ← delete(root.left, key)",
          "  else if key > root.value",
          "    root.right ← delete(root.right, key)",
          "  else if root has one child",
          "    return that child",
          "  return root",
        ],
        structure: {
          kind: "tree",
          variant: "bst",
          nodes: [{ id: "n3", value: 3 }, { id: "n2", value: 2 }, { id: "n5", value: 5 }, { id: "n1", value: 1 }, { id: "n4", value: 4 }, { id: "n6", value: 6 }],
          edges: [{ from: "n3", to: "n2", side: "left" }, { from: "n3", to: "n5", side: "right" }, { from: "n2", to: "n1", side: "left" }, { from: "n5", to: "n4", side: "left" }, { from: "n5", to: "n6", side: "right" }],
          pointers: [{ name: "root", to: "n3" }],
        },
        steps: [
          { s: 0, lines: [1] },
          { s: 1, lines: [3, 4], note: "2 < 3: go left", ops: [{ op: "mark", id: "n3", as: "compare" }, { op: "point", name: "curr", to: "n2" }] },
          { s: 2, lines: [7, 8], note: "one child", ops: [{ op: "mark", id: "n2", as: "remove" }] },
          { s: 3, lines: [4], note: "3.left ← 1", ops: [{ op: "link", from: "n3", to: "n1", side: "left" }, { op: "remove", id: "n2" }] },
          { s: 4, lines: [9], ops: [{ op: "mark", id: "n1", as: "done" }, { op: "mark", id: "n3", as: "done" }, { op: "mark", id: "n4", as: "done" }, { op: "mark", id: "n5", as: "done" }, { op: "mark", id: "n6", as: "done" }] },
        ],
      },
      cues: [{ s: 1, action: "point", target: "ds-n3" }, { s: 2, action: "circle", target: "ds-n2" }, { s: 3, action: "point", target: "line-4" }],
    },
  },
  {
    id: "b2",
    script:
      "A linked list is a chain of boxes, each pointing to the next. " +
      "To reverse it, we walk along with curr, starting at the head. " +
      "First, one's link is cut, because one will be the new end. " +
      "Then two turns round to point back at one. " +
      "Finally three points back at two, and three becomes the new head.",
    raw: {
      heading: "Reversing a linked list",
      notes: [],
      stage: {
        kind: "code",
        language: "pseudocode",
        lines: ["prev ← null", "curr ← head", "while curr ≠ null", "  next ← curr.next", "  curr.next ← prev", "  prev ← curr", "  curr ← next", "head ← prev"],
        structure: { kind: "list", nodes: [{ id: "a", value: 1 }, { id: "b", value: 2 }, { id: "c", value: 3 }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }], pointers: [{ name: "head", to: "a" }] },
        steps: [
          { s: 0, lines: [1] },
          { s: 1, lines: [2], ops: [{ op: "point", name: "curr", to: "a" }] },
          { s: 2, lines: [4, 5], ops: [{ op: "unlink", from: "a", to: "b" }, { op: "point", name: "prev", to: "a" }, { op: "point", name: "curr", to: "b" }] },
          { s: 3, lines: [5, 6, 7], ops: [{ op: "link", from: "b", to: "a" }, { op: "point", name: "prev", to: "b" }, { op: "point", name: "curr", to: "c" }] },
          { s: 4, lines: [5, 8], ops: [{ op: "link", from: "c", to: "b" }, { op: "point", name: "curr", to: null }, { op: "point", name: "prev", to: null }, { op: "point", name: "head", to: "c" }] },
        ],
      },
      cues: [{ s: 3, action: "point", target: "ds-b" }],
    },
  },
  {
    id: "b3",
    script:
      "Breadth-first search explores a graph level by level, starting from A. " +
      "First A's neighbours, B and C, are visited. " +
      "Then the next level: D from B, and E from C. " +
      "Last of all F, the farthest from A.",
    raw: {
      heading: "Breadth-first search",
      notes: [{ text: "queue: visit by level", s: 0 }],
      stage: {
        kind: "structure",
        structure: { kind: "graph", nodes: ["A", "B", "C", "D", "E", "F"], edges: [{ from: "A", to: "B" }, { from: "A", to: "C" }, { from: "B", to: "D" }, { from: "C", to: "E" }, { from: "E", to: "F" }] },
        steps: [
          { s: 0, ops: [{ op: "mark", id: "a", as: "found" }], note: "start at A" },
          { s: 1, ops: [{ op: "mark", id: "b", as: "visit" }, { op: "mark", id: "c", as: "visit" }], note: "level 1: B, C" },
          { s: 2, ops: [{ op: "mark", id: "d", as: "visit" }, { op: "mark", id: "e", as: "visit" }], note: "level 2: D, E" },
          { s: 3, ops: [{ op: "mark", id: "f", as: "visit" }], note: "level 3: F" },
        ],
      },
      cues: [{ s: 0, action: "circle", target: "ds-a" }],
    },
  },
];
