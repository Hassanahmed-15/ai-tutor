import test from "node:test";
import assert from "node:assert/strict";
import { sequenceGeometry, sequenceOverlaps, validateSequenceStage } from "../canvas/sequence";
import { edgeBends } from "../canvas/structure";
import { textWidth, layoutPanel } from "../canvas/layout";
import { validateCanvasSpec } from "../canvas/validate";
import { noteTex } from "../canvas/mathNotes";
import { csMechanismStage, csPlanRule, isTypedDsaTopic } from "../canvas/csLessons";
import { applyLessonVisualPolicy } from "../canvas/visualPolicy";
import type { CanvasPlanBeat, CanvasStage } from "../canvas/types";

// The TCP lecture (2026-10-24): SYN, SYN-ACK and ACK drawn on one line over each other.
const TCP = {
  kind: "sequence",
  lanes: [{ id: "client", label: "Client" }, { id: "server", label: "Server" }],
  messages: [
    { id: "syn", from: "client", to: "server", label: "SYN", detail: "seq=1000", s: 1 },
    { id: "synack", from: "server", to: "client", label: "SYN-ACK", detail: "seq=2000, ack=1001", s: 2 },
    { id: "ack", from: "client", to: "server", label: "ACK", detail: "ack=2001", s: 3 },
  ],
  states: [
    { lane: "server", label: "LISTEN", at: -1, s: 0 },
    { lane: "client", label: "SYN-SENT", at: 0, s: 1 },
    { lane: "server", label: "SYN-RECEIVED", at: 1, s: 2 },
    { lane: "client", label: "ESTABLISHED", at: 2, s: 3 },
  ],
};
const sentence = (v: unknown, f = 0) => (typeof v === "number" ? Math.max(0, Math.min(5, v)) : f);
const unique = (v: unknown) => String(v);
// The stage a sequence board gets: the full width, or beside the notes column (layoutPanel).
const AREA = { x: 56, y: 108, w: 908, h: 424 };
const NARROW = { x: 352, y: 108, w: 612, h: 424 };

test("a handshake is a sequence: three arrows down the board, each on its own row, nothing overlapping", () => {
  const stage = validateSequenceStage(TCP, sentence, unique)!;
  assert.ok(stage);
  const g = sequenceGeometry(stage, AREA, textWidth);
  assert.equal(g.messages.length, 3);
  for (let i = 1; i < 3; i++) assert.ok(g.messages[i].p0.y > g.messages[i - 1].p1.y, "each message starts below the one before");
  assert.ok(g.messages[0].rightward && !g.messages[1].rightward);
  assert.deepEqual(sequenceOverlaps(g), []);
  for (const m of g.messages) assert.ok(m.p1.y <= AREA.y + AREA.h && m.labelAt.y > AREA.y, "inside the board");
});

test("the busiest board still fits: four parties, six messages with long details, beside the notes too", () => {
  const lanes = ["Browser", "Resolver", "Root server", "TLD server"].map((label) => ({ id: label.toLowerCase().replace(/ /g, "-"), label }));
  const messages = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, from: lanes[i % 3].id, to: lanes[(i % 3) + 1].id, label: i % 2 ? "referral" : "query", detail: "example.com A?", s: i }));
  const stage = validateSequenceStage({ lanes, messages, states: [{ lane: "resolver", label: "WAITING", at: 0, s: 1 }] }, (v, f = 0) => (typeof v === "number" ? v : f), unique)!;
  assert.ok(stage);
  for (const area of [AREA, NARROW]) {
    const g = sequenceGeometry(stage, area, textWidth);
    assert.deepEqual(sequenceOverlaps(g), []);
    assert.ok(Math.max(...g.messages.map((m) => Math.max(m.p1.y, m.detailAt?.y ?? 0))) <= area.y + area.h, "inside the board");
  }
  // The TCP handshake with its four states, beside the notes.
  const tcp = validateSequenceStage(TCP, sentence, unique)!;
  assert.deepEqual(sequenceOverlaps(sequenceGeometry(tcp, NARROW, textWidth)), []);
  assert.equal(validateSequenceStage({ lanes, messages: [...messages, ...messages.slice(0, 3)] }, (v, f = 0) => (typeof v === "number" ? v : f), unique), null, "a ninth message goes on the next board");
});

test("a sequence the board cannot draw is refused, never cut", () => {
  assert.equal(validateSequenceStage({ ...TCP, lanes: [{ id: "a", label: "Client" }] }, sentence, unique), null, "one party");
  assert.equal(validateSequenceStage({ ...TCP, messages: [{ from: "client", to: "nobody", label: "SYN", s: 1 }] }, sentence, unique), null);
  assert.equal(validateSequenceStage({ ...TCP, messages: [{ from: "client", to: "server", label: "a description of what the message does", s: 1 }] }, sentence, unique), null);
  const backwards = validateSequenceStage({ ...TCP, messages: [{ from: "client", to: "server", label: "SYN", s: 3 }, { from: "server", to: "client", label: "ACK", s: 1 }] }, sentence, unique)!;
  assert.deepEqual(backwards.messages.map((m) => m.s), [3, 3], "time never runs back up the board");
});

