import test from "node:test";
import assert from "node:assert/strict";
import { anchorTraceNotes, claimedLinksProblem, continuedCodeProblem, retargetLineReferences, crowdedStepsProblem, csMechanismBoard, removeCutNodes, csPictureRule, exampleProblem, hardcodedResultProblem, isCodeNote, parentForestProblem, pointerNameProblem, protocolStartProblem, repairFromExample, structureChangeProblem, isCsMechanismQuestion, isPlaceholderValue, isTypedCsTopic, isTypedDsaTopic, placeholderProblem, syncProblem } from "../canvas/csLessons";
import { ladderBoardBudget } from "../canvas/conceptLadder";
import { examinerFor } from "../canvas/mathsCheck";
import type { CanvasBoardSpec, DsOp, DsStart } from "../canvas/types";

// The CS test of 2026-10-23: 50 niche CS topics, and everyday uses of CS words.
const CS = [
  "Union-Find with path compression", "Disjoint set union", "Topological sort using Kahn's algorithm", "LRU cache with a hash map and doubly linked list",
  "Bloom filters and false positive rate", "Skip lists", "Segment trees for range sum queries", "Fenwick tree (binary indexed tree)",
  "KMP string matching", "Rabin-Karp rolling hash", "Red-black tree insertion", "B-trees in databases", "Trie autocomplete",
  "Raft consensus leader election", "Consistent hashing", "Two-phase commit", "TCP three-way handshake", "Page replacement algorithms (LRU, FIFO)",
  "Deadlock detection with resource allocation graphs", "Mutex vs semaphore", "Garbage collection: mark and sweep", "Virtual memory and paging",
  "CPU scheduling round robin", "Finite automata and regular expressions", "NFA to DFA conversion", "Turing machines", "P vs NP",
  "Huffman coding", "0/1 knapsack dynamic programming", "Longest common subsequence", "Floyd-Warshall all pairs shortest path",
  "Kruskal's minimum spanning tree", "Prim's algorithm", "A* search", "Minimax with alpha-beta pruning", "Backpropagation in neural networks",
  "K-means clustering", "Database normalization 3NF", "SQL joins", "Big-O of quicksort", "Amortized analysis of dynamic arrays",
  "Monotonic stack: next greater element", "Sliding window maximum", "Cycle detection in a linked list (Floyd's tortoise and hare)", "Merge k sorted lists with a min-heap",
  "Bellman-Ford negative cycles", "Tarjan's strongly connected components", "Hash collisions: open addressing vs chaining", "Recursion tree for merge sort",
  "How does a Bloom filter work and why does it give false positives?", "How does Raft elect a leader in a distributed system?", "How does the KMP string matching algorithm work?",
];
const NOT_CS = [
  "Graph of y = x squared", "Tree diagrams in probability", "Food webs and food chains", "Stacks, arches and stumps in coastal erosion",
  "Queueing at a bank: Little's law", "Heaps of sediment and deposition", "The nervous system network", "Family tree of the Tudors",
  "Sorting materials by their properties", "Binary fission in bacteria", "Arrays in maths: multiplication arrays", "Hash marks on a number line",
  "Cell signalling pathways", "Electrical circuits in series and parallel", "Supply and demand graphs", "DNA replication",
  "How to build a raft for a river crossing", "How are party leaders chosen in a leader election", "Threads and stitches in sewing",
  "Decision trees in probability", "Scheduling your revision timetable", "Transactions in a bank account", "Parsing sentences in English grammar",
  "Pipelines in the oil industry", "Consensus in group decision making", "Registers in sociolinguistics", "Heaps and piles in archaeology",
];

test("typed CS lessons: niche CS topics are recognised, everyday uses of CS words are not", () => {
  for (const t of CS) assert.equal(isTypedCsTopic(t), true, t);
  for (const t of NOT_CS) {
    assert.equal(isTypedCsTopic(t), false, t);
    assert.equal(isTypedDsaTopic(t), false, t);
  }
  // A data-structure word as a CS title, or with CS around it, still counts.
  assert.equal(isTypedDsaTopic("Stacks"), true);
  assert.equal(isTypedDsaTopic("Binary heap insertion"), true);
  assert.equal(isTypedDsaTopic("Arrays in Python"), true);
  assert.equal(isTypedDsaTopic("How can we detect if a graph is bipartite"), true);
});

