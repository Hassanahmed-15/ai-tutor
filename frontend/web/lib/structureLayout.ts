/**
 * Turns a StructureSpec into geometry, using ELK rather than the model.
 *
 * This is the half of the design that makes the boards precise. ELK is a mature, deterministic
 * graph-layout engine (the same class of tool Mermaid and friends delegate to); it decides node
 * positions and routes every edge around obstacles. Because nothing here comes from the model, a
 * label cannot land at y=-31 and two boxes cannot occupy the same space — those outcomes are not
 * reachable, rather than being caught by a critic afterwards.
 *
 * elkjs is used instead of Mermaid deliberately: it is pure JavaScript with no headless browser,
 * and it takes structured input rather than a whitespace-sensitive DSL where a single stray
 * character fails the whole parse.
 *
 * Everything is scaled into the board's existing 1000x560 frame so this renders in the same space
 * as every other board type.
 */

import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import type { StructureSpec } from "./structureSpec";

export const BOARD_W = 1000;
export const BOARD_H = 560;
/** Keeps the drawing clear of the frame edge and of LiveSketch's corner furniture. */
const PADDING = 56;

export type LaidOutNode = { id: string; label: string; x: number; y: number; w: number; h: number };
export type LaidOutEdge = { from: string; to: string; label?: string; points: Array<{ x: number; y: number }> };
export type StructureLayout = { nodes: LaidOutNode[]; edges: LaidOutEdge[] };

/** Node box sized from its text so ELK reserves real space — the estimate mirrors the one the
 *  board prompts use (width ≈ 0.62 * fontSize * chars) at the 20px label size below. */
function boxFor(label: string): { width: number; height: number } {
  const width = Math.max(96, Math.min(230, 0.62 * 20 * label.length + 34));
  return { width, height: 58 };
}

/**
 * `layered` is the right default: it produces the left-to-right/top-to-bottom reading order a
 * process or state machine wants. A cycle gets extra spacing instead of a different algorithm —
 * `layered` handles the back-edge that closes the loop by routing it around, which reads better
 * than a force layout's arbitrary rotation.
 */
function elkGraphFor(spec: StructureSpec): ElkNode {
  const cyclic = spec.kind === "cycle";
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": spec.kind === "tree" ? "DOWN" : "RIGHT",
      "elk.spacing.nodeNode": cyclic ? "64" : "48",
      // Generous layer spacing because every edge carries a LABEL ("cools", "heat + pressure").
      // At the default the label had nowhere to sit and was drawn over the boxes it connects.
      "elk.layered.spacing.nodeNodeBetweenLayers": cyclic ? "150" : "130",
      "elk.spacing.edgeLabel": "12",
      "elk.edgeRouting": "POLYLINE",
      "elk.layered.mergeEdges": "true",
      // A five-stage chain lays out ~870x60: inherently wide and flat, so it stays a thin strip
      // across an otherwise empty board no matter how it is scaled (width is the binding
      // constraint, not height). Wrapping lets ELK break the chain into rows and fill the frame,
      // and the aspect ratio target is the board's own 1000x560.
      "elk.aspectRatio": String(BOARD_W / BOARD_H),
      "elk.layered.wrapping.strategy": "SINGLE_EDGE",
      "elk.layered.wrapping.additionalEdgeSpacing": "40",
    },
    children: spec.nodes.map((n) => ({ id: n.id, ...boxFor(n.label) })),
    edges: spec.edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  };
}

/**
 * A cycle is laid out AS A CIRCLE, not by ELK.
 *
 * ELK's layered algorithm turns a loop into a straight chain plus one long return edge, which
 * measured 874x46 on the rock cycle — a thin strip across an empty board that reads as a list
 * rather than as something that comes back round. Ring placement is trivial deterministic maths,
 * it fills the frame, and it makes the "cycle" claim visible, which is the whole point of the beat.
 */
