import { canvasSentences } from "./plan";
import type { CanvasBoardSpec, QuizInteraction } from "./types";

/**
 * THE KINDS OF CHECK CARD a board can have (owner, 2026-10-18: "more interactive cards") — the parts
 * that need no model: what on the board a hint can point at, which parts a student could tap, and an
 * order card built from a flow's own arrows. The written cards are in lib/canvas/checkCard.ts.
 */

/** The board's elements a hint or a replay can point the pen at: id, name and the sentence it appears on. */
export function boardElements(spec: CanvasBoardSpec): Array<{ id: string; name: string; s: number }> {
  const st = spec.stage as unknown as Record<string, unknown>;
  const out: Array<{ id: string; name: string; s: number }> = spec.notes.map((n) => ({ id: n.id, name: n.text, s: n.s }));
  for (const key of ["parts", "nodes", "items"]) {
    const list = Array.isArray(st[key]) ? (st[key] as Array<Record<string, unknown>>) : [];
    for (const x of list) {
      const name = typeof x.name === "string" ? x.name : typeof x.label === "string" ? x.label : "";
      if (typeof x.id === "string" && name) out.push({ id: x.id, name, s: typeof x.s === "number" ? x.s : 0 });
    }
  }
  return out;
}

/** The parts of the board's diagram a student could tap: a picture's or figure's named parts. */
export function tapParts(spec: CanvasBoardSpec): Array<{ id: string; name: string }> {
  const st = spec.stage;
  if (st.kind !== "figure" && st.kind !== "illustration" && st.kind !== "diagram") return [];
  const parts = (st as { parts?: Array<{ id: string; name: string }> }).parts ?? [];
  return parts.filter((p) => p.id && p.name);
}

/**
 * An ORDER card built from the board itself, no model needed: a flow whose arrows run through every
 * step, three to six of them. A cycle may be put in order from any step.
 */
export function orderCard(spec: CanvasBoardSpec, script: string): QuizInteraction | null {
  const st = spec.stage;
  if (st.kind !== "flow" || st.arrangement === "inputs-core-outputs" || st.nodes.length < 3 || st.nodes.length > 6) return null;
  const next = new Map(st.arrows.map((a) => [a.from, a.to]));
  const into = new Set(st.arrows.map((a) => a.to));
  const loop = st.arrangement === "cycle";
  const start = loop ? st.nodes[0] : st.nodes.find((n) => next.has(n.id) && !into.has(n.id));
  const order: typeof st.nodes = [];
  for (let at = start; at && !order.includes(at); at = st.nodes.find((n) => n.id === next.get(at!.id))) order.push(at);
  if (order.length !== st.nodes.length) return null;
  // Labels must tell the steps apart: two cards called "Enzyme" cannot be put in order.
  // Each step by the name its box ends the board with: a box that becomes something else ("Blood
  // wastes" turning into "Urine") shows its new name while the card is open (kidney test, 2026-10-18).
  const name = (n: (typeof order)[number]) => n.becomes?.label ?? n.label;
  if (new Set(order.map((n) => name(n).toLowerCase())).size !== order.length) return null;
  // Steps named only by their place ("First stage → Second stage → Outcomes") give the order away:
  // ordering them tests nothing (maths benchmark, 2026-10-21) — the board's written question is used.
  const ordinal = /^(?:(?:the\s+)?(?:first|second|third|fourth|next|final|last|1st|2nd|3rd)\s+(?:stage|step|part|draw|event|branch|level)s?|(?:stage|step|part)\s*\d+|outcomes?|results?|start|end|finish|input|output|answer)$/i;
  if (order.filter((n) => ordinal.test(name(n).trim())).length >= 2) return null;
  const sentences = canvasSentences(script);
  const words = order.map(name).join(" → ");
  return {
    kind: "quiz",
    mode: "order",
    question: `Put the steps of "${spec.heading}" in order${loop ? " (it goes round a loop)" : ""}.`,
    steps: order.map((n) => ({ id: n.id, text: name(n) })),
    ...(loop ? { loop: true } : {}),
    options: [
      { text: words, correct: true, feedback: "That's the order." },
      { text: "another order", correct: false, feedback: `Not quite — the order is ${words}.` },
    ],
    hint: { text: `It starts with "${name(order[0])}". What does that lead to?`, target: order[0].id },
    replay: { text: sentences[Math.min(sentences.length - 1, order[1].s)] ?? sentences[0] ?? "", target: order[1].id },
    check: true,
  };
}