test("typed CS lessons: each kind of topic gets its own picture", () => {
  assert.match(csPictureRule("How does the KMP string matching algorithm work?") ?? "", /STRING MATCHING/);
  assert.match(csPictureRule("How does a Bloom filter work?") ?? "", /BLOOM FILTER/);
  assert.match(csPictureRule("How does Raft elect a leader in a distributed system?") ?? "", /PROTOCOL/);
  assert.match(csPictureRule("NFA to DFA conversion") ?? "", /AUTOMATA/);
  assert.match(csPictureRule("Page replacement algorithms (LRU, FIFO)") ?? "", /OPERATING SYSTEMS/);
  assert.match(csPictureRule("Union-Find with path compression") ?? "", /UNION-FIND/);
  assert.equal(csPictureRule("Red-black tree insertion"), null, "a tree: the usual DSA rules");
  assert.equal(csPictureRule("P vs NP"), null);
});

test("a new student's 'how does X work' about a CS mechanism is a lesson, a narrow question is not", () => {
  assert.equal(isCsMechanismQuestion("How does Union-Find with path compression and union by rank work?"), true);
  assert.equal(isCsMechanismQuestion("How does a Bloom filter work and why does it give false positives?"), true);
  assert.equal(isCsMechanismQuestion("How does Raft elect a leader in a distributed system?"), true);
  assert.equal(isCsMechanismQuestion("How is the counter incremented in a while loop?"), false);
  assert.equal(isCsMechanismQuestion("Why does my code give an error on line 3?"), false);
  assert.equal(isCsMechanismQuestion("How does photosynthesis work?"), false);
});

test("the variables panel: descriptions and formulas are not values", () => {
  for (const [name, value] of [["lps", "array of zeros"], ["candidate_length", "not set"], ["i", "finished"], ["lps", "completed LPS array"], ["i", "i + 1"], ["candidate_length", "lps[candidate_length - 1"], ["pattern", "pattern"], ["voter", "A, then C"], ["j", "falls back or stays zero"], ["result", "fewer than 6"], ["in_degree", "updated"], ["log_check", "passed"]]) {
    assert.equal(isPlaceholderValue(name, value), true, `${name} = ${value}`);
  }
  for (const [name, value] of [["lps", "[0, 0, 1, 2]"], ["i", "3"], ["prev", "None"], ["text", "ABABABC"], ["w", "'A'"], ["queue", "empty"], ["role", "follower"], ["v", "B"], ["dist", "-1"], ["found", "True"], ["queue", "[]"], ["term_B", "2"]]) {
    assert.equal(isPlaceholderValue(name, value), false, `${name} = ${value}`);
  }
  assert.match(placeholderProblem([{ s: 0, state: [{ name: "i", value: "1" }] }, { s: 1, state: [{ name: "i", value: "finished" }] }]) ?? "", /i = "finished"/);
  assert.equal(placeholderProblem([{ s: 0, state: [{ name: "lps", value: "[0, 0, 1]" }, { name: "i", value: "3" }] }]), null);
});

const flowBoard = (noteAt: number[], nodeAt: number[]): CanvasBoardSpec => ({
  v: 1,
  heading: "Adding and Querying",
  notes: noteAt.map((s, i) => ({ id: `n${i}`, text: `note ${i}`, s })),
  stage: { kind: "flow", nodes: nodeAt.map((s, i) => ({ id: `f${i}`, label: `box ${i}`, s })), arrows: [] },
  cues: [],
}) as unknown as CanvasBoardSpec;
const FOUR = "To add an element, apply the hash functions. To query, apply the same functions. If any bit is 0, it is absent. For example, karachi-mug sets bits 2, 5 and 9.";

