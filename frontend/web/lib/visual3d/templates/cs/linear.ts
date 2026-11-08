// Linear structures: array_memory (cells with indices and addresses), linked_list (singly/doubly,
// insert/delete/search), and stack / queue / deque in one template (push, pop, enqueue, dequeue…).
import { z } from "zod/v4";
import { defineTemplate, VisualError, type Result, type Step } from "../../contract.ts";
import type { Board, Vec3 } from "../../board3d/board.ts";
import { cells, cellX } from "../../board3d/helpers.ts";
import { IntKey } from "../shared.ts";

// ── array_memory ────────────────────────────────────────────────────────────────────────────────
const ArrArgs = z.object({ values: z.array(IntKey).min(1).max(12), base_address: z.number().int().min(0).max(1e6).default(1000), element_size: z.number().int().min(1).max(8).default(4).describe("Bytes per element.") });
type ArrA = z.infer<typeof ArrArgs>;
function arrScene(b: Board, a: ArrA): Result {
  b.clear();
  cells(b, "c", a.values.map(String), { under: (k) => `[${k}]`, over: (k) => `${a.base_address + k * a.element_size}` });
  b.label("cap", { at: [cellX(0, a.values.length) - 1.2, 0, 0.95], text: "address", color: "muted", small: true });
  b.fit([[cellX(0, a.values.length) - 1, 0, -1], [cellX(a.values.length - 1, a.values.length) + 1, 0, 1.4]], "front");
  b.state.arr = a;
  return { facts: { length: a.values.length, base_address: a.base_address, element_size: a.element_size, bytes: a.values.length * a.element_size }, steps: [], summary: `An array of ${a.values.length} elements, ${a.element_size} bytes each, starting at address ${a.base_address}.` };
}
export const arrayMemoryTemplate = defineTemplate({
  id: "array_memory", domain: "cs", family: "data_structures", title: "An array in memory",
  topics: ["array", "array index", "memory address", "contiguous memory"], schema: ArrArgs,
  defaults: { values: [7, 3, 9, 4, 1], base_address: 1000, element_size: 4 },
  narrationHints: ["Elements sit side by side in memory.", "address = base + index × size, so any index is one step away."],
  run: (b, a) => arrScene(b, a),
  actions: {
    access: { description: "Read the element at an index.", schema: z.object({ index: z.number().int() }), run(b, { index }) {
      const a = b.state.arr as ArrA;
      if (index < 0 || index >= a.values.length) throw new VisualError(`Index ${index} is out of range: valid indices are 0 to ${a.values.length - 1}.`);
      const addr = a.base_address + index * a.element_size;
      return { facts: { index, value: a.values[index], address: addr }, steps: [{ caption: `address = ${a.base_address} + ${index} × ${a.element_size} = ${addr}: the value is ${a.values[index]}`, apply: async (bb, o) => { await bb.setColor(`c${index}`, "active", o); await bb.pulse(`c${index}`, o); } }], summary: `a[${index}] = ${a.values[index]}, at address ${addr}.` };
    } },
    set: { description: "Write a value at an index.", schema: z.object({ index: z.number().int(), value: IntKey }), run(b, { index, value }) {
      const a = b.state.arr as ArrA;
      if (index < 0 || index >= a.values.length) throw new VisualError(`Index ${index} is out of range: valid indices are 0 to ${a.values.length - 1}.`);
      const values = a.values.map((v, k) => (k === index ? value : v));
      return { ...arrScene(b, { ...a, values }), steps: [{ caption: `a[${index}] = ${value}`, apply: async (bb, o) => { await bb.setColor(`c${index}`, "done", o); } }] };
    } },
  },
});

