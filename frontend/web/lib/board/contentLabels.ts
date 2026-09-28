/**
 * A NODE'S VALUE IS NOT A LABEL.
 *
 * The sandbox hides every `data-teach-kind="label"` element (NO LABELS — lib/drawPrompt.ts), but the
 * same rule allows "text that IS the content inside a drawn element: a node's key in a tree". Models
 * tag those as "label" anyway, so a strict binary-search-tree board drew its nodes and edges with
 * every value ("5", "parent", "root") hidden — empty ovals joined by lines.
 *
 * A <text> tagged "label" whose anchor point sits inside a small drawn shape (a node, a cell, a box)
 * is content, and is re-tagged "write" so the host writes it like any other word. A label beside a
 * part stays a label and stays hidden. Literal coordinates only: an expression cannot be placed, so
 * it is left exactly as the model wrote it.
 */

type Box = { left: number; top: number; right: number; bottom: number };

/** A shape bigger than this share of the 1000x560 board is a background or container, not a node. */
const MAX_NODE_AREA = 1000 * 560 * 0.12;
/** Room for a baseline that sits a few units below a small node's centre line. */
const SLACK = 4;

function attr(tag: string, name: string): number | null {
  const match = tag.match(new RegExp(`\\s${name}=(?:"(-?\\d+(?:\\.\\d+)?)"|\\{\\s*(-?\\d+(?:\\.\\d+)?)\\s*\\})`));
  if (!match) return null;
  const value = Number(match[1] ?? match[2]);
  return Number.isFinite(value) ? value : null;
}

function shapeBoxes(code: string): Box[] {
  const boxes: Box[] = [];
  for (const [tag] of code.matchAll(/<rect\b[^>]*>/g)) {
    const x = attr(tag, "x") ?? 0;
    const y = attr(tag, "y") ?? 0;
    const width = attr(tag, "width");
    const height = attr(tag, "height");
    if (width === null || height === null) continue;
    boxes.push({ left: x, top: y, right: x + width, bottom: y + height });
  }
  for (const [tag, kind] of code.matchAll(/<(circle|ellipse)\b[^>]*>/g)) {
    const cx = attr(tag, "cx");
    const cy = attr(tag, "cy");
    const rx = kind === "circle" ? attr(tag, "r") : attr(tag, "rx");
    const ry = kind === "circle" ? rx : attr(tag, "ry");
    if (cx === null || cy === null || rx === null || ry === null) continue;
    boxes.push({ left: cx - rx, top: cy - ry, right: cx + rx, bottom: cy + ry });
  }
  return boxes.filter((box) => (box.right - box.left) * (box.bottom - box.top) <= MAX_NODE_AREA);
}

export function keepContentLabels(code: string): string {
  if (!/data-teach-kind=["']label["']/.test(code)) return code;
  const boxes = shapeBoxes(code);
  if (!boxes.length) return code;
  return code.replace(/<text\b[^>]*>/g, (tag) => {
    if (!/data-teach-kind=["']label["']/.test(tag)) return tag;
    const x = attr(tag, "x");
    const y = attr(tag, "y");
    if (x === null || y === null) return tag;
    const inside = boxes.some((box) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom + SLACK);
    return inside ? tag.replace(/data-teach-kind=(["'])label\1/, 'data-teach-kind="write"') : tag;
  });
}