test("a typed CS board keeps pace with Aria", () => {
  // The Bloom-filter board: nothing on sentences 2 and 3, then everything on sentence 4.
  const dumped = syncProblem(flowBoard([0, 3, 3, 3, 3], [3, 3, 0]), FOUR);
  assert.match(dumped ?? "", /sentences 2, 3/);
  assert.match(dumped ?? "", /sentence 4 brings in/);
  assert.equal(syncProblem(flowBoard([0, 1, 2, 3], [1, 3]), FOUR), null);
  // One silent closing sentence is fine.
  assert.equal(syncProblem(flowBoard([0, 1, 2], [1]), FOUR), null);
});

const graph = (edges: Array<[string, string]>, directed = true): DsStart => ({
  kind: "graph",
  ...(directed ? { variant: "directed" as const } : {}),
  nodes: ["A", "B", "C", "D", "E", "F"].map((v) => ({ id: v.toLowerCase(), value: v })),
  edges: edges.map(([from, to]) => ({ from, to })),
});
const KAHN = graph([["a", "c"], ["b", "c"], ["b", "e"], ["c", "d"], ["d", "f"]]);

test("one example through the lesson: a board that draws a different graph goes back", () => {
  const earlier = [{ start: KAHN, steps: [] }];
  assert.equal(exampleProblem(KAHN, earlier, "We now trace the same graph."), null);
  const other = graph([["a", "b"], ["a", "c"], ["b", "e"], ["c", "d"], ["e", "d"], ["d", "f"]]);
  assert.match(exampleProblem(other, earlier, "We continue the trace.") ?? "", /different graph/);
  // Aria says it changes: allowed.
  assert.equal(exampleProblem(other, earlier, "Now add an edge from E to D and see what happens."), null);
  assert.equal(exampleProblem(graph([["c", "d"], ["d", "f"], ["f", "c"]]), earlier, "A cycle blocks every ordering."), null);
  // Continuing from where an earlier board left its structure is the same example.
  const list: DsStart = { kind: "list", nodes: [{ id: "n1", value: "1" }, { id: "n2", value: "2" }, { id: "n3", value: "3" }], edges: [{ from: "n1", to: "n2" }, { from: "n2", to: "n3" }] };
  const reversedTwo: DsStart = { ...list, edges: [{ from: "n2", to: "n1" }, { from: "n3", to: "n2" }] };
  const steps = [{ s: 0, ops: [{ op: "link" as const, from: "n2", to: "n1" }, { op: "unlink" as const, from: "n1", to: "n2" }] }, { s: 1, ops: [{ op: "link" as const, from: "n3", to: "n2" }] }];
  assert.equal(exampleProblem(reversedTwo, [{ start: list, steps }], "We continue from where we stopped."), null);
});

test("a typed CS lesson's ladder is compact: one or two boards a new part, ten at most", () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ title: `Part ${i + 1}`, status: "new" as const }));
  assert.deepEqual(ladderBoardBudget(six), { min: 13, max: 19 });
  assert.deepEqual(ladderBoardBudget(six, true), { min: 7, max: 10 });
});

test("the CS examiner reads niche typed CS lessons, and only typed ones", () => {
  assert.equal(examinerFor("How does a Bloom filter work?", [], true), "cs");
  assert.equal(examinerFor("How does a Bloom filter work?", [], false), null);
  assert.equal(examinerFor("Recursion in Python", []), "cs");
});

test("a typed CS lesson's mechanism boards are drawn on the structure, not as flow charts", () => {
  const raft = "How does Raft elect a leader in a distributed system?";
  assert.equal(csMechanismBoard(raft, "Election timeout detects silence: a follower hears no heartbeat and becomes a candidate"), true);
  assert.equal(csMechanismBoard("How does a Bloom filter work?", "Collisions create false positives: other keys set the same bits"), true);
  assert.equal(csMechanismBoard("How does the KMP string matching algorithm work?", "A mismatch falls back through the LPS table"), true);
  // Not a niche family with a picture: the usual rules decide.
  assert.equal(csMechanismBoard("Topological sort with Kahn's algorithm", "The queue holds ready vertices"), false);
  assert.equal(csMechanismBoard("DNA replication", "The leading strand is copied by polymerase"), false);
});

