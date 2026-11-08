// Systems: memory_hierarchy (sizes, latencies, a hit/miss walk), stack_vs_heap_memory (call stack
// frames during recursion), cpu_pipeline (5 stages over cycles, with a stall for a hazard) and
// osi_layers (encapsulation down, decapsulation up).
import { z } from "zod/v4";
import { defineTemplate, VisualError, type Result, type Step } from "../../contract";
import type { Board } from "../../board3d/board";

// ── memory_hierarchy ────────────────────────────────────────────────────────────────────────────
const LEVELS = [
  { name: "Registers", size: "~1 KB", latency: "~0.3 ns", cycles: 1 }, { name: "L1 cache", size: "~64 KB", latency: "~1 ns", cycles: 4 },
  { name: "L2 cache", size: "~1 MB", latency: "~4 ns", cycles: 12 }, { name: "L3 cache", size: "~32 MB", latency: "~15 ns", cycles: 40 },
  { name: "RAM", size: "~16 GB", latency: "~80 ns", cycles: 250 }, { name: "SSD", size: "~1 TB", latency: "~100 µs", cycles: 300000 },
];
export const memoryTemplate = defineTemplate({
  id: "memory_hierarchy", domain: "cs", family: "systems", title: "Memory hierarchy",
  topics: ["memory hierarchy", "cache", "cache hit", "cache miss", "latency", "registers", "ram"], schema: z.object({ hit_level: z.number().int().min(0).max(5).default(4).describe("Where the data is found: 0 registers … 5 SSD.") }),
  defaults: { hit_level: 4 }, narrationHints: ["Smaller memory is faster; bigger memory is slower.", "A miss means going further down, which costs much more time."],
  run(b, a): Result {
    b.clear();
    LEVELS.forEach((l, k) => b.box(`L${k}`, { at: [0, 0, 3 - k * 1.05], size: [1.6 + k * 0.9, 1.2, 0.8], color: "idle", label: `${l.name}  ${l.size}  ${l.latency}`, inside: true, opacity: 0.85 }));
    b.fit([[-3.5, 0, -2.8], [3.5, 0, 3.6]], "front");
    const steps: Step[] = LEVELS.slice(0, a.hit_level + 1).map((l, k) => ({
      caption: k < a.hit_level ? `${l.name}: miss (checked in ${l.latency}), look one level down` : `${l.name}: hit! The data is here (${l.latency}, about ${l.cycles.toLocaleString()} cycles)`,
      apply: async (bb, o) => { await bb.setColor(`L${k}`, k < a.hit_level ? "warn" : "done", o); },
    }));
    return { facts: { levels: LEVELS.map((l) => `${l.name}: ${l.size}, ${l.latency}`), found_in: LEVELS[a.hit_level].name, approx_cycles: LEVELS[a.hit_level].cycles }, steps, summary: `The data is found in ${LEVELS[a.hit_level].name} after ${a.hit_level} miss(es).` };
  },
  actions: {},
});

