import test from "node:test";
import assert from "node:assert/strict";
import { ganttGeometry, ganttOverlaps, mappingGeometry, mappingOverlaps, validateMappingStage, memoryGeometry, memoryOverlaps, osStageFor, statesGeometry, statesOverlaps, takeOsProblem, validateGanttStage, validateMemoryStage, validateStatesStage } from "../canvas/osDiagrams";
import { csPlanRule, isTypedDsaTopic, isTypedOsTopic } from "../canvas/csLessons";
import { layoutPanel, textWidth } from "../canvas/layout";
import { validateCanvasSpec } from "../canvas/validate";
import { applyLessonVisualPolicy } from "../canvas/visualPolicy";
import { OS_FIXTURES } from "../canvas/dsaFixtures";
import type { CanvasPlanBeat, CanvasStage, GanttStage, MemoryStage, StatesStage } from "../canvas/types";

const sentence = (v: unknown, f = 0) => (typeof v === "number" ? Math.max(0, Math.min(6, v)) : f);
const unique = (v: unknown) => String(v);
const STAGE = { x: 352, y: 108, w: 612, h: 424 };

// The multithreading lecture (owner, 2026-10-25): an OS lesson was classed as data structures.
test("an operating-systems lesson is not a data-structures lesson, and gets the OS pictures", () => {
  for (const t of ["Multithreading in OS", "CPU scheduling round robin", "Mutex vs semaphore", "Virtual memory and paging", "Deadlock detection with resource allocation graphs"]) {
    assert.equal(isTypedDsaTopic(t), false, t);
    assert.equal(isTypedOsTopic(t), true, t);
    assert.match(csPlanRule(t) ?? "", /OPERATING-SYSTEMS LESSON/, t);
  }
  // DSA and networking are unchanged.
  assert.equal(isTypedDsaTopic("Union-Find with path compression"), true);
  assert.equal(isTypedDsaTopic("Raft consensus leader election"), true);
  assert.equal(isTypedOsTopic("TCP three way handshake"), false);
  assert.match(csPlanRule("TCP three way handshake") ?? "", /"sequence" board/);
});

test("each OS board gets the picture its words call for", () => {
  assert.equal(osStageFor("Thread states guide scheduling: new, runnable, waiting and terminated, and the transitions between them"), "states");
  assert.equal(osStageFor("Processes and threads share differently: each thread has its own stack and registers but shares the address space"), "memory");
  assert.equal(osStageFor("Round robin with a time quantum of 2 ms: P1, P2 and P3 take turns"), "gantt");
  assert.equal(osStageFor("A race condition: T1 and T2 both read the shared counter and one increment is lost"), "sequence");
  assert.equal(osStageFor("Multithreading improves responsiveness"), null);
});

test("a lifecycle validates, keeps each state in its own cell, and only lets a process move along an arrow", () => {
  const raw = (OS_FIXTURES.find((f) => f.id === "process-states")!.raw as { stage: Record<string, unknown> }).stage;
  const st = validateStatesStage(raw, sentence, unique)!;
  assert.ok(st);
  assert.equal(st.states.length, 5);
  assert.equal(new Set(st.states.map((s) => `${s.col},${s.row}`)).size, 5);
  // Two states asking for the same cell are moved apart.
  const crowded = validateStatesStage({ states: [{ id: "a", label: "Ready", col: 1, row: 1 }, { id: "b", label: "Running", col: 1, row: 1 }], transitions: [{ from: "a", to: "b", label: "dispatch" }] }, sentence, unique)!;
  assert.notDeepEqual([crowded.states[0].col, crowded.states[0].row], [crowded.states[1].col, crowded.states[1].row]);
  // A process that jumps where no arrow goes loses its chip; the diagram itself is kept.
  const jumpy = validateStatesStage({ states: [{ id: "new", label: "New" }, { id: "ready", label: "Ready" }, { id: "running", label: "Running" }], transitions: [{ from: "new", to: "ready", label: "admitted" }], tokens: [{ label: "P1", path: [{ state: "new", s: 0 }, { state: "running", s: 1 }] }] }, sentence, unique);
  assert.ok(jumpy);
  assert.equal(jumpy!.tokens, undefined);
});