test("a sequence board goes through the board validator and lays out with a target per message", () => {
  const spec = validateCanvasSpec({ heading: "TCP handshake", notes: [], cues: [], stage: TCP }, 6)!;
  assert.equal(spec.stage.kind, "sequence");
  const layout = layoutPanel(spec);
  assert.ok(layout.marks.some((m) => m.type === "sequence"));
  for (const id of ["msg-syn", "msg-synack", "msg-ack", "lane-client", "lane-server"]) assert.ok(layout.targets[id], id);
});

test("edges between the same two nodes bend apart; a lone edge stays straight", () => {
  assert.deepEqual(edgeBends([{ from: "a", to: "b" }]), [0]);
  const [x, y] = edgeBends([{ from: "phone", to: "server" }, { from: "server", to: "phone" }]);
  assert.ok(x !== 0 && y !== 0 && Math.sign(x) !== Math.sign(y));
  assert.equal(new Set(edgeBends([{ from: "a", to: "b" }, { from: "b", to: "a" }, { from: "a", to: "b" }])).size, 3);
});

test("a definition is not maths: 'SYN = synchronise' stays text, arithmetic is typeset with its acronym upright", () => {
  assert.equal(noteTex("SYN = synchronise"), null);
  assert.equal(noteTex("ISN = 32-bit random number"), null);
  assert.equal(noteTex("SYN-ACK = request + confirm"), null);
  assert.equal(noteTex("Server ISN = 2000"), null);
  assert.equal(noteTex("ACK = 1000 + 1 = 1001", { acronyms: true }), String.raw`\text{ACK} = 1000 + 1 = 1001`);
  assert.ok(noteTex("x² + 2x − 3 = 0"));
});

test("TCP is a message exchange drawn as a sequence, not DSA; Raft keeps its machine graph", () => {
  assert.equal(isTypedDsaTopic("TCP three way handshake"), false);
  assert.equal(isTypedDsaTopic("How DNS resolution works"), false);
  assert.equal(isTypedDsaTopic("Raft consensus leader election"), true);
  assert.match(csPlanRule("TCP three way handshake")!, /"sequence" board/);
  assert.equal(csMechanismStage("TCP three way handshake", "The client sends SYN to the server. The server replies with SYN-ACK."), "sequence");
  assert.equal(csMechanismStage("TCP three way handshake", "Both sides agree a window size and an MSS. A SYN flood sends many SYN packets."), null, "a board that only mentions messages is not a sequence");
  assert.equal(csMechanismStage("TCP three way handshake", "Why reliable delivery matters to a client."), null, "one word in passing is not an exchange");
  assert.equal(csMechanismStage("Raft consensus leader election", "Server B sends a vote request."), "structure");
});

function beat(id: string, title: string, stage: CanvasStage, script: string): CanvasPlanBeat {
  return { id, title, script, stage, brief: title, objects: [], inside: null, carry: [], interaction: "quiz", overview: false };
}

test("the plan's two-machine graph of a handshake becomes a sequence board", () => {
  const out = applyLessonVisualPolicy([
    beat("b1", "The questions", "flow", "We ask how two devices start talking."),
    beat("b2", "The three messages", "structure", "The client sends SYN to the server. The server replies with SYN-ACK. The client sends ACK."),
    beat("b3", "Connection states", "sketch", "The server waits in LISTEN. The client sends SYN and is in SYN-SENT. The server replies with SYN-ACK and is in SYN-RECEIVED."),
    beat("b4", "Window size and MSS", "flow", "Once the connection is open, both sides agree a window size. The MSS limits each segment; a SYN carries it."),
  ], { mode: "prompt", topic: "TCP three way handshake", domain: "cs" });
  assert.equal(out.beats[1].stage, "sequence");
  assert.equal(out.beats[2].stage, "sequence");
  assert.notEqual(out.beats[3].stage, "sequence", "explaining limits is not an exchange");
  assert.notEqual(out.beats[0].stage, "sequence", "the opening map is not a sequence");
});