// ── stack_vs_heap_memory ────────────────────────────────────────────────────────────────────────
const SHArgs = z.object({ function: z.enum(["factorial", "fibonacci", "sum_to"]).default("factorial"), n: z.number().int().min(0).max(6).default(3) });
export function callTrace(fn: "factorial" | "fibonacci" | "sum_to", n: number) {
  const events: { t: "call" | "return"; label: string; depth: number; value?: number }[] = [];
  let maxDepth = 0;
  const go = (k: number, d: number): number => {
    maxDepth = Math.max(maxDepth, d + 1);
    events.push({ t: "call", label: `${fn}(${k})`, depth: d });
    const v = fn === "factorial" ? (k <= 1 ? 1 : k * go(k - 1, d + 1)) : fn === "sum_to" ? (k <= 0 ? 0 : k + go(k - 1, d + 1)) : k < 2 ? k : go(k - 1, d + 1) + go(k - 2, d + 1);
    events.push({ t: "return", label: `${fn}(${k})`, depth: d, value: v });
    return v;
  };
  const result = go(n, 0);
  return { events, result, maxDepth };
}
export const callStackTemplate = defineTemplate({
  id: "stack_vs_heap_memory", domain: "cs", family: "systems", title: "The call stack during recursion",
  topics: ["call stack", "stack frame", "recursion", "stack vs heap", "stack overflow"], schema: SHArgs, defaults: { function: "factorial", n: 3 },
  narrationHints: ["Every call pushes a frame; every return pops one.", "The deepest point is the base case."],
  run(b, a): Result {
    b.clear();
    const t = callTrace(a.function, a.n);
    if (t.events.length > 60) throw new VisualError("That recursion makes too many calls to show; try a smaller n.");
    b.label("stackL", { at: [0, 0, -0.9], text: "call stack (grows up)", color: "muted", small: true });
    b.box("heap", { at: [4, 0, 1.2], size: [2.2, 0.8, 3], color: "muted", opacity: 0.25, label: "heap: objects made with new", inside: true });
    b.fit([[-2, 0, -1.2], [5.3, 0, Math.max(3, t.maxDepth * 0.75)]], "front");
    const steps: Step[] = t.events.map((e) => ({
      caption: e.t === "call" ? `Call ${e.label}: push a new frame` : `${e.label} returns ${e.value}: pop its frame`,
      apply: async (bb, o) => {
        const id = `f${e.depth}`;
        if (e.t === "call") { bb.box(id, { at: [0, 0, e.depth * 0.72], size: [2.6, 0.8, 0.6], color: "active", label: e.label, inside: true }); for (let d = 0; d < e.depth; d++) if (bb.has(`f${d}`)) await bb.setColor(`f${d}`, "idle", { animate: false }); }
        else { if (bb.has(id)) { bb.setLabel(id, `${e.label} = ${e.value}`); await bb.setColor(id, "done", o); bb.remove(id); } if (e.depth > 0 && bb.has(`f${e.depth - 1}`)) await bb.setColor(`f${e.depth - 1}`, "active", { animate: false }); }
      },
    }));
    steps.push({ caption: `The stack is empty again: ${a.function}(${a.n}) = ${t.result}`, apply: (bb) => bb.label("answer", { at: [0, 0, 0.3], text: `${a.function}(${a.n}) = ${t.result}`, color: "done" }) });
    return { facts: { call: `${a.function}(${a.n})`, result: t.result, calls: t.events.length / 2, max_stack_depth: t.maxDepth }, steps, summary: `${a.function}(${a.n}) = ${t.result}; the stack gets ${t.maxDepth} frames deep.` };
  },
  actions: {},
});