test("the textbook process diagram lays out with every arrow on its ovals and no label on a state", () => {
  const raw = (OS_FIXTURES.find((f) => f.id === "process-states")!.raw as { stage: Record<string, unknown> }).stage;
  const st = validateStatesStage(raw, sentence, unique) as StatesStage;
  const g = statesGeometry(st, STAGE, textWidth);
  assert.deepEqual(statesOverlaps(g), []);
  // Ready ⇄ Running bow apart: their curves' middles are on opposite sides.
  const there = g.transitions.find((t) => t.from === "ready" && t.to === "running")!;
  const back = g.transitions.find((t) => t.from === "running" && t.to === "ready")!;
  assert.ok(Math.abs(there.samples[6].y - back.samples[6].y) > 30);
  // Every arrow starts and ends on the edge of its states (within a few px).
  for (const t of g.transitions) {
    const a = g.states.find((s) => s.id === t.from)!, b = g.states.find((s) => s.id === t.to)!;
    const edge = (p: { x: number; y: number }, s: typeof a) => ((p.x - s.cx) / s.rx) ** 2 + ((p.y - s.cy) / s.ry) ** 2;
    assert.ok(Math.abs(edge(t.samples[0], a) - 1) < 0.2, `${t.id} starts on ${a.label}`);
    assert.ok(Math.abs(edge(t.samples.at(-1)!, b) - 1) < 0.25, `${t.id} ends on ${b.label}`);
  }
  // P1 is drawn inside the state it is in.
  const p1 = g.tokens[0];
  const term = g.states.find((s) => s.id === "terminated")!;
  assert.ok(Math.abs(p1.stops.at(-1)!.x - term.cx) < 1 && p1.stops.at(-1)!.y > term.cy && p1.stops.at(-1)!.y < term.cy + term.ry);
});

test("an address space and a threads board lay out with every name in its block", () => {
  for (const id of ["address-space", "threads-share"]) {
    const raw = (OS_FIXTURES.find((f) => f.id === id)!.raw as { stage: Record<string, unknown> }).stage;
    const m = validateMemoryStage(raw, sentence, unique) as MemoryStage;
    assert.ok(m, id);
    const g = memoryGeometry(m, STAGE, textWidth);
    assert.deepEqual(memoryOverlaps(g, textWidth), [], id);
    for (const b of g.blocks) assert.ok(b.rect.x >= STAGE.x - 1 && b.rect.x + b.rect.w <= STAGE.x + STAGE.w + 1 && b.rect.y + b.rect.h <= STAGE.y + STAGE.h + 1, `${id}: ${b.label} inside the stage`);
  }
  const one = validateMemoryStage((OS_FIXTURES.find((f) => f.id === "address-space")!.raw as { stage: Record<string, unknown> }).stage, sentence, unique) as MemoryStage;
  const g = memoryGeometry(one, STAGE, textWidth);
  const stack = g.blocks.find((b) => b.id === "stack")!, heap = g.blocks.find((b) => b.id === "heap")!;
  assert.ok(stack.rect.y < heap.rect.y, "the stack is above the heap");
  const down = g.growth.find((a) => a.segment === "stack")!, up = g.growth.find((a) => a.segment === "heap")!;
  assert.ok(down.p1.y > down.p0.y && up.p1.y < up.p0.y, "the stack grows down, the heap up");
});

test("a schedule refuses overlapping slots and draws exact times", () => {
  assert.equal(validateGanttStage({ slots: [{ label: "P1", start: 0, end: 4 }, { label: "P2", start: 3, end: 6 }] }, sentence, unique), null);
  assert.match(takeOsProblem(), /overlap/);
  const raw = (OS_FIXTURES.find((f) => f.id === "round-robin")!.raw as { stage: Record<string, unknown> }).stage;
  const gs = validateGanttStage(raw, sentence, unique) as GanttStage;
  const g = ganttGeometry(gs, STAGE, textWidth);
  assert.deepEqual(ganttOverlaps(g, textWidth, STAGE), []);
  assert.deepEqual(g.ticks.map((t) => t.value), [0, 2, 4, 6, 7, 8]);
  // Widths are proportional to time: P1's 2 ms is twice its 1 ms.
  assert.ok(Math.abs(g.slots[0].rect.w - 2 * g.slots[3].rect.w) < 0.01);
  // The same process is the same colour in every slot.
  assert.equal(g.slots[0].color, g.slots[3].color);
});

test("every OS fixture validates as a board and lays out", () => {
  for (const f of OS_FIXTURES) {
    const spec = validateCanvasSpec(f.raw, f.script.split(/(?<=[.!?])\s+/).length);
    assert.ok(spec, f.id);
    assert.ok(layoutPanel(spec!).marks.length > 1, f.id);
  }
});

const beat = (id: string, stage: CanvasStage, title: string, brief: string, script = ""): CanvasPlanBeat => ({ id, title, brief, script: script || `${title}. ${brief}.`, stage, objects: [], carry: [], inside: null, interaction: null, overview: false } as unknown as CanvasPlanBeat);

test("the visual policy draws an OS lesson's boards with the OS pictures, and never keeps a free sketch", () => {
  const beats = [
    beat("b1", "flow", "The route through multithreading", "map of the lesson"),
    beat("b2", "structure", "Thread states guide scheduling", "new, runnable, waiting, terminated and the transitions"),
    beat("b3", "compare", "Processes and threads share differently", "threads share the address space but each has its own stack and registers"),
    beat("b4", "sketch", "Multithreading improves application behaviour", "a browser stays responsive"),
    beat("b5", "structure", "Synchronization", "a race condition: T1 and T2 read the shared counter, a mutex lock fixes it"),
  ];
  const { beats: out } = applyLessonVisualPolicy(beats, { mode: "prompt", topic: "Multithreading in OS", domain: "cs" });
  assert.deepEqual(out.map((b) => b.stage), ["flow", "states", "memory", "flow", "sequence"]);
});

