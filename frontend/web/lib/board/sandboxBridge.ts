/**
 * WHAT IS ON A SANDBOXED BOARD, FROM OUTSIDE IT.
 *
 * Most generated boards are React animations rendered in a sandboxed iframe with an opaque origin.
 * The parent document cannot see inside: `document.elementsFromPoint` at a pen stroke returns the
 * `<iframe>` element, never the `<text>` beneath it, and `querySelectorAll("svg")` on the board finds
 * nothing. So "Explain this" sent the model a crop of the background plus the student's ink — a dark
 * rectangle with a squiggle — and "the student highlighted…" carried no words. The AI had no visual
 * context because nothing crossed the iframe boundary.
 *
 * The iframe already talks to the parent by postMessage. This module is the parent's side of two
 * more messages:
 *
 *   textmap    the iframe pushes every VISIBLE text element with its box, whenever that set changes,
 *              so the pen can be told what word it is under, and the tutor what the board says.
 *   snapshot   the parent asks, the iframe replies with its SVG serialised with computed styles
 *              inlined, so the selected region can be rasterised with the board actually in it.
 *
 * The lookup is pure (`findTextAt`) so it is tested; the DOM wrappers around it are thin.
 */

export interface SandboxTextItem {
  text: string;
  /** Box in the iframe's own viewport coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SandboxSnapshot {
  /** Serialised `<svg>` with computed styles inlined, ready to rasterise. */
  svg: string;
  /** The svg's box in the iframe's viewport. */
  rect: { left: number; top: number; width: number; height: number };
  viewBox: { x: number; y: number; width: number; height: number };
}

/** A pen tip is a few pixels wide and a student is not a surgeon; pad the hit test a little. */
const HIT_PADDING = 6;

/** The text whose box contains the point, preferring the smallest box (a tspan over its line). */
export function findTextAt(items: SandboxTextItem[], x: number, y: number, padding = HIT_PADDING): string {
  let best: SandboxTextItem | null = null;
  for (const item of items) {
    if (!item.text) continue;
    if (x < item.x - padding || x > item.x + item.w + padding || y < item.y - padding || y > item.y + item.h + padding) continue;
    if (!best || item.w * item.h < best.w * best.h) best = item;
  }
  return best?.text ?? "";
}

const registry = new WeakMap<HTMLIFrameElement, SandboxTextItem[]>();
const registered = new Set<HTMLIFrameElement>();

export function registerSandboxText(iframe: HTMLIFrameElement, items: SandboxTextItem[]): void {
  registry.set(iframe, items);
  registered.add(iframe);
}

export function unregisterSandboxText(iframe: HTMLIFrameElement): void {
  registry.delete(iframe);
  registered.delete(iframe);
}

/** The board text under a point in the PARENT's client coordinates, looking inside sandboxes. */
export function sandboxTextAt(clientX: number, clientY: number): string {
  for (const iframe of registered) {
    if (!iframe.isConnected) {
      registered.delete(iframe);
      continue;
    }
    const rect = iframe.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;
    const items = registry.get(iframe) ?? [];
    const text = findTextAt(items, clientX - rect.left, clientY - rect.top);
    if (text) return text;
  }
  return "";
}

/**
 * Everything currently written on the sandboxed boards under `root` (the active one, normally), in
 * reading order — what the tutor should know is on the board, as opposed to what was narrated.
 */
export function visibleSandboxText(root: ParentNode | null, limit = 60): string[] {
  if (!root) return [];
  const out: string[] = [];
  for (const iframe of root.querySelectorAll<HTMLIFrameElement>("iframe")) {
    const items = registry.get(iframe);
    if (!items) continue;
    const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const item of ordered) {
      if (item.text && !out.includes(item.text)) out.push(item.text);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

let snapshotSequence = 0;

/** Ask a sandbox for its picture. Resolves with the serialised SVG, or rejects when it does not answer. */
export function snapshotSandbox(iframe: HTMLIFrameElement, timeoutMs = 1500): Promise<SandboxSnapshot> {
  return new Promise((resolve, reject) => {
    const id = `snap-${++snapshotSequence}`;
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("The board did not answer the snapshot request."));
    }, timeoutMs);
    function onMessage(event: MessageEvent) {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object" || data.type !== "snapshot" || data.id !== id) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      if (typeof data.svg !== "string" || !data.svg) {
        reject(new Error("The board has no picture to snapshot."));
        return;
      }
      resolve({
        svg: data.svg,
        rect: {
          left: Number(data.rect?.left) || 0,
          top: Number(data.rect?.top) || 0,
          width: Number(data.rect?.width) || 1,
          height: Number(data.rect?.height) || 1,
        },
        viewBox: {
          x: Number(data.viewBox?.x) || 0,
          y: Number(data.viewBox?.y) || 0,
          width: Number(data.viewBox?.width) || Number(data.rect?.width) || 1,
          height: Number(data.viewBox?.height) || Number(data.rect?.height) || 1,
        },
      });
    }
    window.addEventListener("message", onMessage);
    try {
      iframe.contentWindow?.postMessage({ type: "snapshot", id }, "*");
    } catch (error) {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      reject(error instanceof Error ? error : new Error("The board could not be asked for a snapshot."));
    }
  });
}