// ── cpu_pipeline ────────────────────────────────────────────────────────────────────────────────
const STAGES = ["IF", "ID", "EX", "MEM", "WB"];
const PArgs = z.object({ instructions: z.array(z.string().max(16)).min(1).max(5).default(["add r1,r2,r3", "sub r4,r1,r5", "lw r6,0(r7)"]), stall_after: z.number().int().min(-1).max(4).default(-1).describe("Index of an instruction whose result the next one needs (a data hazard): the next one stalls a cycle. -1 = no hazard.") });
export function schedule(n: number, stallAfter: number) {
  const start: number[] = [];
  for (let i = 0; i < n; i++) start.push(i === 0 ? 0 : start[i - 1] + 1 + (stallAfter >= 0 && i === stallAfter + 1 ? 1 : 0));
  return { start, cycles: start[n - 1] + STAGES.length };
}
export const pipelineTemplate = defineTemplate({
  id: "cpu_pipeline", domain: "cs", family: "systems", title: "CPU pipeline",
  topics: ["cpu pipeline", "pipelining", "fetch decode execute", "hazard", "stall"], schema: PArgs, defaults: { instructions: ["add r1,r2,r3", "sub r4,r1,r5", "lw r6,0(r7)"], stall_after: 0 },
  narrationHints: ["Each instruction moves one stage per cycle.", "Several instructions are in flight at once.", "A hazard forces a stall (a bubble)."],
  run(b, a): Result {
    b.clear();
    const s = schedule(a.instructions.length, a.stall_after), W = 1.05;
    a.instructions.forEach((ins, i) => b.label(`ins${i}`, { at: [-3.4, 0, 2 - i * 0.9], text: ins, color: "text", small: true }));
    for (let c = 0; c < s.cycles; c++) b.label(`cyc${c}`, { at: [-1.8 + c * W, 0, 2.8], text: `c${c + 1}`, color: "muted", small: true });
    b.fit([[-4.5, 0, 2 - a.instructions.length * 0.9], [-1.8 + s.cycles * W, 0, 3.2]], "front");
    const steps: Step[] = Array.from({ length: s.cycles }, (_, c) => ({
      caption: `Cycle ${c + 1}: ${a.instructions.map((ins, i) => { const st = c - s.start[i]; return st >= 0 && st < 5 ? `${ins.split(" ")[0]} in ${STAGES[st]}` : ""; }).filter(Boolean).join(", ") || "bubble"}`,
      apply: (bb) => a.instructions.forEach((_, i) => { const st = c - s.start[i]; if (st >= 0 && st < 5) bb.box(`c${i}_${c}`, { at: [-1.8 + c * W, 0, 2 - i * 0.9], size: [0.95, 0.5, 0.7], color: ["accent", "active", "done", "idle", "muted"][st] as "accent", label: STAGES[st], inside: true }); else if (a.stall_after >= 0 && i === a.stall_after + 1 && c === s.start[i] - 1) bb.box(`c${i}_${c}`, { at: [-1.8 + c * W, 0, 2 - i * 0.9], size: [0.95, 0.5, 0.7], color: "warn", label: "stall", inside: true }); }),
    }));
    return { facts: { stages: STAGES, instructions: a.instructions.length, total_cycles: s.cycles, without_pipelining: a.instructions.length * 5, stalls: a.stall_after >= 0 && a.stall_after < a.instructions.length - 1 ? 1 : 0 }, steps, summary: `${a.instructions.length} instructions take ${s.cycles} cycles pipelined (vs ${a.instructions.length * 5} one at a time).` };
  },
  actions: {},
});

// ── osi_layers ──────────────────────────────────────────────────────────────────────────────────
const OSI = [["7", "Application", "data"], ["6", "Presentation", "data"], ["5", "Session", "data"], ["4", "Transport", "segment (TCP header)"], ["3", "Network", "packet (IP header)"], ["2", "Data link", "frame (MAC header + trailer)"], ["1", "Physical", "bits"]];
export const osiTemplate = defineTemplate({
  id: "osi_layers", domain: "cs", family: "networking", title: "OSI layers and encapsulation",
  topics: ["osi model", "osi layers", "encapsulation", "protocol stack", "network layers"], schema: z.object({ direction: z.enum(["send", "receive"]).default("send") }), defaults: { direction: "send" },
  narrationHints: ["Going down, each layer wraps the data in its own header.", "Going up, each layer removes its header."],
  run(b, a): Result {
    b.clear();
    OSI.forEach(([n, name], k) => b.box(`L${n}`, { at: [0, 0, 3 - k * 0.85], size: [4.2, 1, 0.65], color: "idle", label: `${n}  ${name}`, inside: true, opacity: 0.85 }));
    b.fit([[-3, 0, -2.6], [3, 0, 3.6]], "front");
    const order = a.direction === "send" ? OSI : [...OSI].reverse();
    const steps: Step[] = order.map(([n, name, pdu]) => ({ caption: a.direction === "send" ? `${name}: the unit is now a ${pdu}` : `${name}: remove this layer's header (${pdu})`, apply: async (bb, o) => { await bb.setColor(`L${n}`, "done", o); } }));
    return { facts: { layers: OSI.map(([n, name]) => `${n} ${name}`), direction: a.direction, units: { transport: "segment", network: "packet", data_link: "frame", physical: "bits" } }, steps, summary: a.direction === "send" ? "Data goes down the 7 layers, gaining a header at each." : "Data comes up the 7 layers, losing a header at each." };
  },
  actions: {},
});
