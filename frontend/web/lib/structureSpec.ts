/**
 * The `structureScene` spec: a diagram described as MEANING, never as geometry.
 *
 * WHY THIS EXISTS. Every other board asks the model to place things — absolute `x`/`y` for each
 * label, shape and arrow. A language model has no visual cortex; it cannot do collision detection
 * and edge routing blind, one token at a time, and measurement on this codebase's own output shows
 * exactly that: text spanning x=64..1180 on a 1000px canvas, a label at y=-31, and two labels
 * printed on top of each other rendering as "3c".
 *
 * So this spec contains NO COORDINATES AT ALL. The model supplies the nodes and the edges between
 * them — the part it is genuinely good at, because that is domain knowledge rather than spatial
 * reasoning — and lib/structureLayout.ts computes every position with ELK. Overlap and clipping
 * stop being faults to police after the fact and become unrepresentable.
 *
 * It also fixes a relevance ceiling that no amount of prompting could: the `flow` kind in
 * manimSceneSpec.ts is a flat list of at most FOUR strings, with no edges, no branching and no way
 * to close a loop. The rock cycle is a cycle of five-plus stages, so it was literally impossible to
 * state. Here it is just `kind: "cycle"` with the real stage names and the real transitions.
 *
 * Mirrors manimSceneSpec.ts deliberately — same validator shape, same caps-not-throws discipline,
 * same "a spec that survives validation is renderable" guarantee.
 *
 * Plain module (no "server-only"): the validator runs on the server, the types are shared with the
 * client renderer.
 */

export type StructureKind = "cycle" | "flow" | "tree" | "state";

export const STRUCTURE_KINDS: ReadonlySet<string> = new Set<StructureKind>([
  "cycle",
  "flow",
  "tree",
  "state",
]);

export type StructureNode = { id: string; label: string };
export type StructureEdge = { from: string; to: string; label?: string };

export type StructureSpec = {
  kind: StructureKind;
  title?: string;
  nodes: StructureNode[];
  edges: StructureEdge[];
};

/** Beyond this a board stops being readable at 1000x560 regardless of how good the layout is. */
const MAX_NODES = 8;
const MIN_NODES = 3;
const MAX_EDGES = 12;

function text(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLen) : undefined;
}

function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Returns a clean spec, or null if it cannot be made renderable.
 *
 * Never throws: a malformed spec must degrade to "no structural board on this beat", exactly as
 * validateManimSceneSpec does, rather than taking down a lecture that is otherwise fine.
 */
export function validateStructureSpec(raw: unknown): StructureSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = typeof o.kind === "string" ? o.kind.trim() : "";
  if (!STRUCTURE_KINDS.has(kind)) return null;

  const rawNodes = Array.isArray(o.nodes) ? o.nodes : [];
  const nodes: StructureNode[] = [];
  const seen = new Set<string>();
  for (const entry of rawNodes) {
    if (nodes.length >= MAX_NODES) break;
    if (!entry || typeof entry !== "object") continue;
    const n = entry as Record<string, unknown>;
    const id = text(n.id, 40);
    const label = text(n.label, 28) ?? id;
    // A duplicate id would make edges ambiguous, so the later one is dropped rather than merged.
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    nodes.push({ id, label });
  }
  // Two boxes and an arrow is not a structure; it is a sentence, and TYPE A says it better.
  if (nodes.length < MIN_NODES) return null;

  const edges: StructureEdge[] = [];
  const rawEdges = Array.isArray(o.edges) ? o.edges : [];
  for (const entry of rawEdges) {
    if (edges.length >= MAX_EDGES) break;
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const from = text(e.from, 40);
    const to = text(e.to, 40);
    // Dangling edges are dropped, not repaired — the layout engine would otherwise be handed a
    // node id that does not exist, and "renderable if it validates" is the whole contract here.
    if (!from || !to || !seen.has(from) || !seen.has(to) || from === to) continue;
    edges.push(compact({ from, to, label: text(e.label, 22) }));
  }
  // Nodes with no relationships between them are a list, and a list is a TYPE A blackboard.
  if (edges.length === 0) return null;

  return compact({
    kind: kind as StructureKind,
    title: text(o.title, 60),
    nodes,
    edges,
  }) as StructureSpec;
}