test("union-find: a node has one parent link, so path compression moves the arrow", () => {
  const forest: DsStart = { kind: "graph", variant: "directed", nodes: ["A", "C", "D", "E"].map((v) => ({ id: v.toLowerCase(), value: v })), edges: [{ from: "c", to: "a" }, { from: "d", to: "c" }, { from: "e", to: "d" }] };
  const added = [{ s: 1, ops: [{ op: "link" as const, from: "e", to: "a" }] }];
  const moved = [{ s: 1, ops: [{ op: "unlink" as const, from: "e", to: "d" }, { op: "link" as const, from: "e", to: "a" }] }];
  assert.match(parentForestProblem("Union-Find with path compression", forest, added) ?? "", /E has two parent links/);
  assert.equal(parentForestProblem("Union-Find with path compression", forest, moved), null);
  assert.equal(parentForestProblem("Topological sort with Kahn's algorithm", forest, added), null, "only union-find lessons");
});

test("a protocol's servers start unlinked, so each message can be seen arriving", () => {
  const servers = (edges: Array<{ from: string; to: string }>): DsStart => ({ kind: "graph", variant: "directed", nodes: ["A", "B", "C"].map((v) => ({ id: v.toLowerCase(), value: v })), edges });
  const raft = "How does Raft elect a leader in a distributed system?";
  assert.match(protocolStartProblem(raft, servers([{ from: "a", to: "b" }, { from: "b", to: "c" }])) ?? "", /start with NO links/);
  assert.equal(protocolStartProblem(raft, servers([])), null);
  assert.equal(protocolStartProblem("Topological sort with Kahn's algorithm", servers([{ from: "a", to: "b" }])), null);
});

test("a protocol's messages are named, and only changing roles carry a tag", () => {
  const raft = "How does Raft elect a leader in a distributed system?";
  const servers: DsStart = { kind: "graph", variant: "directed", nodes: ["A", "B", "C"].map((v) => ({ id: v.toLowerCase(), value: v })), edges: [] };
  assert.match(protocolStartProblem(raft, servers, [{ s: 1, ops: [{ op: "link", from: "b", to: "a", label: "link" }] }]) ?? "", /no name/);
  assert.match(protocolStartProblem(raft, servers, [{ s: 1, ops: [{ op: "point", name: "follower", to: "a" }] }]) ?? "", /no "follower" tag/);
  assert.equal(protocolStartProblem(raft, servers, [{ s: 1, ops: [{ op: "point", name: "candidate", to: "b" }, { op: "link", from: "b", to: "a", label: "vote?" }] }]), null);
});

// The BST review (2026-10-23): what kept a good DSA lecture at 6.5/10.
const bst = (edges: Array<[string, string, "left" | "right"]>): DsStart => ({
  kind: "tree",
  variant: "bst",
  nodes: ["8", "3", "10", "1", "6", "14", "4"].map((v) => ({ id: `n${v}`, value: v })),
  edges: edges.map(([a, b, side]) => ({ from: `n${a}`, to: `n${b}`, side })),
});
const FULL: Array<[string, string, "left" | "right"]> = [["8", "3", "left"], ["8", "10", "right"], ["3", "1", "left"], ["3", "6", "right"], ["6", "4", "left"], ["10", "14", "right"]];

test("BST review: a deletion or re-link that is only said sends the board back", () => {
  const said = ["A leaf has no children, so deleting 1 simply removes the link from 3 to 1.", "6 is replaced by its child, so 3 points directly to 4."];
  assert.match(structureChangeProblem(bst(FULL), [{ s: 0, ops: [{ op: "mark", id: "n1", as: "remove" }] }], said) ?? "", /nothing is removed/);
  assert.equal(structureChangeProblem(bst(FULL), [{ s: 0, ops: [{ op: "remove", id: "n1" }] }, { s: 1, ops: [{ op: "link", from: "n3", to: "n4", side: "right" }] }], said), null);
  assert.equal(structureChangeProblem(bst(FULL), [], ["Deletion has three cases."]), null, "talk about deletion in general is fine");
});

test("BST review: a traversal's answer hard-coded in the code is sent back", () => {
  assert.match(hardcodedResultProblem(["inorder = [1, 3, 4, 6, 8, 10, 14]"]) ?? "", /writes the answer as a list/);
  assert.equal(hardcodedResultProblem(["def inorder(node):", "    if node is None: return", "    out.append(node.value)"]), null);
  assert.equal(hardcodedResultProblem(["queue = [start]"]), null);
});