// ── linked_list ─────────────────────────────────────────────────────────────────────────────────
const LLArgs = z.object({ values: z.array(IntKey).max(10), doubly: z.boolean().default(false) });
type LLA = z.infer<typeof LLArgs>;
const nodeAt = (k: number, n: number): Vec3 => [cellX(k, Math.max(n, 1), 1.9), 0, 0];
function llScene(b: Board, a: LLA, highlight?: number): Result {
  b.clear();
  const n = a.values.length;
  b.label("head", { at: [nodeAt(0, n)[0], 0, 0.85], text: n ? "head" : "head → null", color: "muted", small: true });
  a.values.forEach((v, k) => {
    b.box(`n${k}`, { at: nodeAt(k, n), size: [1.1, 0.6, 0.6], color: k === highlight ? "done" : "idle", label: String(v), inside: true });
    const p = nodeAt(k, n), q = nodeAt(k + 1, n);
    if (k < n - 1) b.arrow(`nx${k}`, { from: [p[0] + 0.58, 0, a.doubly ? 0.1 : 0], to: [q[0] - 0.6, 0, a.doubly ? 0.1 : 0], color: "accent", width: 0.025 });
    if (a.doubly && k < n - 1) b.arrow(`pv${k}`, { from: [q[0] - 0.58, 0, -0.12], to: [p[0] + 0.6, 0, -0.12], color: "active", width: 0.02 });
  });
  if (n) b.label("null", { at: [nodeAt(n - 1, n)[0] + 1.3, 0, 0], text: "null", color: "muted", small: true });
  b.fit([[nodeAt(0, n)[0] - 1.2, 0, -0.8], [nodeAt(n - 1, n)[0] + 1.6, 0, 1.1]], "front");
  b.state.ll = a;
  return { facts: { length: n, values: a.values, kind: a.doubly ? "doubly linked" : "singly linked" }, steps: [], summary: `A ${a.doubly ? "doubly" : "singly"} linked list: ${a.values.join(" → ") || "empty"}.` };
}
const walk = (k: number): Step[] => Array.from({ length: k }, (_, i) => ({ caption: `Follow next to node ${i + 1}`, apply: async (bb, o) => { await bb.setColor(`n${i}`, "active", o); } }));
export const linkedListTemplate = defineTemplate({
  id: "linked_list", domain: "cs", family: "data_structures", title: "Linked list",
  topics: ["linked list", "singly linked", "doubly linked", "next pointer", "node"], schema: LLArgs,
  defaults: { values: [3, 8, 5, 12], doubly: false }, narrationHints: ["Each node points to the next one.", "Inserting at a known node is quick; finding the node means walking from the head."],
  run: (b, a) => llScene(b, a),
  actions: {
    insert: { description: "Insert a value at a position (0 = front).", schema: z.object({ value: IntKey, index: z.number().int().min(0) }), run(b, { value, index }) {
      const a = b.state.ll as LLA;
      if (a.values.length >= 10) throw new VisualError("The list is full (10 nodes) for this board.");
      if (index > a.values.length) throw new VisualError(`Position ${index} is past the end (the list has ${a.values.length} nodes).`);
      const steps = walk(index);
      const values = [...a.values.slice(0, index), value, ...a.values.slice(index)];
      steps.push({ caption: index === 0 ? `New node ${value} points to the old head; head now points to it` : `New node ${value}: point it at the next node, then re-point node ${index - 1}`, apply: (bb) => { llScene(bb, { ...a, values }, index); } });
      return { facts: { inserted: value, index, values, steps_walked: index }, steps, summary: `Insert ${value} at position ${index}.` };
    } },
    delete: { description: "Delete the node at a position.", schema: z.object({ index: z.number().int().min(0) }), run(b, { index }) {
      const a = b.state.ll as LLA;
      if (!a.values.length) throw new VisualError("The list is empty: nothing to delete.");
      if (index >= a.values.length) throw new VisualError(`There is no node at position ${index} (the list has ${a.values.length}).`);
      const removed = a.values[index], values = a.values.filter((_, k) => k !== index);
      const steps = walk(index);
      steps.push({ caption: `Unlink ${removed}: its previous node now points past it`, apply: async (bb, o) => { await bb.setColor(`n${index}`, "warn", o); } }, { caption: `The list is now ${values.join(" → ") || "empty"}`, apply: (bb) => { llScene(bb, { ...a, values }); } });
      return { facts: { deleted: removed, index, values }, steps, summary: `Delete ${removed} from position ${index}.` };
    } },
    search: { description: "Find a value, walking from the head.", schema: z.object({ value: IntKey }), run(b, { value }) {
      const a = b.state.ll as LLA, at = a.values.indexOf(value);
      const steps = walk(at < 0 ? a.values.length : at + 1);
      steps.push({ caption: at < 0 ? `Reached null: ${value} is not in the list` : `Found ${value} at position ${at}`, apply: async (bb, o) => { if (at >= 0) await bb.setColor(`n${at}`, "done", o); } });
      return { facts: { value, found: at >= 0, index: at, nodes_visited: at < 0 ? a.values.length : at + 1 }, steps, summary: at < 0 ? `${value} is not in the list.` : `${value} is at position ${at}.` };
    } },
  },
});

