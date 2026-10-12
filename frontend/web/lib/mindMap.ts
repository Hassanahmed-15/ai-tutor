/**
 * THE MIND MAP of a finished lecture: the topic at the root, the ideas it taught branching to the
 * right, as deep as the topic needs (asked for 2026-10-07, after Google NotebookLM's mind maps).
 *
 * One model call reads the whole lecture and organises it — grouping ideas that were taught far
 * apart, two levels for a simple topic and up to four for a complex one. Everything here is pure:
 * the transcript the model reads, the prompt, a parser that never throws and clamps what comes back,
 * and the left-to-right tree layout the view draws.
 */

/** `slides`: 0-based indices of the lecture's slides that taught this idea, earliest first. */
export type MindMapNode = { id: string; label: string; note?: string; slides?: number[]; children: MindMapNode[] };
export type MindMap = { title: string; root: MindMapNode };
export type MindMapBeatInput = { title: string; points?: string[]; script?: string; conceptId?: string };

/** Levels below the root, children per node, and nodes in all — enough for a dense topic, still readable. */
export const MIND_MAP_MAX_DEPTH = 4;
export const MIND_MAP_MAX_CHILDREN = 7;
export const MIND_MAP_MAX_NODES = 60;
const MAX_LABEL = 60;
const MAX_NOTE = 140;

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/**
 * What the model reads: each beat's title, concept, points and script, within a budget split evenly
 * across beats (as the one-slide summary does), so a long early beat cannot crowd out the end.
 *
 * Each beat is headed "Slide N" by its place in the lecture — empty beats skipped, never renumbered —
 * so the slide numbers the model tags a branch with point at the right slide.
 */
export function mindMapTranscript(beats: MindMapBeatInput[], budget = 12_000): string {
  const usable = beats.map((beat, index) => ({ beat, index })).filter(({ beat }) => beat.title?.trim() || beat.script?.trim());
  if (usable.length === 0) return "";
  const perBeat = Math.max(300, Math.floor(budget / usable.length));
  return usable
    .map(({ beat, index }) => {
      const head = `## Slide ${index + 1}. ${clean(beat.title, 120)}${beat.conceptId ? ` (concept: ${clean(beat.conceptId, 60)})` : ""}`;
      const points = (beat.points ?? []).filter(Boolean).slice(0, 5).map((p) => `- ${clean(p, 160)}`).join("\n");
      return [head, points, clean(beat.script, perBeat)].filter(Boolean).join("\n");
    })
    .join("\n\n")
    .slice(0, budget);
}

export const MIND_MAP_SYSTEM_PROMPT = `You turn a lecture the student has just finished into a MIND MAP. Output ONLY JSON:
{ "title": string, "root": { "label": string, "children": [ { "label": string, "note"?: string, "slides": number[], "children": [ ... ] } ] } }

- The root's label is the lecture's subject (2-6 words). "title" is the same subject.
- Organise what the lecture taught into a hierarchy: main branches are the big ideas, their children the parts, steps, types, causes, examples or formulas that belong to them. Group related ideas together even if they were taught far apart.
- Branches are IDEAS, not slides: do not copy the lecture's slide titles one-to-one as the main branches. Regroup — a concept explained across three slides is one branch; a slide that touched two ideas splits between them.
- DEPTH FOLLOWS THE TOPIC: 2 levels below the root for a simple topic, 3 for a typical one, 4 only for a rich, complex one. Never pad: a leaf is fine.
- 3-7 children per node where there are that many real parts; fewer is fine.
- Every "label" is a short noun phrase, at most 6 words — never a sentence. "note" is optional: one short line (at most 18 words) with the key fact, only on leaves where it helps.
- No duplicates anywhere in the tree. Use ONLY what the lecture below taught — no outside facts.
- "slides" on every node below the root: the number(s) of the "## Slide N" heading(s) where that idea was actually taught, the main one first, at most 3. Never a slide that only mentions it in passing.`;

export const MIND_MAP_STRICT_RULES = `STRICTLY FROM THE SOURCE — this overrides the rules above.
The student chose to learn ONLY from their own document. Every label and note must be something SOURCE states; leave out anything the lecture added that SOURCE does not support. A smaller map is correct.`;

const MAX_SLIDES_PER_NODE = 3;