test("BST review: four steps on one sentence, long pointer names and re-written continued code are caught", () => {
  assert.match(crowdedStepsProblem([{ s: 3 }, { s: 3 }, { s: 3 }, { s: 4 }]) ?? "", /3 steps of the trace happen on one sentence \(sentence 4\)/);
  assert.equal(crowdedStepsProblem([{ s: 1 }, { s: 2 }, { s: 2 }]), null);
  assert.match(pointerNameProblem(bst(FULL), [{ s: 0, ops: [{ op: "point", name: "successor_parent", to: "n6" }] }]) ?? "", /"successor_parent"/);
  assert.equal(pointerNameProblem(bst(FULL), [{ s: 0, ops: [{ op: "point", name: "succ_par", to: "n6" }] }]), null);
  assert.equal(continuedCodeProblem(["def insert(root, key):", "  pass"], ["def insert(root, key):", "  pass"]), null);
  assert.match(continuedCodeProblem(["def insert(root, key):", "  node = Node(key)"], ["def insert(root, key):", "  pass"]) ?? "", /CONTINUES the last board/);
  assert.equal(continuedCodeProblem(["x = 1"], undefined), null);
});

test("BST review: a node left floating gets its link back from the lesson's example", () => {
  const forgot = bst(FULL.filter(([a, b]) => !(a === "10" && b === "14")));
  const repaired = repairFromExample(forgot, [{ start: bst(FULL), steps: [] }]);
  assert.ok(repaired?.edges.some((e) => e.from === "n10" && e.to === "n14" && e.side === "right"));
  assert.equal(repairFromExample(bst(FULL), [{ start: bst(FULL), steps: [] }]), null, "nothing to repair");
});

test("BST review: notes that are lines of code are dropped beside the code, link notes stay", () => {
  for (const t of ["def search(root, target):", "while root is not None:", "if target == root.key:", "return root"]) assert.equal(isCodeNote(t) || t === "return root", true, t);
  for (const t of ["5 < 8: move left", "3.right = 6", "Successor = smallest right key", "Delete key 3"]) assert.equal(isCodeNote(t), false, t);
});

test("BST review: a node re-linked around is removed, and named links must match the drawing", () => {
  const tree: DsStart = { kind: "tree", variant: "bst", nodes: ["8", "3", "10", "6"].map((v) => ({ id: `n${v}`, value: v })), edges: [{ from: "n8", to: "n3", side: "left" }, { from: "n8", to: "n10", side: "right" }, { from: "n3", to: "n6", side: "right" }] };
  const steps: Array<{ s: number; ops: DsOp[] }> = [{ s: 0, ops: [{ op: "mark", id: "n3", as: "remove" }] }, { s: 1, ops: [{ op: "link", from: "n8", to: "n6", side: "left" }] }];
  const fixed = removeCutNodes(tree, steps);
  assert.ok(fixed?.[1].ops?.some((o) => o.op === "remove" && o.id === "n3"), "3 is removed on the step that cut it out");
  assert.equal(removeCutNodes(tree, [{ s: 0, ops: [{ op: "mark" as const, id: "n3", as: "visit" as const }] }]), null);
  assert.match(claimedLinksProblem(tree, ["This board continues from links 8→3, 8→10, 3→6, and 6→5."]) ?? "", /draw exactly the links she names/);
  assert.equal(claimedLinksProblem(tree, ["This board continues from links 8→3, 8→10 and 3→6."]), null);
  assert.equal(claimedLinksProblem(tree, ["We delete 3."]), null);
});