// ── stack / queue / deque ───────────────────────────────────────────────────────────────────────
const SQArgs = z.object({ kind: z.enum(["stack", "queue", "deque"]).default("stack"), values: z.array(IntKey).max(10).default([]) });
type SQA = z.infer<typeof SQArgs>;
const MAX = 10;
function sqScene(b: Board, a: SQA, mark?: { index: number; color: "done" | "warn" }): Result {
  b.clear();
  const n = a.values.length, stack = a.kind === "stack";
  a.values.forEach((v, k) => b.box(`s${k}`, { at: stack ? [0, 0, k * 0.68] : [cellX(k, Math.max(n, 1)), 0, 0], size: stack ? [1.4, 0.8, 0.6] : [1.0, 0.8, 0.6], color: mark?.index === k ? mark.color : "idle", label: String(v), inside: true }));
  if (stack) b.label("top", { at: [1.3, 0, Math.max(0, n - 1) * 0.68], text: n ? "← top" : "empty", color: "active", small: true });
  else if (n) {
    b.label("front", { at: [cellX(0, n), 0, -0.75], text: "front", color: "active", small: true });
    b.label("back", { at: [cellX(n - 1, n), 0, -0.75], text: "back", color: "accent", small: true });
  } else b.label("empty", { at: [0, 0, 0], text: "empty", color: "muted" });
  b.fit(stack ? [[-1.5, 0, -0.5], [1.8, 0, Math.max(3, n * 0.7)]] : [[cellX(0, Math.max(n, 3)) - 1, 0, -1], [cellX(Math.max(n, 3) - 1, Math.max(n, 3)) + 1, 0, 1]], "front");
  b.state.sq = a;
  return { facts: { kind: a.kind, size: n, values: a.values, ...(stack ? { top: a.values[n - 1] ?? null } : { front: a.values[0] ?? null, back: a.values[n - 1] ?? null }) }, steps: [], summary: `A ${a.kind} with ${n} item${n === 1 ? "" : "s"}${n ? `: ${a.values.join(", ")}` : ""}.` };
}
type Op = "push" | "pop" | "peek" | "enqueue" | "dequeue" | "push_front" | "push_back" | "pop_front" | "pop_back";
const ALLOWED: Record<SQA["kind"], Op[]> = { stack: ["push", "pop", "peek"], queue: ["enqueue", "dequeue", "peek"], deque: ["push_front", "push_back", "pop_front", "pop_back", "peek"] };
function sqOp(b: Board, op: Op, value?: number): Result {
  const a = b.state.sq as SQA;
  if (!ALLOWED[a.kind].includes(op)) throw new VisualError(`A ${a.kind} does not ${op.replace("_", " ")}; it can ${ALLOWED[a.kind].join(", ")}.`);
  const v = [...a.values];
  const adds = op === "push" || op === "enqueue" || op === "push_back" || op === "push_front";
  if (adds && value === undefined) throw new VisualError(`${op} needs a value.`);
  if (adds && v.length >= MAX) throw new VisualError(`Overflow: the ${a.kind} is full (${MAX} items).`);
  if (!adds && !v.length) throw new VisualError(`Underflow: the ${a.kind} is empty, so there is nothing to ${op === "peek" ? "look at" : "remove"}.`);
  let out: number | undefined, where = 0;
  if (op === "push" || op === "enqueue" || op === "push_back") (v.push(value!), (where = v.length - 1));
  else if (op === "push_front") v.unshift(value!);
  else if (op === "pop" || op === "pop_back") out = v.pop();
  else if (op === "dequeue" || op === "pop_front") out = v.shift();
  else (out = a.kind === "stack" ? v[v.length - 1] : v[0]), (where = a.kind === "stack" ? v.length - 1 : 0);
  const caption = adds ? `${op.replace("_", " ")} ${value}` : op === "peek" ? `peek: ${out} is at the ${a.kind === "stack" ? "top" : "front"}` : `${op.replace("_", " ")} → ${out}`;
  const steps: Step[] = [{ caption, apply: (bb) => { sqScene(bb, { ...a, values: v }, adds || op === "peek" ? { index: where, color: "done" } : undefined); } }];
  return { facts: { operation: op, ...(out !== undefined ? { returned: out } : {}), size: v.length, values: v }, steps, summary: caption };
}
export const stackTemplate = defineTemplate({
  id: "stack", domain: "cs", family: "data_structures", title: "Stack, queue and deque",
  topics: ["stack", "queue", "deque", "push", "pop", "enqueue", "dequeue", "lifo", "fifo"], schema: SQArgs,
  defaults: { kind: "stack", values: [4, 7, 2] }, narrationHints: ["A stack is last in, first out.", "A queue is first in, first out."],
  run: (b, a) => sqScene(b, a),
  actions: Object.fromEntries((["push", "pop", "peek", "enqueue", "dequeue", "push_front", "push_back", "pop_front", "pop_back"] as Op[]).map((op) => [op, {
    description: `${op.replace("_", " ")}${["push", "enqueue", "push_front", "push_back"].includes(op) ? " a value" : ""}.`,
    schema: ["push", "enqueue", "push_front", "push_back"].includes(op) ? z.object({ value: IntKey }) : z.object({}),
    run: (b: Board, args: { value?: number }) => sqOp(b, op, args.value),
  }])),
});