function circularLayout(spec: StructureSpec): StructureLayout {
  const cx = BOARD_W / 2;
  const cy = BOARD_H / 2;
  const rx = BOARD_W / 2 - PADDING - 110;
  const ry = BOARD_H / 2 - PADDING - 34;
  const n = spec.nodes.length;

  const nodes: LaidOutNode[] = spec.nodes.map((node, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n; // first node at the top, then clockwise
    const { width, height } = boxFor(node.label);
    return {
      id: node.id,
      label: node.label,
      x: cx + rx * Math.cos(angle) - width / 2,
      y: cy + ry * Math.sin(angle) - height / 2,
      w: width,
      h: height,
    };
  });

  const byId = new Map(nodes.map((n2) => [n2.id, n2]));
  const edges: LaidOutEdge[] = spec.edges.map((e) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return { from: e.from, to: e.to, label: e.label, points: [] };
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    // Stop the arrow at each box's boundary so the head is visible instead of buried under the
    // destination node.
    return { from: e.from, to: e.to, label: e.label, points: [clipToBox(ac, bc, a), clipToBox(bc, ac, b)] };
  });

  return { nodes, edges };
}

/** Walks from `from` towards `to` and returns the point where it leaves `box`. */
function clipToBox(from: { x: number; y: number }, to: { x: number; y: number }, box: LaidOutNode) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const halfW = box.w / 2 + 6;
  const halfH = box.h / 2 + 6;
  const scaleX = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : halfH / Math.abs(dy);
  const t = Math.min(scaleX, scaleY);
  return { x: from.x + dx * t, y: from.y + dy * t };
}

/**
 * Computes the layout and scales it to fit the board.
 *
 * Returns null on any ELK failure rather than throwing, so a layout bug degrades to "this beat
 * falls back to its normal board" instead of breaking the lesson — the same contract the spec
 * validator and the Manim renderer already follow.
 */
export async function layoutStructure(spec: StructureSpec): Promise<StructureLayout | null> {
  if (spec.kind === "cycle") return circularLayout(spec);
  try {
    const elk = new ELK();
    const res = await elk.layout(elkGraphFor(spec));
    const children = res.children ?? [];
    if (children.length === 0) return null;

    // Fit ELK's box to the frame. A chain of five nodes comes back wide and flat (~870x60), so
    // refusing to scale UP left the diagram as a thin strip across the middle of an empty board.
    // Scaling to fill is what makes it read as a diagram rather than a caption; the upper clamp
    // stops a three-node graph from becoming cartoonish.
    const rawW = Math.max(1, res.width ?? 1);
    const rawH = Math.max(1, res.height ?? 1);
    const scale = Math.max(
      0.5,
      Math.min((BOARD_W - PADDING * 2) / rawW, (BOARD_H - PADDING * 2) / rawH, 2.2),
    );
    const offsetX = (BOARD_W - rawW * scale) / 2;
    const offsetY = (BOARD_H - rawH * scale) / 2;
    const tx = (x: number) => offsetX + x * scale;
    const ty = (y: number) => offsetY + y * scale;

    const labelFor = new Map(spec.nodes.map((n) => [n.id, n.label]));
    const nodes: LaidOutNode[] = children.map((c) => ({
      id: String(c.id),
      label: labelFor.get(String(c.id)) ?? String(c.id),
      x: tx(c.x ?? 0),
      y: ty(c.y ?? 0),
      w: (c.width ?? 120) * scale,
      h: (c.height ?? 58) * scale,
    }));

    const centre = new Map(nodes.map((n) => [n.id, { x: n.x + n.w / 2, y: n.y + n.h / 2 }]));
    const edges: LaidOutEdge[] = spec.edges.map((e, i) => {
      const routed = ((res.edges ?? []) as ElkExtendedEdge[]).find((r) => String(r.id) === `e${i}`);
      const section = routed?.sections?.[0];
      // Prefer ELK's routed polyline; fall back to centre-to-centre only if a section is missing,
      // which keeps the arrow meaningful rather than dropping the relationship entirely.
      const points = section
        ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({
            x: tx(p.x),
            y: ty(p.y),
          }))
        : [centre.get(e.from), centre.get(e.to)].filter((p): p is { x: number; y: number } => !!p);
      return { from: e.from, to: e.to, label: e.label, points };
    });

    return { nodes, edges };
  } catch {
    return null;
  }
}
