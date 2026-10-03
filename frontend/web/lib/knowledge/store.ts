import "server-only";

import { ensureContainers, knowledgeGraph, progressiveLectureBeats } from "../db/cosmos";
import { canonicalKey, mergeConcept, mergeEdge, type KnowledgeConcept, type KnowledgeEdge, type LectureKnowledge } from "./graph";

/**
 * Persistence for the knowledge graph (lib/knowledge/graph.ts).
 *
 *   - The SHARED graph: one Cosmos document per concept and per link, in `knowledge-graph`.
 *   - Each lecture's KNOWLEDGE RECORD — which concepts each board teaches and which drawn element is
 *     which concept — beside its beats in `progressive-lecture-beats` (id `<session>:knowledge`;
 *     the beat queries only match numeric sequences, so it never reads as a beat).
 */

export type LectureKnowledgeDoc = LectureKnowledge & {
  id: string;
  sessionId: string;
  userId: string;
  kind: "lecture-knowledge";
  topic: string;
  createdAt: string;
};

const knowledgeDocId = (sessionId: string) => `${sessionId}:knowledge`;

export async function saveLectureKnowledge(doc: Omit<LectureKnowledgeDoc, "id" | "kind">): Promise<void> {
  await ensureContainers();
  await progressiveLectureBeats().items.upsert({ ...doc, id: knowledgeDocId(doc.sessionId), kind: "lecture-knowledge" });
}

export async function loadLectureKnowledge(sessionId: string, userId: string): Promise<LectureKnowledgeDoc | null> {
  await ensureContainers();
  try {
    const { resource } = await progressiveLectureBeats().item(knowledgeDocId(sessionId), sessionId).read<LectureKnowledgeDoc>();
    return resource && resource.userId === userId ? resource : null;
  } catch (error) {
    if ((error as { code?: number }).code === 404) return null;
    throw error;
  }
}

/** Concepts by key — or by any of their aliases, so a new lecture's "co2" finds "carbon dioxide". */
export async function conceptsMatching(keys: string[]): Promise<KnowledgeConcept[]> {
  const wanted = [...new Set(keys.filter(Boolean))].slice(0, 200);
  if (wanted.length === 0) return [];
  await ensureContainers();
  const { resources } = await knowledgeGraph().items
    .query<KnowledgeConcept>({
      query: "SELECT * FROM c WHERE c.kind = 'concept' AND (ARRAY_CONTAINS(@keys, c.id) OR EXISTS(SELECT VALUE a FROM a IN c.aliases WHERE ARRAY_CONTAINS(@keys, a)))",
      parameters: [{ name: "@keys", value: wanted }],
    })
    .fetchAll();
  return resources;
}

/** Every link that starts or ends at one of these concepts. */
export async function edgesTouching(keys: string[]): Promise<KnowledgeEdge[]> {
  const wanted = [...new Set(keys.filter(Boolean))].slice(0, 200);
  if (wanted.length === 0) return [];
  await ensureContainers();
  const { resources } = await knowledgeGraph().items
    .query<KnowledgeEdge>({
      query: "SELECT * FROM c WHERE c.kind = 'edge' AND (ARRAY_CONTAINS(@keys, c['from']) OR ARRAY_CONTAINS(@keys, c['to']))",
      parameters: [{ name: "@keys", value: wanted }],
    })
    .fetchAll();
  return resources;
}

/**
 * The graph's concepts that a piece of text is about: every 1-3 word run of it is tried as a key
 * (or alias), so "how do plants make glucose" finds "plant" and "glucose".
 */
export async function conceptsInText(text: string): Promise<KnowledgeConcept[]> {
  const words = canonicalKey(text).split(" ").filter((w) => w.length > 1);
  const keys = new Set<string>();
  for (let n = 1; n <= 3; n++) for (let i = 0; i + n <= words.length; i++) keys.add(canonicalKey(words.slice(i, i + n).join(" ")));
  return conceptsMatching([...keys].filter((k) => k.length > 2));
}

/**
 * Merge one lecture into the shared graph, ONCE per lecture: a concept counts the lecture, a link
 * gains support only if this lecture had not asserted it before. Returns the lecture's knowledge
 * with every key mapped onto the graph's existing concept where one already matched by alias.
 */
export async function mergeLectureIntoGraph(lectureId: string, knowledge: LectureKnowledge): Promise<LectureKnowledge> {
  await ensureContainers();
  const now = new Date().toISOString();
  const incomingKeys = knowledge.concepts.flatMap((c) => [c.key, ...c.aliases]);
  const existing = await conceptsMatching(incomingKeys);
  // incoming key -> the graph's id for it
  const remap = new Map<string, string>();
  for (const c of knowledge.concepts) {
    const hit = existing.find((e) => e.id === c.key) ?? existing.find((e) => e.aliases.includes(c.key) || c.aliases.includes(e.id));
    remap.set(c.key, hit?.id ?? c.key);
  }
  const map = (k: string) => remap.get(k) ?? k;
  const mapped: LectureKnowledge = {
    concepts: knowledge.concepts.map((c) => ({ ...c, key: map(c.key) })),
    edges: knowledge.edges.map((e) => ({ ...e, from: map(e.from), to: map(e.to) })).filter((e) => e.from !== e.to),
    beats: knowledge.beats.map((b) => ({ ...b, concepts: [...new Set(b.concepts.map(map))], elements: Object.fromEntries(Object.entries(b.elements).map(([el, k]) => [el, map(k)])) })),
  };

  const container = knowledgeGraph();
  const byId = new Map(existing.map((e) => [e.id, e]));
  const seenConcepts = new Set<string>();
  await Promise.all(mapped.concepts.map(async (c) => {
    if (seenConcepts.has(c.key)) return;
    seenConcepts.add(c.key);
    const before = byId.get(c.key) ?? null;
    await container.items.upsert(mergeConcept(before, c, now));
  }));
  const edgeDocs = await Promise.all(mapped.edges.map(async (e) => {
    const id = `${e.from}|${e.type}|${e.to}`.slice(0, 250);
    try {
      const { resource } = await container.item(id, id).read<KnowledgeEdge>();
      return { e, before: resource ?? null };
    } catch {
      return { e, before: null };
    }
  }));
  await Promise.all(edgeDocs.map(({ e, before }) => {
    const next = mergeEdge(before, e, lectureId, now);
    return next === before ? Promise.resolve() : container.items.upsert(next);
  }));
  return mapped;
}