test("labels written inside a box stay inside it (the NoSQL document's fields), never across its edge", () => {
  const spec = validateCanvasSpec({
    heading: "NoSQL", notes: [], cues: [],
    stage: { kind: "sketch", items: [{ id: "document", s: 0, at: { x: 5, y: 1, w: 5, h: 3 }, type: "shapes", grid: { w: 8, h: 4 }, shapes: [
      { id: "frame", kind: "rect", s: 0, x: 0.3, y: 0.3, w: 7.2, h: 3.2, label: "post", color: "blue", fill: true },
      { id: "f1", kind: "label", s: 0, x: 1, y: 1.1, label: "text: Hello!" },
      { id: "f2", kind: "label", s: 0, x: 1, y: 1.9, label: "reactions: 12" },
      { id: "f3", kind: "label", s: 0, x: 1, y: 2.7, label: "image: photo.jpg" },
    ] }] },
  }, 3)!;
  const sketch = layoutPanel(spec).marks.find((m) => m.type === "sketch");
  assert.ok(sketch && sketch.type === "sketch");
  const shapes = (sketch.items[0].item as { shapes: Array<{ id: string; labelAt?: { x: number; y: number; size: number } }> }).shapes;
  for (const id of ["f1", "f2", "f3"]) {
    const at = shapes.find((s) => s.id === id)?.labelAt;
    assert.ok(at, id);
    // The label's centre is inside the frame, well clear of its left edge (0.3).
    assert.ok(at.x > 1 && at.x < 7.5 && at.y > 0.3 && at.y < 3.5, `${id} at ${at.x},${at.y}`);
  }
});

test("'How X works' asks for a lesson like 'How does X work?' (the 3-board TLS, paging, RSA and backprop lectures)", async () => {
  const { isCsMechanismQuestion } = await import("../canvas/csLessons");
  for (const q of ["How the TLS handshake works in HTTPS", "How paging and virtual memory work", "How RSA encryption works", "How backpropagation trains a neural network"]) assert.equal(isCsMechanismQuestion(q, true), true, q);
  assert.equal(isCsMechanismQuestion("How many bits are in an IPv4 address", true), false);
  assert.equal(isCsMechanismQuestion("Why does my code throw an error on line 3", true), false);
});

test("TLS's own message names fit, and a refused sequence says why", async () => {
  const { takeSequenceProblem } = await import("../canvas/sequence");
  const tls = validateSequenceStage({ lanes: [{ id: "client", label: "Client" }, { id: "server", label: "Server" }], messages: [
    { from: "client", to: "server", label: "ClientHello", detail: "key_share, cipher suites", s: 0 },
    { from: "server", to: "client", label: "ServerHello", detail: "key_share", s: 1 },
    { from: "server", to: "client", label: "EncryptedExtensions", s: 2 },
    { from: "server", to: "client", label: "Certificate", s: 2 },
    { from: "server", to: "client", label: "CertificateVerify", detail: "signature", s: 3 },
    { from: "server", to: "client", label: "Finished", s: 4 },
    { from: "client", to: "server", label: "Finished", s: 5 },
  ] }, sentence, unique);
  assert.ok(tls, takeSequenceProblem());
  assert.deepEqual(sequenceOverlaps(sequenceGeometry(tls!, NARROW, textWidth)), []);
  assert.equal(validateSequenceStage({ lanes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], messages: [{ from: "a", to: "c", label: "x", s: 0 }] }, sentence, unique), null);
  assert.match(takeSequenceProblem(), /two different lane ids \(a, b\)/);
});

test("an edge whose line runs through another node bends around it (the bipartite lecture's odd cycle)", async () => {
  const { edgeDetour } = await import("../canvas/structure");
  // B, C, D in one column: B–D runs straight through C.
  const B = { x: 100, y: 0 }, C = { x: 100, y: 100 }, D = { x: 100, y: 200 };
  assert.ok(Math.abs(edgeDetour(B, D, [C], 26)) > 2 * 26, "bends well clear of C");
  assert.equal(edgeDetour(B, C, [D], 26), 0, "an edge with nothing in the way stays straight");
  assert.equal(edgeDetour(B, D, [{ x: 300, y: 100 }], 26), 0);
});

test("a drawing written in the same place as an earlier one is drawn on it, never floated off alone", async () => {
  const { mergeSketchOverlays } = await import("../canvas/layout");
  const at = { x: 0, y: 0, w: 5, h: 7 };
  const stage = { kind: "sketch" as const, items: [
    { id: "graph", s: 0, at, type: "shapes" as const, grid: { w: 10, h: 14 }, shapes: [{ id: "a", kind: "circle" as const, s: 0, x: 2, y: 3, r: 1, label: "A" }] },
    { id: "rule", s: 3, at: { x: 1, y: 7, w: 5, h: 1 }, type: "text" as const, text: "K(m,n) has m × n edges" },
    { id: "missing", s: 4, at, type: "shapes" as const, grid: { w: 10, h: 14 }, shapes: [{ id: "a", kind: "line" as const, s: 4, points: [[3, 3], [7, 10]] as Array<[number, number]>, dashed: true }] },
  ] };
  const merged = mergeSketchOverlays(stage as never);
  assert.equal(merged.items.length, 2);
  const graph = merged.items[0] as { shapes: Array<{ id: string; s: number }> };
  assert.deepEqual(graph.shapes.map((sh) => sh.id), ["a", "missing-a"], "ids stay unique");
  assert.equal(graph.shapes[1].s, 4, "still drawn on its own sentence");
});
