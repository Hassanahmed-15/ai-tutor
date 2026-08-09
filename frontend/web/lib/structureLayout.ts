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

export type LaidOutNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The label broken into the lines the board must draw — at most two. */
  lines: string[];
  /** The size those lines must be drawn at for the text to sit inside the box. */
  fontSize: number;
};
export type LaidOutEdge = { from: string; to: string; label?: string; points: Array<{ x: number; y: number }> };
export type StructureLayout = { nodes: LaidOutNode[]; edges: LaidOutEdge[] };

/** The size a label is drawn at when it fits comfortably; shrunk per node when it does not. */
export const NODE_FONT = 20;
/** Clear space between the text and the box edge, on each side. */
const LABEL_PADDING = 18;
/** A single line wider than this gets wrapped rather than allowed to stretch the board. */
const MAX_LINE_W = 260;

/**
 * Measures text the way it will actually be drawn.
 *
 * The old code guessed `0.62 * fontSize * chars` and then CLAMPED the result to 230px, while the
 * board drew every label at a fixed 20px — so "Right Left Grandchild" asked for 294px, got 230,
 * and spilled out of both sides of its box. A canvas measurement is exact and costs nothing.
 *
 * The estimate survives as a fallback because `layoutStructure` also runs server-side (the vision
 * critics rasterise boards in Node), where there is no DOM to measure with.
 */
let measureContext: CanvasRenderingContext2D | null | undefined;
export function measureLabel(text: string, fontSize: number): number {
  if (measureContext === undefined) {
    measureContext =
      typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  if (!measureContext) return 0.62 * fontSize * text.length;
  measureContext.font = `700 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  return measureContext.measureText(text).width;
}

/**
 * Breaks a label onto at most two lines, at the most balanced space.
 *
 * Two lines and no more: a three-line node box is taller than the rows ELK allots and starts
 * colliding with its own edges, and a label that long is a sentence someone should have shortened.
 */
export function wrapLabel(label: string, fontSize: number): string[] {
  if (measureLabel(label, fontSize) <= MAX_LINE_W) return [label];

  const words = label.split(/\s+/).filter(Boolean);
  if (words.length < 2) return [label];

  let best: [string, string] | null = null;
  let bestDelta = Infinity;
  for (let split = 1; split < words.length; split++) {
    const a = words.slice(0, split).join(" ");
    const b = words.slice(split).join(" ");
    const delta = Math.abs(measureLabel(a, fontSize) - measureLabel(b, fontSize));
    if (delta < bestDelta) {
      bestDelta = delta;
      best = [a, b];
    }
  }
  return best ?? [label];
}

/**
 * The node box, sized to hold its measured text.
 *
 * ELK reserves exactly this space, so the geometry it computes already accounts for the words —
 * which is what makes "overlap and clipping are unreachable" a true claim rather than an aspiration.
 */
export function boxFor(label: string): { width: number; height: number; lines: string[] } {
  const lines = wrapLabel(label, NODE_FONT);
  const widest = Math.max(...lines.map((line) => measureLabel(line, NODE_FONT)));
  return {
    width: Math.max(96, Math.min(340, widest + LABEL_PADDING * 2)),
    height: lines.length > 1 ? 78 : 58,
    lines,
  };
}

/**
 * The font size at which `lines` fit inside a box of `w` x `h`.
 *
 * The last line of defence, and the one that was missing entirely: `layoutStructure` scales every
 * box by `scale` to fit the frame, but the label was drawn at a constant 20px, so ANY layout that
 * had to shrink guaranteed overflow. Scaling type with geometry fixes the common case; capping
 * against the final box makes enclosure a guarantee.
 */
export function fittedFontSize(lines: string[], w: number, h: number, scale: number): number {
  const scaled = NODE_FONT * Math.min(scale, 1.4);
  const widest = Math.max(...lines.map((line) => measureLabel(line, scaled)));
  // Padding shrinks with the box. A fixed 18px inset either side is sensible on a 200px box and
  // most of the available width on a 60px one, where it would drive the fitted size to nothing.
  const pad = Math.min(LABEL_PADDING, w * 0.09);
  const byWidth = widest > 0 ? ((w - pad * 2) / widest) * scaled : scaled;
  const byHeight = (h - 10) / (lines.length * 1.25);
  // No floor above the fit. Enclosure is the invariant this function exists to guarantee, and a
  // minimum size that overrides it would quietly reintroduce the overflow it was added to prevent.
  return Math.max(6, Math.min(scaled, byWidth, byHeight));
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
    children: spec.nodes.map((n) => {
      const { width, height } = boxFor(n.label);
      return { id: n.id, width, height };
    }),
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
    const { width, height, lines } = boxFor(node.label);
    return {
      id: node.id,
      label: node.label,
      x: cx + rx * Math.cos(angle) - width / 2,
      y: cy + ry * Math.sin(angle) - height / 2,
      w: width,
      h: height,
      lines,
      // Nothing is scaled in the ring layout, so the box is already the measured size — but the
      // fit is still computed rather than assumed, so this cannot drift from the ELK path.
      fontSize: fittedFontSize(lines, width, height, 1),
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
    const nodes: LaidOutNode[] = children.map((c) => {
      const label = labelFor.get(String(c.id)) ?? String(c.id);
      const w = (c.width ?? 120) * scale;
      const h = (c.height ?? 58) * scale;
      const lines = wrapLabel(label, NODE_FONT);
      return {
        id: String(c.id),
        label,
        x: tx(c.x ?? 0),
        y: ty(c.y ?? 0),
        w,
        h,
        lines,
        // The box was just scaled; the type has to be scaled with it, or a layout that shrinks to
        // fit the frame pushes every label straight out through the sides of its own box.
        fontSize: fittedFontSize(lines, w, h, scale),
      };
    });

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