/**
 * The slides a node says taught it: 1-based numbers from the model → 0-based indices, only real
 * slides (1..slideCount), no repeats, the main one first. With no slideCount every positive number
 * is kept, since there is nothing to check it against.
 */
function slidesOf(value: unknown, slideCount: number): number[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const out: number[] = [];
  for (const item of list) {
    const n = typeof item === "number" ? item : typeof item === "string" ? Number(item.replace(/^\s*slide\s*/i, "")) : NaN;
    if (!Number.isInteger(n) || n < 1 || (slideCount > 0 && n > slideCount)) continue;
    if (!out.includes(n - 1)) out.push(n - 1);
    if (out.length >= MAX_SLIDES_PER_NODE) break;
  }
  return out;
}

/**
 * A validated, clamped mind map, or null with the reason — never throws.
 *
 * `slideCount` is how many slides the lecture sent has, so a slide number that does not exist is
 * dropped rather than opening nothing. A branch the model gave no slides gets its children's
 * (earliest first), so every box below the root can open the slide that taught it.
 */
export function parseMindMap(raw: unknown, fallbackTitle = "Lecture", slideCount = 0): { mindMap: MindMap | null; issue?: string } {
  if (!raw || typeof raw !== "object") return { mindMap: null, issue: "not a JSON object" };
  const o = raw as Record<string, unknown>;
  const rootRaw = (o.root && typeof o.root === "object" ? o.root : o) as Record<string, unknown>;
  let budget = MIND_MAP_MAX_NODES;

  const labelOf = (n: Record<string, unknown>) => clean(n.label ?? n.title ?? n.name, MAX_LABEL);
  const build = (n: Record<string, unknown>, id: string, depth: number): MindMapNode => {
    budget -= 1;
    const node: MindMapNode = { id, label: labelOf(n), children: [] };
    const note = clean(n.note ?? n.detail, MAX_NOTE);
    if (note && note.toLowerCase() !== node.label.toLowerCase()) node.note = note;
    const own = depth > 0 ? slidesOf(n.slides ?? n.slide, slideCount) : [];
    if (own.length) node.slides = own;
    if (depth >= MIND_MAP_MAX_DEPTH) return node;
    const seen = new Set<string>();
    const kids = Array.isArray(n.children) ? n.children : [];
    for (const kid of kids) {
      if (node.children.length >= MIND_MAP_MAX_CHILDREN || budget <= 0) break;
      if (!kid || typeof kid !== "object") continue;
      const label = labelOf(kid as Record<string, unknown>);
      const key = label.toLowerCase();
      if (!label || seen.has(key)) continue;
      seen.add(key);
      node.children.push(build(kid as Record<string, unknown>, `${id}.${node.children.length}`, depth + 1));
    }
    if (depth > 0 && !node.slides) {
      const fromKids = [...new Set(node.children.map((c) => c.slides?.[0]).filter((s): s is number => s !== undefined))].sort((a, b) => a - b);
      if (fromKids.length) node.slides = fromKids.slice(0, MAX_SLIDES_PER_NODE);
    }
    return node;
  };

  const root = build(rootRaw, "0", 0);
  if (!root.label) root.label = clean(o.title, MAX_LABEL) || fallbackTitle;
  if (root.children.length < 2) return { mindMap: null, issue: "the root needs at least 2 branches, each with a short label" };
  return { mindMap: { title: clean(o.title, 80) || root.label, root } };
}