// The second multithreading lecture (2026-10-25): producer–consumer became a "memory layout" of steps,
// and interleaved / blocked / simultaneous multithreading a message sequence.
test("producer–consumer is a sequence, hardware multithreading a Gantt chart, and 'share' alone is not memory", () => {
  assert.equal(osStageFor("A producer places items into a fixed buffer while a consumer removes them; a semaphore counts free slots and a mutex guards the buffer"), "sequence");
  assert.equal(osStageFor("Interleaved multithreading switches threads every cycle, blocked multithreading on a stall, and simultaneous multithreading issues both at once"), "gantt");
  assert.equal(osStageFor("Threads share data and keep private work"), null);
});

test("schedules compared on one axis: rows validate and lay out, each with its own ticks", () => {
  const raw = (OS_FIXTURES.find((f) => f.id === "hardware-multithreading")!.raw as { stage: Record<string, unknown> }).stage;
  const gs = validateGanttStage(raw, sentence, unique) as GanttStage;
  assert.deepEqual(gs.rows, ["Interleaved", "Blocked", "SMT"]);
  const g = ganttGeometry(gs, STAGE, textWidth);
  assert.equal(g.bars.length, 3);
  assert.ok(g.bars[0].rect.y < g.bars[1].rect.y && g.bars[1].rect.y < g.bars[2].rect.y);
  assert.deepEqual(ganttOverlaps(g, textWidth, STAGE), []);
  // A schedule under the writer's own key names is still read ("blocks", "from"/"to").
  const loose = validateGanttStage({ blocks: [{ process: "A", from: 0, to: 4 }, { process: "B", from: 4, duration: 3 }] }, sentence, unique);
  assert.equal(loose?.slots.length, 2);
  assert.equal(loose?.slots[1].end, 7);
});

// The third run (2026-10-25): "Processes isolate; threads share" mentioned a race condition once and became a sequence;
// six thread states beside the notes overlapped two labels; the threading models had no picture.
test("the planner's picture tag and the board's title decide before one passing word in the script", () => {
  const script = "A process has its own address space. Threads share code and data but keep their own stack and registers. Unsynchronized updates by two threads can cause a race condition with a lock missing.";
  assert.equal(osStageFor(script, "Processes isolate; threads share — address space, stack and registers"), "memory");
  assert.equal(osStageFor(script, "STATE DIAGRAM: New, Runnable, Running — Thread states"), "states");
  assert.equal(osStageFor("many-to-one, one-to-one and many-to-many", "Thread models map work to the kernel"), "mapping");
});

test("threading models lay out as mappings, and a six-state lifecycle gets the wide stage with no overlaps", () => {
  const models = OS_FIXTURES.find((f) => f.id === "threading-models")!;
  const spec = validateCanvasSpec(models.raw, 4)!;
  assert.equal(spec.stage.kind, "mapping");
  const lay = layoutPanel(spec);
  const m = lay.marks.find((k) => k.type === "os-mapping");
  assert.ok(m && m.type === "os-mapping");
  assert.deepEqual(mappingOverlaps(m.geometry, textWidth), []);
  assert.equal(m.geometry.links.length, 10);
  const six = OS_FIXTURES.find((f) => f.id === "thread-states")!;
  const sixSpec = validateCanvasSpec(six.raw, 7)!;
  const sm = layoutPanel(sixSpec).marks.find((k) => k.type === "os-states");
  assert.ok(sm && sm.type === "os-states");
  assert.ok(sm.rect.w > 800, "the wide stage");
  assert.deepEqual(statesOverlaps(sm.geometry), []);
  assert.equal(sm.geometry.tokens.length, 1);
});

// The owner, 2026-10-25: "there should not be free sketches for CS". Maths keeps them.
test("no CS lesson keeps a free sketch or free-hand figure; a maths lesson keeps its sketch", () => {
  for (const topic of ["Dijkstra's shortest path algorithm", "TCP three-way handshake", "Multithreading in OS"]) {
    const beats = [
      beat("b1", "flow", "The route", "map of the lesson"),
      beat("b2", "sketch", "Why it matters", "a real situation and why the idea helps"),
      beat("b3", "figure", "The idea drawn", "the idea as a picture"),
      beat("b4", "diagram", "Another view", "the idea from another side"),
    ];
    const { beats: out } = applyLessonVisualPolicy(beats, { mode: "prompt", topic, domain: "cs" });
    for (const b of out) assert.ok(!["sketch", "diagram"].includes(b.stage) && !(b.stage === "figure" && (!b.figure || b.figure === "drawn")), `${topic}: ${b.id} is ${b.stage}${b.figure ? ` (${b.figure})` : ""}`);
  }
  const maths = applyLessonVisualPolicy([beat("b1", "flow", "Plan", "map"), beat("b2", "sketch", "Completing the square", "x^2 + 6x + 5 written as (x + 3)^2 - 4, step by step")], { mode: "prompt", topic: "Completing the square", domain: "maths" });
  assert.equal(maths.beats[1].stage, "sketch");
});
