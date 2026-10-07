import test from "node:test";
import assert from "node:assert/strict";

import {
  MIND_MAP_MAX_CHILDREN,
  MIND_MAP_MAX_DEPTH,
  MIND_MAP_MAX_NODES,
  branchIds,
  layoutMindMap,
  mindMapDepth,
  mindMapTranscript,
  parseMindMap,
  type MindMapNode,
} from "../mindMap";

/**
 * The lecture's mind map: what the model returns is clamped into a readable tree, and the tree is
 * laid out left to right with no box on top of another.
 */

const leaf = (label: string) => ({ label });
const sample = {
  title: "Electrolysis",
  root: {
    label: "Electrolysis",
    children: [
      { label: "Faraday's laws", children: [leaf("First law"), leaf("Second law"), { label: "Charge", note: "Q = I × t" }] },
      { label: "Electrodes", children: [leaf("Anode"), leaf("Cathode")] },
      { label: "Copper plating", children: [] },
    ],
  },
};

test("a model's tree becomes a mind map with ids from its path", () => {
  const { mindMap, issue } = parseMindMap(sample);
  assert.equal(issue, undefined);
  assert.ok(mindMap);
  assert.equal(mindMap.title, "Electrolysis");
  assert.equal(mindMap.root.id, "0");
  assert.deepEqual(mindMap.root.children.map((c) => c.id), ["0.0", "0.1", "0.2"]);
  assert.equal(mindMap.root.children[0].children[2].note, "Q = I × t");
  assert.equal(mindMapDepth(mindMap.root), 2);
});

test("a root with fewer than two branches is refused with a reason", () => {
  const { mindMap, issue } = parseMindMap({ root: { label: "X", children: [leaf("Only one")] } });
  assert.equal(mindMap, null);
  assert.match(issue ?? "", /at least 2 branches/);
  assert.equal(parseMindMap("nope").mindMap, null);
});

test("duplicates among siblings and empty labels are dropped", () => {
  const { mindMap } = parseMindMap({ root: { label: "R", children: [leaf("A"), leaf("a"), leaf(""), leaf("B"), { title: "C via title" }] } });
  assert.deepEqual(mindMap?.root.children.map((c) => c.label), ["A", "B", "C via title"]);
});

test("depth, children per node and total size are clamped", () => {
  // Six levels deep: only four survive below the root.
  let deep: Record<string, unknown> = leaf("L6");
  for (let i = 5; i >= 1; i--) deep = { label: `L${i}`, children: [deep, leaf(`side${i}`)] };
  const deepMap = parseMindMap({ root: { label: "R", children: [deep, leaf("other")] } }).mindMap!;
  assert.equal(mindMapDepth(deepMap.root), MIND_MAP_MAX_DEPTH);

  const wide = parseMindMap({ root: { label: "R", children: Array.from({ length: 12 }, (_, i) => leaf(`c${i}`)) } }).mindMap!;
  assert.equal(wide.root.children.length, MIND_MAP_MAX_CHILDREN);

  const huge = parseMindMap({
    root: { label: "R", children: Array.from({ length: 7 }, (_, i) => ({ label: `b${i}`, children: Array.from({ length: 7 }, (_, j) => ({ label: `b${i}.${j}`, children: Array.from({ length: 7 }, (_, k) => leaf(`b${i}.${j}.${k}`)) })) })) },
  }).mindMap!;
  let count = 0;
  const walk = (n: MindMapNode) => { count += 1; n.children.forEach(walk); };
  walk(huge.root);
  assert.ok(count <= MIND_MAP_MAX_NODES, `${count} nodes`);
});

test("a collapsed branch hides everything under it", () => {
  const { mindMap } = parseMindMap(sample);
  const onlyRoot = layoutMindMap(mindMap!.root, new Set(["0"]));
  assert.deepEqual(onlyRoot.nodes.map((n) => n.id).sort(), ["0", "0.0", "0.1", "0.2"]);
  assert.equal(onlyRoot.links.length, 3);
  const all = layoutMindMap(mindMap!.root, new Set(branchIds(mindMap!.root)));
  assert.equal(all.nodes.length, 9);
  assert.deepEqual(branchIds(mindMap!.root), ["0", "0.0", "0.1"]);
});

test("boxes never overlap, columns run left to right, and a parent sits centred on its children", () => {
  const { mindMap } = parseMindMap(sample);
  const layout = layoutMindMap(mindMap!.root, new Set(branchIds(mindMap!.root)));
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  for (const a of layout.nodes) {
    for (const b of layout.nodes) {
      if (a === b) continue;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.ok(!overlap, `${a.label} overlaps ${b.label}`);
    }
  }
  const root = byId.get("0")!;
  const branch = byId.get("0.0")!;
  assert.ok(branch.x > root.x + root.w, "children sit to the right of their parent");
  const kids = layout.nodes.filter((n) => n.parentId === "0.0");
  const mid = (kids[0].y + kids[0].h / 2 + kids[kids.length - 1].y + kids[kids.length - 1].h / 2) / 2;
  assert.ok(Math.abs(branch.y + branch.h / 2 - mid) < 0.5, "a parent is centred on its children");
  assert.ok(Math.min(...layout.nodes.map((n) => n.y)) === 0);
});

test("the transcript carries every beat in order, with its concept, within the budget", () => {
  const text = mindMapTranscript([
    { title: "Faraday's first law", points: ["m ∝ Q"], script: "Mass deposited is proportional to charge.", conceptId: "faraday" },
    { title: "Copper plating", script: "Q = 2 A × 1800 s = 3600 C." },
  ], 2000);
  assert.match(text, /## 1\. Faraday's first law \(concept: faraday\)/);
  assert.match(text, /## 2\. Copper plating/);
  assert.ok(text.indexOf("first law") < text.indexOf("Copper plating"));
  assert.equal(mindMapTranscript([]), "");
});