/** Every node with children — what "expand all" opens. */
export function branchIds(root: MindMapNode): string[] {
  const out: string[] = [];
  const walk = (n: MindMapNode) => {
    if (n.children.length) out.push(n.id);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** How deep the tree goes below the root. */
export function mindMapDepth(root: MindMapNode): number {
  return root.children.length ? 1 + Math.max(...root.children.map(mindMapDepth)) : 0;
}

// ── LAYOUT: a left-to-right tidy tree ──────────────────────────────────────────────────────────

export type MeasuredLabel = { lines: string[]; noteLines?: string[]; w: number; h: number };
export type PlacedNode = {
  id: string;
  label: string;
  note?: string;
  slides?: number[];
  depth: number;
  lines: string[];
  noteLines: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  hasChildren: boolean;
  expanded: boolean;
  parentId?: string;
};
export type PlacedLink = { from: string; to: string; d: string };
export type MindMapLayout = { nodes: PlacedNode[]; links: PlacedLink[]; width: number; height: number };

export const MIND_MAP_GAP_X = 84;
export const MIND_MAP_GAP_Y = 16;

function wrapByChars(text: string, perLine: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > perLine && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Wraps a label (and its note) by an average character width — the view passes a real measurer. */
export function approxMeasure(label: string, depth: number, note?: string, maxWidth = 240): MeasuredLabel {
  const charW = depth === 0 ? 9.4 : 8.2;
  const lineH = depth === 0 ? 24 : 21;
  const lines = wrapByChars(label, Math.max(8, Math.floor((maxWidth - 32) / charW)));
  const noteLines = note ? wrapByChars(note, Math.max(10, Math.floor((maxWidth - 32) / 6.8))) : [];
  const widest = Math.max(...lines.map((l) => l.length * charW), ...noteLines.map((l) => l.length * 6.8));
  return { lines, noteLines, w: Math.min(maxWidth, Math.ceil(widest + 32)), h: lines.length * lineH + noteLines.length * 17 + (noteLines.length ? 6 : 0) + 26 };
}

/**
 * Places every VISIBLE node: x by column (each column as wide as its widest box), y by subtree —
 * leaves stacked with a gap, each parent centred on its children. Connectors are curves from a
 * parent's right edge to each child's left edge.
 */
export function layoutMindMap(
  root: MindMapNode,
  expanded: ReadonlySet<string>,
  measure: (label: string, depth: number, note?: string) => MeasuredLabel = approxMeasure,
): MindMapLayout {
  type Draft = PlacedNode & { kids: Draft[] };
  const colW: number[] = [];
  const draft = (n: MindMapNode, depth: number, parentId?: string): Draft => {
    const m = measure(n.label, depth, n.note);
    colW[depth] = Math.max(colW[depth] ?? 0, m.w);
    const open = n.children.length > 0 && expanded.has(n.id);
    return {
      id: n.id, label: n.label, note: n.note, slides: n.slides, depth, lines: m.lines, noteLines: m.noteLines ?? [], x: 0, y: 0, w: m.w, h: m.h,
      hasChildren: n.children.length > 0, expanded: open, parentId,
      kids: open ? n.children.map((c) => draft(c, depth + 1, n.id)) : [],
    };
  };
  const tree = draft(root, 0);
  const colX: number[] = [0];
  for (let d = 1; d < colW.length; d++) colX[d] = colX[d - 1] + colW[d - 1] + MIND_MAP_GAP_X;

  let cursor = 0;
  const place = (n: Draft) => {
    n.x = colX[n.depth];
    if (n.kids.length === 0) {
      n.y = cursor;
      cursor += n.h + MIND_MAP_GAP_Y;
      return;
    }
    n.kids.forEach(place);
    const first = n.kids[0];
    const last = n.kids[n.kids.length - 1];
    n.y = (first.y + first.h / 2 + last.y + last.h / 2) / 2 - n.h / 2;
  };
  place(tree);

  const drafts: Draft[] = [];
  const flatten = (n: Draft) => {
    drafts.push(n);
    n.kids.forEach(flatten);
  };
  flatten(tree);
  // Shift so the top-most box sits at y = 0 (a tall root can rise above its first child).
  const top = Math.min(...drafts.map((n) => n.y));
  for (const n of drafts) n.y -= top;

  const links: PlacedLink[] = [];
  for (const n of drafts) {
    for (const kid of n.kids) {
      const x1 = n.x + n.w;
      const y1 = n.y + n.h / 2;
      const x2 = kid.x;
      const y2 = kid.y + kid.h / 2;
      const dx = (x2 - x1) / 2;
      links.push({ from: n.id, to: kid.id, d: `M${x1.toFixed(1)} ${y1.toFixed(1)} C${(x1 + dx).toFixed(1)} ${y1.toFixed(1)} ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}` });
    }
  }
  const nodes: PlacedNode[] = drafts.map(({ kids: _kids, ...placed }) => placed);
  const width = Math.max(...nodes.map((n) => n.x + n.w));
  const height = Math.max(...nodes.map((n) => n.y + n.h));
  return { nodes, links, width, height };
}