test("BST review: notes go up on the sentence that says them, however far the splitter moved them", () => {
  const script = "We start at the root node, 8. Line 3 checks whether 4 equals 8; it does not. Line 5 checks whether 4 is less than 8; it is. Line 6 follows 8's left link, so node becomes 3. Line 3 checks whether 4 equals 3; it does not. Line 5 checks whether 4 is less than 3; it is not, so the else branch is selected. Line 8 follows 3's right link, so node becomes 6. Line 3 checks whether 4 equals 6; it does not. Line 5 checks whether 4 is less than 6; it is. Line 6 follows 6's left link, so node becomes 4. Line 3 finds that the key 4 equals node.key.";
  const notes = anchorTraceNotes([{ text: "4 < 8 → left", s: 1 }, { text: "4 > 3 → right", s: 1 }, { text: "4 < 6 → left", s: 3 }, { text: "4 == 4 → found", s: 4 }], script);
  assert.deepEqual(notes.map((n) => n.s), [2, 5, 9, 10]);
  // A note that matches nothing never moves before the one before it.
  assert.deepEqual(anchorTraceNotes([{ text: "4 < 8 → left", s: 1 }, { text: "something else", s: 0 }], script).map((n) => n.s), [2, 2]);
});

test("BST review: 'line 10 copies…' over a line that cannot copy names and lights the line that does", () => {
  const lines = ["def delete(root, key):", "    if root is None:", "        return None", "    if key < root.value:", "        root.left = delete(root.left, key)", "    elif key > root.value:", "        root.right = delete(root.right, key)", "    elif root.left is None:", "        return root.right", "    elif root.right is None:", "        return root.left", "    else:", "        succ = root.right", "        while succ.left:", "            succ = succ.left", "        root.value = succ.value", "        root.right = delete(root.right, succ.value)", "    return root"];
  const steps = [{ s: 0, lines: [10] }, { s: 1, lines: [11] }, { s: 2, lines: [11] }];
  const r = retargetLineReferences(lines, steps, "Line 10 copies the successor value 10 into the root node. Line 11 recursively deletes the original successor node containing 10 from the right subtree. Line 11 assigns that returned node as the root's right child.");
  assert.equal(r.fixed, 3);
  assert.match(r.script, /^Line 16 copies .* Line 17 recursively deletes .* Line 17 assigns/);
  assert.deepEqual(steps.map((s) => s.lines), [[16], [17], [17]]);
  // A line that can do what she says is left alone.
  assert.equal(retargetLineReferences(lines, [{ s: 0, lines: [16] }], "Line 16 copies the successor value into the root.").fixed, 0);
});

test("BST review: a new node made first and linked a step later is not removed as 'cut out'", () => {
  const tree: DsStart = { kind: "tree", variant: "bst", nodes: ["8", "3", "4"].map((v) => ({ id: `n${v}`, value: v })), edges: [{ from: "n8", to: "n3", side: "left" }, { from: "n3", to: "n4", side: "right" }] };
  const insert: Array<{ s: number; ops: DsOp[] }> = [{ s: 0, ops: [{ op: "add", id: "n5", value: "5" }] }, { s: 1, ops: [{ op: "link", from: "n4", to: "n5", side: "right" }] }];
  assert.equal(removeCutNodes(tree, insert), null);
  // Deleting one-child 3: 4 is detached, then linked to 8's left where 3 was.
  const relink: Array<{ s: number; ops: DsOp[] }> = [{ s: 0, ops: [{ op: "unlink", from: "n3", to: "n4" }, { op: "unlink", from: "n8", to: "n3" }, { op: "remove", id: "n3" }] }, { s: 1, ops: [{ op: "link", from: "n8", to: "n4", side: "left" }] }];
  assert.equal(removeCutNodes(tree, relink), null);
});

test("a tied note does not drag the notes after it late (NFA board, CS rating run)", () => {
  const script = "We have the destinations; now we identify where the DFA starts. The DFA start state is the epsilon-closure of the NFA start state, so it is {q0, q1}. A DFA state is accepting when its set contains at least one NFA accepting state. Since q3 accepts, every DFA set containing q3 accepts. For our machine, {q2} is not accepting, but {q2, q3} is accepting.";
  const notes = anchorTraceNotes([{ text: "DFA start = {q0, q1}", s: 1 }, { text: "q3 is NFA accepting", s: 3 }, { text: "Contains q3 → accepting", s: 3 }, { text: "{q2} not accepting", s: 4 }], script);
  assert.equal(notes[2].s, 3, "the note after a tied one can still go on the earlier tied sentence");
  assert.equal(notes[3].s, 4);
});
